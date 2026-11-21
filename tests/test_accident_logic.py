import pytest
from typing import List, Tuple
from collections import deque
from src.accident_logic import (
    calculate_iou,
    calculate_containment,
    AccidentPersistenceManager,
    suppress_vehicles_in_accidents,
    detect_vehicle_collisions,
    VehicleCollisionDetector,
    resolve_fps,
    seconds_to_frames,
    AccidentZone,
)


class DummyVehicle:
    """Mock TrackedVehicle for testing spatial containment, suppression, and kinematics."""
    def __init__(self, track_id: int, bbox: List[float], class_name: str = "car", history=None):
        self.track_id = track_id
        self.bbox = bbox
        self.class_name = class_name
        self.is_suppressed = False
        self.accident_id = None
        # Default history has at least current centroid
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        self.history = deque(history if history is not None else [(cx, cy)], maxlen=30)

    @property
    def centroid(self) -> List[float]:
        return [(self.bbox[0] + self.bbox[2]) / 2.0, (self.bbox[1] + self.bbox[3]) / 2.0]

    def set_trajectory(self, points: List[Tuple[float, float]]):
        self.history = deque(points, maxlen=30)


# ==============================================================================
# EXISTING TESTS (Updated where confirmation state machine API requires it)
# ==============================================================================

def test_iou_calculation():
    box1 = [0, 0, 10, 10]
    box2 = [0, 0, 10, 10]
    assert calculate_iou(box1, box2) == 1.0

    box3 = [20, 20, 30, 30]
    assert calculate_iou(box1, box3) == 0.0

    # 50% overlap: intersection is 5x10 = 50, union is 100 + 100 - 50 = 150 -> 1/3
    box4 = [5, 0, 15, 10]
    assert pytest.approx(calculate_iou(box1, box4), 0.01) == 0.333


def test_containment_calculation():
    # Vehicle inside larger accident box
    vehicle_box = [2, 2, 8, 8]  # area = 6x6 = 36
    accident_box = [0, 0, 10, 10]  # area = 100
    assert calculate_containment(vehicle_box, accident_box) == 1.0

    # 50% of vehicle inside accident box
    vehicle_box2 = [5, 0, 15, 10]
    assert pytest.approx(calculate_containment(vehicle_box2, accident_box), 0.01) == 0.50

    # Non-overlapping
    outside_box = [20, 20, 30, 30]
    assert calculate_containment(outside_box, accident_box) == 0.0


def test_accident_persistence_temporary_loss():
    # Updated API note: pass confirm_hits=1 so zone confirms to ACTIVE on frame 1,
    # directly testing the temporary loss (MAINTAINED) and recovery lifecycle.
    mgr = AccidentPersistenceManager(persistence_frames=3, iou_match_threshold=0.3, confirm_hits=1)

    # Frame 1: Detection present -> confirmed ACTIVE
    dets_f1 = [{"bbox": [100.0, 100.0, 200.0, 200.0], "conf": 0.85, "class_name": "accident"}]
    zones_f1 = mgr.update(dets_f1)
    assert len(zones_f1) == 1
    assert zones_f1[0].status == "ACTIVE"
    assert zones_f1[0].lost_frames == 0

    # Frame 2: Missed detection (temporary loss frame 1 -> MAINTAINED)
    zones_f2 = mgr.update([])
    assert len(zones_f2) == 1
    assert zones_f2[0].status == "MAINTAINED"
    assert zones_f2[0].lost_frames == 1

    # Frame 3: Missed detection (temporary loss frame 2 -> MAINTAINED)
    zones_f3 = mgr.update([])
    assert len(zones_f3) == 1
    assert zones_f3[0].status == "MAINTAINED"
    assert zones_f3[0].lost_frames == 2

    # Frame 4: Redetected before expiry! Returns to ACTIVE
    dets_f4 = [{"bbox": [102.0, 98.0, 201.0, 199.0], "conf": 0.88, "class_name": "accident"}]
    zones_f4 = mgr.update(dets_f4)
    assert len(zones_f4) == 1
    assert zones_f4[0].status == "ACTIVE"
    assert zones_f4[0].lost_frames == 0


