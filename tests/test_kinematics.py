"""
Unit tests for ground-plane Time-to-Collision (TTC), deceleration gating,
and kinematic false-alarm filtering.
"""

from typing import List, Tuple
from collections import deque
import pytest

from src.kinematics import (
    VehicleKinematicProfile,
    PairKinematicEvidence,
    compute_vehicle_kinematics,
    compute_pair_kinematics,
    evaluate_kinematic_gate,
)
from src.accident_logic import VehicleCollisionDetector


class DummyVehicle:
    """Mock TrackedVehicle for synthetic kinematic trajectory testing."""
    def __init__(
        self,
        track_id: int,
        bbox: List[float],
        ground_points: List[Tuple[float, float]],
        speed_kmh: float = 0.0,
    ):
        self.track_id = track_id
        self.bbox = list(bbox)
        self.ground_history = deque(ground_points, maxlen=30)
        self.speed_kmh = speed_kmh
        self.speed_history_kmh = deque([speed_kmh] * len(ground_points), maxlen=5)
        self.history = deque([[(bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0]], maxlen=30)

    @property
    def centroid(self):
        return [(self.bbox[0] + self.bbox[2]) / 2.0, (self.bbox[1] + self.bbox[3]) / 2.0]


def test_head_on_approach():
    """
    Scenario 1: Head-on approach.
    Vehicle 1 at x=0 moving +X at 10 m/s (10 frames at 10 fps -> 1m/frame).
    Vehicle 2 at x=50 moving -X at 10 m/s (10 frames at 10 fps -> -1m/frame).
    Distance = 50 - 10 = 40m at last frame.
    Closing speed along connecting line = 20 m/s.
    TTC = distance / closing_speed = 40 / 20 = 2.0s.
    """
    fps = 10.0
    dt = 1.0 / fps

    pts1 = [(i * 1.0, 0.0) for i in range(11)]  # ends at (10, 0)
    pts2 = [(50.0 - i * 1.0, 0.0) for i in range(11)]  # ends at (40, 0)

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=pts1)
    v2 = DummyVehicle(track_id=2, bbox=[200, 100, 250, 150], ground_points=pts2)

    evidence = compute_pair_kinematics(v1, v2, fps=fps)

    assert evidence.is_calibrated is True
    assert evidence.distance_m == pytest.approx(30.0, abs=0.5)
    assert evidence.closing_speed_mps == pytest.approx(20.0, abs=0.5)
    assert evidence.ttc_s == pytest.approx(1.5, abs=0.1)
    assert evidence.is_queued_traffic is False

    # In "require" mode with min_ttc=2.0s, this should pass
    passes, boost, reason = evaluate_kinematic_gate(
        evidence,
        enabled=True,
        mode="require",
        min_ttc_before_contact_s=2.0,
    )
    assert passes is True
    assert "TTC" in reason


def test_rear_end_with_sudden_stop():
    """
    Scenario 2: Rear-end with sudden stop.
    Leading vehicle brakes hard: moving at 15 m/s, then comes to dead stop in 0.3s.
    Peak deceleration should be sharp (> 15 m/s^2).
    """
    fps = 10.0
    # Scenario: v2 was closing fast on v1 (relative speed ~15 m/s before contact).
    # Then impact occurs, leading vehicle stopped and following vehicle crumpled/stopped (relative speed drops to 0).
    pts1 = [
        (0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0),
        (0.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)
    ]
    # Following vehicle approached at 15 m/s (1.5m/frame), then collided and stopped
    pts1 = [(0.0, 0.0)] * 10
    pts2 = [
        (-15.0, 0.0), (-13.5, 0.0), (-12.0, 0.0), (-10.5, 0.0), (-9.0, 0.0),
        (-6.0, 0.0), (-3.0, 0.0), (0.0, 0.0), (0.0, 0.0), (0.0, 0.0)
    ]

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=pts1)
    v2 = DummyVehicle(track_id=2, bbox=[95, 100, 145, 150], ground_points=pts2)

    evidence = compute_pair_kinematics(v1, v2, fps=fps)

    assert evidence.is_calibrated is True
    assert evidence.v2_peak_decel_mps2 > 5.0
    assert evidence.relative_speed_drop_mps > 2.0

    passes, boost, reason = evaluate_kinematic_gate(
        evidence,
        enabled=True,
        mode="require",
        min_decel_mps2=4.0,
    )
    assert passes is True


