import os
import tempfile
import pytest
import numpy as np
from collections import deque

from src.calibration import HomographyCalibrator, load_camera_calibration
from src.tracker import TrackedVehicle
from src.accident_logic import VehicleCollisionDetector


class DummyVehicle:
    """Mock vehicle for testing calibration, kinematics, and collision detection."""
    def __init__(
        self,
        track_id: int,
        bbox: list,
        speed_kmh: float = None,
        speed_px_s: float = 0.0,
        ground_history=None,
        speed_history_kmh=None,
    ):
        self.track_id = track_id
        self.bbox = bbox
        self.conf = 0.90
        self.class_name = "car"
        self.is_suppressed = False
        self.accident_id = None
        self.speed_kmh = speed_kmh
        self.speed_px_s = speed_px_s
        self.history = deque([( (bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2 )], maxlen=30)
        self.ground_history = deque(ground_history or [], maxlen=30)
        self.speed_history_kmh = deque(speed_history_kmh or ([speed_kmh] if speed_kmh is not None else []), maxlen=5)

    @property
    def centroid(self):
        return [(self.bbox[0] + self.bbox[2]) / 2.0, (self.bbox[1] + self.bbox[3]) / 2.0]

    @property
    def bottom_center(self):
        return [(self.bbox[0] + self.bbox[2]) / 2.0, self.bbox[3]]


def test_synthetic_homography_and_speed_calculation():
    """
    Test synthetic homography where road dimensions and vehicle ground velocity are known.
    Image quad: (100, 100), (300, 100), (300, 500), (100, 500)
    Ground quad: (0, 0), (10, 0), (10, 40), (0, 40) in meters.
    True scale:
      X: 200 px = 10 m -> 0.05 m/px
      Y: 400 px = 40 m -> 0.10 m/px
    """
    image_points = [[100.0, 100.0], [300.0, 100.0], [300.0, 500.0], [100.0, 500.0]]
    ground_points = [[0.0, 0.0], [10.0, 0.0], [10.0, 40.0], [0.0, 40.0]]

    calibrator = HomographyCalibrator("synthetic_cam", image_points, ground_points)

    # 1. Test corner transformation parity
    for ipt, gpt in zip(image_points, ground_points):
        gx, gy = calibrator.transform_point(ipt[0], ipt[1])
        assert pytest.approx(gx, abs=1e-3) == gpt[0]
        assert pytest.approx(gy, abs=1e-3) == gpt[1]

    # 2. Test bottom-center transformation
    # Bounding box: x1=180, y1=200, x2=220, y2=300
    # bottom_center = ((180+220)/2, 300) = (200, 300)
    # Expected ground: x = 0 + (200 - 100) * 0.05 = 5.0m
    # Expected ground: y = 0 + (300 - 100) * 0.10 = 20.0m
    bbox = [180.0, 200.0, 220.0, 300.0]
    bc_gx, bc_gy = calibrator.transform_bottom_center(bbox)
    assert pytest.approx(bc_gx, abs=1e-3) == 5.0
    assert pytest.approx(bc_gy, abs=1e-3) == 20.0

    # 3. Test speed calculation:
    # Vehicle travels 20 meters in 1.0 second (from y=10m to y=30m)
    # 20 m/s = 72.0 km/h
    p1 = (5.0, 10.0)
    p2 = (5.0, 30.0)
    speed_kmh = calibrator.compute_speed_kmh(p1, p2, dt_seconds=1.0)
    assert pytest.approx(speed_kmh, abs=1e-2) == 72.0

    # Frame-by-frame at 30 FPS: dt = 1/30 s
    # In 1 frame, distance traveled = 20 / 30 = 0.66667 m
    p3 = (5.0, 10.0 + (20.0 / 30.0))
    speed_f_kmh = calibrator.compute_speed_kmh(p1, p3, dt_seconds=1.0 / 30.0)
    assert pytest.approx(speed_f_kmh, abs=1e-2) == 72.0


def test_tracked_vehicle_ground_tracking():
    """Verify TrackedVehicle properly tracks bottom-center and ground coordinates."""
    v = TrackedVehicle(
        track_id=1,
        bbox=[100.0, 100.0, 200.0, 250.0],
        conf=0.92,
        class_id=2,
        class_name="car",
    )
    assert v.centroid == [150.0, 175.0]
    assert v.bottom_center == [150.0, 250.0]
    assert v.speed_kmh is None

    v.update_ground_position(5.2, 14.8)
    assert len(v.ground_history) == 1
    assert v.ground_history[-1] == (5.2, 14.8)


def test_calibrated_deceleration_detection():
    """
    Verify VehicleCollisionDetector detects deceleration in km/h when calibrated,
    and respects configurable deceleration_threshold_kmh.
    """
    calibrator = HomographyCalibrator(
        "test_cam",
        [[0, 0], [100, 0], [100, 100], [0, 100]],
        [[0, 0], [10, 0], [10, 10], [0, 10]],
    )
    detector = VehicleCollisionDetector(
        deceleration_threshold_kmh=35.0,
        min_overlap_frames=1,
        iou_collision_threshold=0.1,
        calibrator=calibrator,
    )

    # v1 decelerates sharply: 80 km/h -> 25 km/h (drop = 55 km/h >= 35 km/h threshold)
    # Both vehicles overlap spatially
    v1 = DummyVehicle(
        track_id=1,
        bbox=[100.0, 100.0, 200.0, 200.0],
        speed_kmh=25.0,
        ground_history=[(5.0, 10.0), (5.0, 10.5)],
        speed_history_kmh=[80.0, 25.0],
    )
    v2 = DummyVehicle(
        track_id=2,
        bbox=[120.0, 120.0, 220.0, 220.0],
        speed_kmh=60.0,
        ground_history=[(6.0, 9.0), (6.0, 9.8)],
        speed_history_kmh=[60.0, 60.0],
    )

    cols = detector.detect([v1, v2], fps=30.0)
    assert len(cols) == 1
    assert set(cols[0]["vehicle_ids"]) == {1, 2}

    # Now test with sub-threshold deceleration (80 km/h -> 70 km/h, drop = 10 km/h < 35 km/h)
    detector.reset()
    v1_gentle = DummyVehicle(
        track_id=1,
        bbox=[100.0, 100.0, 200.0, 200.0],
        speed_kmh=70.0,
        ground_history=[(5.0, 10.0), (5.0, 10.8)],
        speed_history_kmh=[80.0, 70.0],
    )
    cols_gentle = detector.detect([v1_gentle, v2], fps=30.0)
    # Parallel motion without sharp deceleration should be excluded
    assert len(cols_gentle) == 0


def test_uncalibrated_camera_fallback():
    """
    Verify that if camera is uncalibrated (calibrator is None),
    speed remains pixel-based and collision detection uses deceleration_threshold (px/s).
    """
    detector = VehicleCollisionDetector(
        deceleration_threshold=120.0,
        min_overlap_frames=1,
        iou_collision_threshold=0.1,
        calibrator=None,
    )

    # v1 decelerates sharply in pixels/sec: from 300 px/s to 50 px/s (drop = 250 px/s >= 120 px/s)
    # History with 3 points at 30 fps
    pts_v1 = [(100.0, 100.0), (100.0, 110.0), (100.0, 111.67)] # prev dx=10 px/f = 300 px/s, curr dx=1.67 px/f = 50 px/s
    v1 = DummyVehicle(
        track_id=1,
        bbox=[100.0, 100.0, 200.0, 200.0],
        speed_kmh=None,
    )
    v1.history = deque(pts_v1, maxlen=30)

    pts_v2 = [(120.0, 100.0), (120.0, 105.0), (120.0, 110.0)]
    v2 = DummyVehicle(
        track_id=2,
        bbox=[120.0, 110.0, 220.0, 210.0],
        speed_kmh=None,
    )
    v2.history = deque(pts_v2, maxlen=30)

    cols = detector.detect([v1, v2], fps=30.0)
    assert len(cols) == 1
    assert set(cols[0]["vehicle_ids"]) == {1, 2}


def test_calibration_serialization_and_disk_roundtrip():
    """Verify calibration saves and reloads perfectly from JSON file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        calib_path = os.path.join(tmpdir, "test_cam.json")
        img_pts = [[10.0, 20.0], [110.0, 25.0], [120.0, 150.0], [15.0, 140.0]]
        gnd_pts = [[0.0, 0.0], [5.0, 0.0], [5.0, 20.0], [0.0, 20.0]]

        c1 = HomographyCalibrator("test_cam", img_pts, gnd_pts)
        c1.save(calib_path)

        c2 = HomographyCalibrator.from_file(calib_path)
        assert c2.camera_id == "test_cam"
        assert np.allclose(c1.matrix, c2.matrix)

        # Transform arbitrary point and assert match
        p1 = c1.transform_point(50.0, 60.0)
        p2 = c2.transform_point(50.0, 60.0)
        assert pytest.approx(p1[0], abs=1e-4) == p2[0]
        assert pytest.approx(p1[1], abs=1e-4) == p2[1]

        # Test load_camera_calibration helper
        c3 = load_camera_calibration("test_cam", calibration_dir=tmpdir)
        assert c3 is not None
        assert np.allclose(c3.matrix, c1.matrix)

        # Test non-existent camera returns None
        assert load_camera_calibration("non_existent", calibration_dir=tmpdir) is None


def test_invalid_calibration_points():
    """Verify degenerate/collinear points raise ValueError."""
    # Collinear points
    collinear_img = [[0.0, 0.0], [10.0, 10.0], [20.0, 20.0], [30.0, 30.0]]
    gnd = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
    with pytest.raises(ValueError, match="invalid"):
        HomographyCalibrator("bad_cam", collinear_img, gnd)

    # Wrong number of points
    with pytest.raises(ValueError, match="Expected exactly 4"):
        HomographyCalibrator("bad_cam", [[0, 0], [1, 1]], [[0, 0], [1, 1]])