def test_accident_expires_after_max_loss_frames():
    # Updated API note: pass confirm_hits=1 so zone is confirmed ACTIVE on frame 1.
    mgr = AccidentPersistenceManager(persistence_frames=2, iou_match_threshold=0.3, confirm_hits=1)

    # Frame 1: Detected & Confirmed
    mgr.update([{"bbox": [50.0, 50.0, 150.0, 150.0], "conf": 0.90, "class_name": "accident"}])

    # Lost 1 frame -> maintained
    z1 = mgr.update([])
    assert len(z1) == 1
    assert z1[0].lost_frames == 1

    # Lost 2 frames -> maintained
    z2 = mgr.update([])
    assert len(z2) == 1
    assert z2[0].lost_frames == 2

    # Lost 3 frames (> persistence_frames 2) -> expired and purged!
    z3 = mgr.update([])
    assert len(z3) == 0


def test_suppress_vehicles_in_accidents():
    accident = AccidentZone(
        zone_id=1,
        bbox=[100.0, 100.0, 300.0, 300.0],
        conf=0.92,
        status="ACTIVE",
    )

    # Vehicle 1: Completely inside accident wreckage
    v1 = DummyVehicle(track_id=10, bbox=[120.0, 120.0, 180.0, 180.0])
    # Vehicle 2: Safely passing by in another lane
    v2 = DummyVehicle(track_id=11, bbox=[500.0, 500.0, 600.0, 600.0])

    vehicles = [v1, v2]
    suppressed_vehicles, updated_accidents = suppress_vehicles_in_accidents(
        vehicles=vehicles,
        accident_zones=[accident],
        containment_threshold=0.50,
        iou_threshold=0.30,
    )

    assert v1.is_suppressed is True
    assert v1.accident_id == 1
    assert 10 in accident.involved_vehicle_ids

    assert v2.is_suppressed is False
    assert v2.accident_id is None
    assert 11 not in accident.involved_vehicle_ids


def test_detect_vehicle_collisions_no_overlap():
    v1 = DummyVehicle(track_id=1, bbox=[0, 0, 50, 50])
    v1.set_trajectory([(25, 25), (25, 26), (25, 27)])
    v2 = DummyVehicle(track_id=2, bbox=[200, 200, 250, 250])
    v2.set_trajectory([(225, 225), (225, 226), (225, 227)])

    detector = VehicleCollisionDetector()
    cols = detector.detect([v1, v2])
    assert len(cols) == 0


def test_detect_vehicle_collisions_overlapping():
    # Updated API note: Under gated kinematics, provide required consecutive overlap frames (min_overlap_frames=1)
    # and kinematic deceleration cue to test candidate generation under the gated heuristic.
    detector = VehicleCollisionDetector(min_overlap_frames=1, deceleration_threshold=50.0)

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 160, 160])
    # v1 decelerates sharply from 150 px/s to 0 px/s (at 30 fps: step drops from 5px to 0px)
    v1.set_trajectory([(100, 130), (105, 130), (110, 130), (110, 130)])

    v2 = DummyVehicle(track_id=2, bbox=[120, 100, 180, 160])
    # v2 moving toward v1
    v2.set_trajectory([(180, 130), (170, 130), (160, 130), (150, 130)])

    cols = detector.detect([v1, v2], fps=30.0)
    assert len(cols) == 1
    assert cols[0]["class_name"] == "collision"
    assert 1 in cols[0]["vehicle_ids"]
    assert 2 in cols[0]["vehicle_ids"]


def test_package_exports():
    import src
    expected_exports = [
        "DualDetector",
        "VehicleTracker",
        "TrackedVehicle",
        "AccidentZone",
        "AccidentPersistenceManager",
        "calculate_iou",
        "calculate_containment",
        "suppress_vehicles_in_accidents",
        "detect_vehicle_collisions",
        "VehicleCollisionDetector",
        "resolve_fps",
        "seconds_to_frames",
        "Visualizer",
    ]
    for item in expected_exports:
        assert hasattr(src, item), f"Missing public export: {item}"


# ==============================================================================
# NEW TESTS (Required Section E)
# ==============================================================================