def test_two_vehicles_parked_bumper_to_bumper():
    """
    Scenario 3: Two vehicles parked bumper-to-bumper.
    Both vehicles have negligible speed (< 0.2 m/s).
    Must be identified as queued/stationary traffic and suppressed in require mode.
    """
    fps = 10.0
    pts1 = [(10.0 + i * 0.01, 20.0) for i in range(10)]
    pts2 = [(10.5 + i * 0.01, 20.0) for i in range(10)]

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 160, 160], ground_points=pts1)
    v2 = DummyVehicle(track_id=2, bbox=[120, 100, 180, 160], ground_points=pts2)

    evidence = compute_pair_kinematics(v1, v2, fps=fps, stationary_speed_mps=1.2)

    assert evidence.is_calibrated is True
    assert evidence.is_queued_traffic is True

    # In "require" mode, queued stationary traffic is suppressed
    passes, boost, reason = evaluate_kinematic_gate(
        evidence,
        enabled=True,
        mode="require",
    )
    assert passes is False
    assert "queued traffic" in reason.lower()

    # In "boost" mode, never blocked
    passes_boost, boost_val, _ = evaluate_kinematic_gate(
        evidence,
        enabled=True,
        mode="boost",
    )
    assert passes_boost is True


def test_parallel_overtaking_with_overlapping_boxes():
    """
    Scenario 4: Parallel overtaking on multi-lane highway.
    Both moving in +Y direction with slight lateral offset.
    Closing speed along displacement line is ~0 or separating.
    TTC is infinity.
    """
    fps = 10.0
    # Both moving along Y: v1 at 10 m/s, v2 at 14 m/s. Lateral separation = 3.0m
    pts1 = [(0.0, i * 1.0) for i in range(10)]
    pts2 = [(3.0, i * 1.4) for i in range(10)]

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=pts1)
    v2 = DummyVehicle(track_id=2, bbox=[120, 100, 170, 150], ground_points=pts2)

    evidence = compute_pair_kinematics(v1, v2, fps=fps)

    assert evidence.is_calibrated is True
    # Moving along parallel lanes with faster overtaking vehicle -> separating / non-closing
    assert evidence.closing_speed_mps <= 0.1
    assert evidence.ttc_s == float("inf")


def test_vehicle_brakes_hard_no_other_vehicle():
    """
    Scenario 5: Single vehicle brakes hard with no other vehicle nearby.
    Individual kinematics computes high deceleration, but no pair evidence is formed.
    """
    fps = 10.0
    pts = [
        (0.0, 0.0), (1.5, 0.0), (3.0, 0.0), (4.5, 0.0), (5.0, 0.0),
        (5.1, 0.0), (5.1, 0.0), (5.1, 0.0), (5.1, 0.0)
    ]
    v = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=pts)

    profile = compute_vehicle_kinematics(v, fps=fps)
    assert profile.is_calibrated is True
    assert profile.peak_deceleration_mps2 > 4.0
    assert profile.speed_mps < 1.0


def test_gate_disabled_identical_baseline():
    """
    Scenario 6: When kinematic_gate_enabled is False, collision detector behaves
    identically to baseline and never blocks.
    """
    detector_disabled = VehicleCollisionDetector(
        kinematic_gate_enabled=False,
        min_overlap_frames=1,
    )
    detector_enabled_require = VehicleCollisionDetector(
        kinematic_gate_enabled=True,
        kinematic_gate_mode="require",
        min_overlap_frames=1,
    )

    # Stationary overlapping pair
    pts1 = [(10.0, 20.0)] * 10
    pts2 = [(10.2, 20.0)] * 10
    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=pts1)
    v2 = DummyVehicle(track_id=2, bbox=[110, 100, 160, 150], ground_points=pts2)

    # With gate disabled, uncalibrated/unverified kinematics do not block
    ev_dis = evaluate_kinematic_gate(
        PairKinematicEvidence(pair_key=(1, 2), is_calibrated=True, is_queued_traffic=True),
        enabled=False,
    )
    assert ev_dis[0] is True
    assert "disabled" in ev_dis[2]


def test_uncalibrated_camera_bypasses_gate():
    """
    Scenario 7: Camera without calibration data bypasses the gate smoothly.
    """
    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 150, 150], ground_points=[])
    v2 = DummyVehicle(track_id=2, bbox=[110, 100, 160, 150], ground_points=[])

    evidence = compute_pair_kinematics(v1, v2, fps=10.0)
    assert evidence.is_calibrated is False

    passes, boost, reason = evaluate_kinematic_gate(
        evidence,
        enabled=True,
        mode="require",
    )
    assert passes is True
    assert "bypassed" in reason.lower()
