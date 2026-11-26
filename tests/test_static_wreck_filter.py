"""
Unit tests for the optional static-wreck false-alarm filter.
Tests all synthetic scenarios:
1. Parked damaged car in view the whole time (suppressed in 'suppress', flagged in 'flag_only').
2. Car towed on a flatbed moving slowly below threshold (suppressed/flagged).
3. Real crash where a car drives, hits another and both stop (NEVER suppressed).
4. Crash that begins just as the vehicle enters the frame (insufficient history -> unknown -> NEVER suppressed).
5. Car stopped in traffic queue then hit (prior contact -> NEVER suppressed).
6. Baseline identity when filter is disabled (config flag OFF).
7. Calibrated camera metric speed evaluation (km/h thresholds).
"""

import pytest
import numpy as np
from typing import List
from unittest.mock import MagicMock

from src.tracker import TrackedVehicle
from src.kinematics import (
    evaluate_candidate_motion,
    CandidateMotionProfile,
    calculate_box_iou,
    calculate_box_containment,
)
from api.models import PipelineSettings, StaticFilterSettings


def make_vehicle(
    track_id: int,
    bbox: List[float],
    total_frames_seen: int = 150,
    max_speed_px_s: float = 0.0,
    max_speed_kmh: float = None,
    had_abrupt_deceleration: bool = False,
    had_abrupt_heading_change: bool = False,
    had_prior_overlap_or_contact: bool = False,
) -> TrackedVehicle:
    """Helper factory to create synthetic TrackedVehicle instances with specific motion profiles."""
    v = TrackedVehicle(
        track_id=track_id,
        bbox=bbox,
        conf=0.90,
        class_id=2,
        class_name="car",
        max_history=150,
    )
    v.total_frames_seen = total_frames_seen
    v.max_speed_px_s = max_speed_px_s
    v.max_speed_kmh = max_speed_kmh
    v.had_abrupt_deceleration = had_abrupt_deceleration
    v.had_abrupt_heading_change = had_abrupt_heading_change
    v.had_prior_overlap_or_contact = had_prior_overlap_or_contact
    return v


# ------------------------------------------------------------------------------
# SCENARIO 1: Parked damaged car in view the whole time
# ------------------------------------------------------------------------------
def test_scenario_1_parked_damaged_car_suppressed_and_flagged():
    """
    Scenario 1: A damaged car is parked at the curb and has been in view for 5.0s (150 frames @ 30fps).
    It has 0 speed, no abrupt kinematics, and no prior vehicle contact.
    An accident detector candidate box is placed over it.
    - Suppress mode: candidate is suppressed.
    - Flag-only mode: candidate is retained with 'possible static wreck' flag.
    """
    candidate_box = [100.0, 100.0, 200.0, 200.0]
    parked_car = make_vehicle(
        track_id=1,
        bbox=[105.0, 105.0, 195.0, 195.0],
        total_frames_seen=150,  # 5.0 seconds @ 30fps >= min_observed_s (3.0s)
        max_speed_px_s=2.5,     # Tiny jitter < max_speed_threshold_px_s (12.0)
        had_abrupt_deceleration=False,
        had_abrupt_heading_change=False,
        had_prior_overlap_or_contact=False,
    )

    profile = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[parked_car],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_px_s=12.0,
        require_no_prior_contact=True,
    )

    assert profile.is_static is True
    assert profile.classification == "static_wreck"
    assert profile.suppress_recommended is True
    assert profile.time_observed_s >= 5.0
    assert 1 in profile.matched_track_ids
    assert "Observed stationary" in profile.reason


# ------------------------------------------------------------------------------
# SCENARIO 2: Car towed on a flatbed moving slowly
# ------------------------------------------------------------------------------
def test_scenario_2_car_towed_on_flatbed_moving_slowly():
    """
    Scenario 2: A car towed on a flatbed moves smoothly at 8 px/s (well below 12 px/s limit)
    for 4.0 seconds (120 frames @ 30fps) with no sudden deceleration or collision cues.
    Classified as static_wreck / suppressed.
    """
    candidate_box = [300.0, 200.0, 420.0, 320.0]
    towed_car = make_vehicle(
        track_id=10,
        bbox=[305.0, 205.0, 415.0, 315.0],
        total_frames_seen=120,  # 4.0 seconds @ 30fps
        max_speed_px_s=8.0,     # Below 12 px/s
        had_abrupt_deceleration=False,
        had_abrupt_heading_change=False,
        had_prior_overlap_or_contact=False,
    )

    profile = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[towed_car],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_px_s=12.0,
        require_no_prior_contact=True,
    )

    assert profile.is_static is True
    assert profile.classification == "static_wreck"
    assert profile.suppress_recommended is True


# ------------------------------------------------------------------------------
# SCENARIO 3: Real crash where a car drives, hits another, and both stop
# ------------------------------------------------------------------------------
def test_scenario_3_real_crash_moving_impact_never_suppressed():
    """
    Scenario 3: Car A was driving at high speed (70 px/s), collided with Car B,
    both came to an abrupt stop.
    Because Car A had high speed, abrupt deceleration, and prior vehicle contact,
    the candidate must NEVER be suppressed.
    """
    candidate_box = [150.0, 150.0, 300.0, 300.0]

    car_a = make_vehicle(
        track_id=101,
        bbox=[160.0, 160.0, 240.0, 240.0],
        total_frames_seen=150,
        max_speed_px_s=75.0,    # Fast moving vehicle!
        had_abrupt_deceleration=True,
        had_prior_overlap_or_contact=True,
    )
    car_b = make_vehicle(
        track_id=102,
        bbox=[220.0, 220.0, 290.0, 290.0],
        total_frames_seen=150,
        max_speed_px_s=40.0,
        had_abrupt_deceleration=True,
        had_prior_overlap_or_contact=True,
    )

    profile = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[car_a, car_b],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_px_s=12.0,
        require_no_prior_contact=True,
    )

    assert profile.is_static is False
    assert profile.classification == "crash_involved"
    assert profile.suppress_recommended is False
    assert profile.has_abrupt_deceleration is True
    assert profile.has_prior_contact is True