def test_single_frame_detection_never_appears_in_confirmed_zones():
    """1. A single-frame detection never appears in confirmed_zones()."""
    mgr = AccidentPersistenceManager(confirm_hits=5, confirm_window=8)
    det = [{"bbox": [100.0, 100.0, 200.0, 200.0], "conf": 0.90, "class_name": "accident"}]

    confirmed = mgr.update(det)
    assert len(confirmed) == 0
    assert len(mgr.confirmed_zones()) == 0

    # Zone exists in tracking manager as TENTATIVE only
    all_z = mgr.all_zones()
    assert len(all_z) == 1
    assert all_z[0].status == "TENTATIVE"


def test_n_hits_within_window_confirms_zone_and_on_confirm_fires_once():
    """2. N hits within the window confirm the zone, and on_confirm fires exactly once."""
    confirm_count = 0
    confirmed_zone_ids = []

    def on_confirm_callback(zone: AccidentZone):
        nonlocal confirm_count
        confirm_count += 1
        confirmed_zone_ids.append(zone.zone_id)

    mgr = AccidentPersistenceManager(
        confirm_hits=3,
        confirm_window=5,
        on_confirm=on_confirm_callback,
    )
    det = [{"bbox": [100.0, 100.0, 200.0, 200.0], "conf": 0.85, "class_name": "accident"}]

    # Hit 1 -> TENTATIVE
    assert len(mgr.update(det)) == 0
    assert confirm_count == 0

    # Hit 2 -> TENTATIVE
    assert len(mgr.update(det)) == 0
    assert confirm_count == 0

    # Hit 3 (3rd hit in window of 5) -> Confirmed ACTIVE!
    c3 = mgr.update(det)
    assert len(c3) == 1
    assert c3[0].status == "ACTIVE"
    assert confirm_count == 1
    assert confirmed_zone_ids == [1]

    # Hit 4 -> Remains ACTIVE, on_confirm must NOT fire again
    c4 = mgr.update(det)
    assert len(c4) == 1
    assert c4[0].status == "ACTIVE"
    assert confirm_count == 1


def test_confirmed_zone_survives_short_gap_recovers_to_active_and_removed_after_timeout():
    """3. A confirmed zone survives a short gap (MAINTAINED), recovers to ACTIVE, and is removed after the timeout."""
    mgr = AccidentPersistenceManager(confirm_hits=2, confirm_window=4, persistence_frames=3)
    det = [{"bbox": [100.0, 100.0, 200.0, 200.0], "conf": 0.85, "class_name": "accident"}]

    # Confirm zone (2 hits)
    mgr.update(det)
    c = mgr.update(det)
    assert len(c) == 1
    assert c[0].status == "ACTIVE"

    # Gap 1: Missed detection -> MAINTAINED
    g1 = mgr.update([])
    assert len(g1) == 1
    assert g1[0].status == "MAINTAINED"
    assert g1[0].lost_frames == 1

    # Gap 2: Missed detection -> MAINTAINED
    g2 = mgr.update([])
    assert len(g2) == 1
    assert g2[0].status == "MAINTAINED"
    assert g2[0].lost_frames == 2

    # Redetection: recovers to ACTIVE!
    rec = mgr.update(det)
    assert len(rec) == 1
    assert rec[0].status == "ACTIVE"
    assert rec[0].lost_frames == 0

    # Now drop for 4 consecutive frames (> persistence_frames 3)
    mgr.update([]) # lost 1
    mgr.update([]) # lost 2
    mgr.update([]) # lost 3 (MAINTAINED)
    expired = mgr.update([]) # lost 4 -> removed!
    assert len(expired) == 0
    assert len(mgr.confirmed_zones()) == 0


def test_tentative_zone_deleted_after_grace_period():
    """4. A TENTATIVE zone is deleted after its grace period."""
    mgr = AccidentPersistenceManager(confirm_hits=5, tentative_grace=2)
    det = [{"bbox": [50.0, 50.0, 120.0, 120.0], "conf": 0.75, "class_name": "accident"}]

    # Frame 1: Hit 1 -> TENTATIVE
    mgr.update(det)
    assert len(mgr.all_zones()) == 1
    assert mgr.all_zones()[0].status == "TENTATIVE"

    # Frame 2: Miss 1 (lost_frames=1 <= grace 2)
    mgr.update([])
    assert len(mgr.all_zones()) == 1

    # Frame 3: Miss 2 (lost_frames=2 <= grace 2)
    mgr.update([])
    assert len(mgr.all_zones()) == 1

    # Frame 4: Miss 3 (lost_frames=3 > grace 2) -> Purged immediately!
    mgr.update([])
    assert len(mgr.all_zones()) == 0


def test_seconds_to_frames_conversion_and_fps_fallback():
    """5. 0.5 s converts to 8, 15 and 30 frames at 15, 30 and 60 FPS; FPS 0/NaN falls back to 30."""
    # 0.5s conversions
    assert seconds_to_frames(0.5, 15.0) == 8   # max(1, round(7.5)) = 8
    assert seconds_to_frames(0.5, 30.0) == 15  # max(1, round(15.0)) = 15
    assert seconds_to_frames(0.5, 60.0) == 30  # max(1, round(30.0)) = 30

    # FPS invalid fallbacks
    assert resolve_fps(0) == 30.0
    assert resolve_fps(0.0) == 30.0
    assert resolve_fps(float("nan")) == 30.0
    assert resolve_fps(-10.0) == 30.0
    assert resolve_fps(None) == 30.0
    assert resolve_fps("invalid") == 30.0
    assert resolve_fps(25.0) == 25.0


def test_parallel_similar_speed_overlapping_vehicles_no_collision():
    """6. Parallel, similar-speed overlapping vehicles do NOT produce a collision."""
    detector = VehicleCollisionDetector(min_overlap_frames=3, fps=30.0)

    # Two cars driving alongside each other in parallel lanes at 90 px/s (both heading in +x direction)
    # Their bounding boxes overlap by 30% IoU
    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 160, 140])
    v2 = DummyVehicle(track_id=2, bbox=[130, 105, 190, 145])

    # Feed 5 consecutive overlapping frames with parallel heading and identical speed
    for step in range(5):
        x_base = step * 3.0  # 3px per frame at 30fps = 90 px/s
        v1.bbox = [100 + x_base, 100, 160 + x_base, 140]
        v2.bbox = [130 + x_base, 105, 190 + x_base, 145]
        v1.set_trajectory([(100 + x_base - 3.0, 120), (100 + x_base, 120)])
        v2.set_trajectory([(130 + x_base - 3.0, 125), (130 + x_base, 125)])

        cols = detector.detect([v1, v2], fps=30.0)
        # Must be filtered out by parallel queue / lane merge check
        assert len(cols) == 0, f"False collision detected at step {step} for parallel vehicles!"


def test_converging_decelerating_overlapping_vehicles_produce_collision():
    """7. Converging vehicles that overlap for the required frames, with one sharply decelerating, DO produce a collision."""
    detector = VehicleCollisionDetector(min_overlap_frames=3, deceleration_threshold=100.0, fps=30.0)

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 160, 160])
    v2 = DummyVehicle(track_id=2, bbox=[130, 100, 190, 160])

    # v1 was cruising at 150 px/s (5px/frame at 30fps) and drops abruptly to 0 px/s
    v1.set_trajectory([(85, 130), (95, 130), (100, 130), (100, 130)])
    # v2 is moving toward v1
    v2.set_trajectory([(160, 130), (150, 130), (140, 130), (130, 130)])

    # Frame 1: overlap count = 1 (< min 3)
    cols1 = detector.detect([v1, v2], fps=30.0)
    assert len(cols1) == 0

    # Frame 2: overlap count = 2 (< min 3)
    cols2 = detector.detect([v1, v2], fps=30.0)
    assert len(cols2) == 0

    # Frame 3: overlap count = 3 (>= min 3) with deceleration -> collision detected!
    cols3 = detector.detect([v1, v2], fps=30.0)
    assert len(cols3) == 1
    assert cols3[0]["class_name"] == "collision"
    assert 1 in cols3[0]["vehicle_ids"] and 2 in cols3[0]["vehicle_ids"]