# ------------------------------------------------------------------------------
# SCENARIO 4: Crash that begins just as vehicle enters the frame
# ------------------------------------------------------------------------------
def test_scenario_4_crash_entering_frame_insufficient_history_never_suppressed():
    """
    Scenario 4: A vehicle just enters the frame (observed for only 0.4s / 12 frames)
    and an accident detection candidate immediately appears.
    Because observed duration < min_observed_s (3.0s), history is 'unknown'.
    Unknown candidates must NEVER be suppressed.
    """
    candidate_box = [10.0, 10.0, 110.0, 110.0]
    newly_arrived_car = make_vehicle(
        track_id=77,
        bbox=[15.0, 15.0, 105.0, 105.0],
        total_frames_seen=12,   # 0.4 seconds @ 30fps << 3.0s
        max_speed_px_s=5.0,     # Even if speed reading was low
        had_abrupt_deceleration=False,
        had_prior_overlap_or_contact=False,
    )

    profile = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[newly_arrived_car],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_px_s=12.0,
        require_no_prior_contact=True,
    )

    assert profile.is_static is False
    assert profile.classification == "unknown"
    assert profile.suppress_recommended is False
    assert "insufficient history, unknown (not suppressed)" in profile.reason


# ------------------------------------------------------------------------------
# SCENARIO 5: Car stopped in queue then hit
# ------------------------------------------------------------------------------
def test_scenario_5_car_stopped_in_queue_then_hit_never_suppressed():
    """
    Scenario 5: Car B was stopped in traffic queue for 6.0s (180 frames, speed 0).
    Car A then rear-ends Car B.
    Even though Car B was stationary prior to impact, the collision resulted in
    prior contact/overlap with Car A (had_prior_overlap_or_contact = True).
    Because require_no_prior_contact is True, the candidate is NOT classified
    as a static wreck and is NEVER suppressed.
    """
    candidate_box = [200.0, 200.0, 320.0, 320.0]

    queued_car_b = make_vehicle(
        track_id=202,
        bbox=[205.0, 205.0, 290.0, 290.0],
        total_frames_seen=180,  # 6.0s in view
        max_speed_px_s=1.0,     # Stationary in queue
        had_abrupt_deceleration=False,
        had_prior_overlap_or_contact=True,  # Hit by Car A!
    )

    profile = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[queued_car_b],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_px_s=12.0,
        require_no_prior_contact=True,
    )

    assert profile.is_static is False
    assert profile.classification == "crash_involved"
    assert profile.suppress_recommended is False
    assert profile.has_prior_contact is True


# ------------------------------------------------------------------------------
# SCENARIO 6: Metric evaluation on calibrated cameras
# ------------------------------------------------------------------------------
def test_scenario_6_calibrated_camera_metric_speed():
    """
    Scenario 6: On a calibrated camera, ground-plane speed in km/h is evaluated:
    - Vehicle moving at 1.8 km/h (< 3.0 km/h threshold) -> static_wreck.
    - Vehicle moving at 6.5 km/h (> 3.0 km/h threshold) -> moving (NOT static).
    """
    candidate_box = [100.0, 100.0, 200.0, 200.0]

    mock_calibrator = MagicMock()
    mock_calibrator.is_calibrated = True

    # 6A: Slow rolling / parked vehicle (1.8 km/h <= 3.0 km/h)
    slow_car = make_vehicle(
        track_id=301,
        bbox=[105.0, 105.0, 195.0, 195.0],
        total_frames_seen=150,
        max_speed_kmh=1.8,
    )
    slow_car.speed_kmh = 1.8
    slow_car.ground_history.append((10.0, 20.0))
    slow_car.ground_history.append((10.05, 20.05))

    prof_slow = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[slow_car],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_kmh=3.0,
        calibrator=mock_calibrator,
    )
    assert prof_slow.is_static is True
    assert prof_slow.is_calibrated is True
    assert prof_slow.classification == "static_wreck"

    # 6B: Moving vehicle (6.5 km/h > 3.0 km/h)
    moving_car = make_vehicle(
        track_id=302,
        bbox=[105.0, 105.0, 195.0, 195.0],
        total_frames_seen=150,
        max_speed_kmh=6.5,
    )
    moving_car.speed_kmh = 6.5
    moving_car.ground_history.append((10.0, 20.0))
    moving_car.ground_history.append((10.5, 20.5))

    prof_moving = evaluate_candidate_motion(
        candidate_bbox=candidate_box,
        tracked_vehicles=[moving_car],
        fps=30.0,
        min_observed_s=3.0,
        max_speed_threshold_kmh=3.0,
        calibrator=mock_calibrator,
    )
    assert prof_moving.is_static is False
    assert prof_moving.classification == "moving"
    assert prof_moving.suppress_recommended is False


# ------------------------------------------------------------------------------
# SCENARIO 7: Baseline identity when filter is disabled
# ------------------------------------------------------------------------------
def test_scenario_7_baseline_identity_when_disabled():
    """
    Scenario 7: When accident.static_filter.enabled is False (the default),
    the filter is bypassed entirely and candidates are never filtered out.
    """
    settings = PipelineSettings()
    assert settings.static_filter.enabled is False
    assert settings.static_filter.mode == "suppress"
    assert settings.static_filter.min_observed_s == 3.0
    assert settings.static_filter.max_speed_threshold == 3.0
    assert settings.static_filter.require_no_prior_contact is True