def test_overlap_shorter_than_min_overlap_frames_no_collision():
    """8. Overlap shorter than min_overlap_frames produces no collision."""
    detector = VehicleCollisionDetector(min_overlap_frames=4, fps=30.0)

    v1 = DummyVehicle(track_id=1, bbox=[100, 100, 160, 160])
    v2 = DummyVehicle(track_id=2, bbox=[120, 100, 180, 160])
    v1.set_trajectory([(80, 130), (90, 130), (100, 130), (100, 130)])
    v2.set_trajectory([(160, 130), (150, 130), (140, 130), (130, 130)])

    # Overlap sustained for only 2 frames
    detector.detect([v1, v2], fps=30.0)
    cols = detector.detect([v1, v2], fps=30.0)
    assert len(cols) == 0

    # Separate vehicles
    v2.bbox = [500, 500, 560, 560]
    detector.detect([v1, v2], fps=30.0)

    # Overlap history must be cleared
    assert (1, 2) not in detector.overlap_counts


def test_moving_collision_keeps_same_zone_id_for_same_pair():
    """9. A moving collision union box keeps the same zone ID while the same pair is involved."""
    mgr = AccidentPersistenceManager(confirm_hits=1, iou_match_threshold=0.30)

    # Frame 1: Collision at [100, 100, 200, 200]
    cand1 = {
        "bbox": [100.0, 100.0, 200.0, 200.0],
        "conf": 0.85,
        "vehicle_ids": [10, 20],
        "class_name": "collision",
    }
    zones1 = mgr.update([cand1])
    assert len(zones1) == 1
    initial_zone_id = zones1[0].zone_id

    # Frame 2: Vehicles skid across intersection to [600, 600, 700, 700] (IoU with previous is 0.0!)
    cand2 = {
        "bbox": [600.0, 600.0, 700.0, 700.0],
        "conf": 0.88,
        "vehicle_ids": [10, 20],
        "class_name": "collision",
    }
    zones2 = mgr.update([cand2])
    assert len(zones2) == 1
    # Must preserve the exact same zone_id due to pair matching!
    assert zones2[0].zone_id == initial_zone_id


def test_suppressed_vehicle_still_counted_in_total():
    """10. A suppressed vehicle is still counted in the vehicle total."""
    accident = AccidentZone(
        zone_id=1,
        bbox=[100.0, 100.0, 300.0, 300.0],
        conf=0.90,
        status="ACTIVE",
    )

    v1 = DummyVehicle(track_id=1, bbox=[120, 120, 180, 180]) # inside
    v2 = DummyVehicle(track_id=2, bbox=[500, 500, 600, 600]) # outside
    v3 = DummyVehicle(track_id=3, bbox=[700, 700, 800, 800]) # outside

    all_vehicles = [v1, v2, v3]
    suppressed, confirmed_zones = suppress_vehicles_in_accidents(all_vehicles, [accident])

    # Visual suppression flags are set
    assert v1.is_suppressed is True
    assert v2.is_suppressed is False
    assert v3.is_suppressed is False

    # Total vehicle count is completely preserved (all 3 remain in tracked vehicle list)
    assert len(suppressed) == 3
    assert {v.track_id for v in suppressed} == {1, 2, 3}


def test_involved_vehicle_ids_does_not_retain_departed_vehicles():
    """11. involved_vehicle_ids does not retain vehicles that have left."""
    accident = AccidentZone(
        zone_id=1,
        bbox=[100.0, 100.0, 300.0, 300.0],
        conf=0.90,
        status="ACTIVE",
    )

    v1 = DummyVehicle(track_id=42, bbox=[120.0, 120.0, 180.0, 180.0])

    # Frame 1: v1 is inside accident zone
    suppress_vehicles_in_accidents([v1], [accident])
    assert accident.involved_vehicle_ids == [42]
    assert 42 in accident.ever_involved_vehicle_ids

    # Frame 2: v1 drives away out of zone
    v1.bbox = [700.0, 700.0, 800.0, 800.0]
    suppress_vehicles_in_accidents([v1], [accident])

    # active involved_vehicle_ids is pruned!
    assert accident.involved_vehicle_ids == []
    # ever_involved_vehicle_ids retains historical involvement!
    assert 42 in accident.ever_involved_vehicle_ids
