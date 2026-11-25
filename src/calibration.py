"""
Homography Camera Calibration & Real-World Speed Estimation.
Transforms image pixel coordinates to road-plane ground coordinates (in meters),
enabling metric speed (km/h) and real-world deceleration thresholding.
"""
from typing import List, Tuple, Dict, Any, Optional
import os
import json
import logging
import numpy as np
import cv2

logger = logging.getLogger("TrafficMonitor.Calibration")


class HomographyCalibrator:
    """
    Computes and manages perspective projection between camera image plane and road ground plane.
    Uses 4 coplanar road-plane points to derive a 3x3 homography matrix H such that:
        [X, Y, W]^T = H * [u, v, 1]^T
        x_ground = X / W, y_ground = Y / W (in meters)
    """

    def __init__(
        self,
        camera_id: str,
        image_points: List[List[float]],
        ground_points: List[List[float]],
        matrix: Optional[List[List[float]]] = None,
    ):
        self.camera_id = camera_id
        self.image_points = [[float(p[0]), float(p[1])] for p in image_points]
        self.ground_points = [[float(p[0]), float(p[1])] for p in ground_points]

        if len(self.image_points) != 4 or len(self.ground_points) != 4:
            raise ValueError(
                f"Expected exactly 4 image points and 4 ground points, got "
                f"{len(self.image_points)} and {len(self.ground_points)}"
            )

        if matrix is not None:
            self.matrix = np.array(matrix, dtype=np.float64)
        else:
            src = np.array(self.image_points, dtype=np.float32)
            dst = np.array(self.ground_points, dtype=np.float32)
            self.matrix = cv2.getPerspectiveTransform(src, dst)

        if (
            self.matrix is None
            or np.isnan(self.matrix).any()
            or np.isinf(self.matrix).any()
            or abs(float(np.linalg.det(self.matrix))) < 1e-8
        ):
            raise ValueError("Computed homography matrix is invalid (collinear or degenerate points).")

    def transform_point(self, x: float, y: float) -> Tuple[float, float]:
        """
        Transforms an image point (x, y) in pixels to ground plane (gx, gy) in meters.
        """
        pt = np.array([[[x, y]]], dtype=np.float32)
        dst = cv2.perspectiveTransform(pt, self.matrix)
        gx, gy = dst[0][0]
        return float(gx), float(gy)

    def transform_bottom_center(self, bbox: List[float]) -> Tuple[float, float]:
        """
        Computes bottom-center of bounding box [(x1 + x2)/2, y2] and transforms to ground plane.
        The bottom-center is the best single-point proxy for vehicle road contact.
        """
        bc_x = (bbox[0] + bbox[2]) / 2.0
        bc_y = bbox[3]
        return self.transform_point(bc_x, bc_y)

    def compute_speed_kmh(
        self,
        p1_ground: Tuple[float, float],
        p2_ground: Tuple[float, float],
        dt_seconds: float,
    ) -> float:
        """
        Calculates speed in km/h between two ground points separated by dt_seconds.
        """
        if dt_seconds <= 0:
            return 0.0
        dx = p2_ground[0] - p1_ground[0]
        dy = p2_ground[1] - p1_ground[1]
        dist_m = float(np.hypot(dx, dy))
        speed_m_s = dist_m / dt_seconds
        return speed_m_s * 3.6

    def to_dict(self) -> Dict[str, Any]:
        """Serialize calibration metadata and matrix."""
        return {
            "camera_id": self.camera_id,
            "image_points": self.image_points,
            "ground_points": self.ground_points,
            "matrix": self.matrix.tolist(),
        }

    def save(self, filepath: str):
        """Save calibration to JSON file."""
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
        logger.info(f"Saved camera calibration for '{self.camera_id}' to {filepath}")

    @classmethod
    def from_file(cls, filepath: str) -> "HomographyCalibrator":
        """Load calibration from JSON file."""
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(
            camera_id=data["camera_id"],
            image_points=data["image_points"],
            ground_points=data["ground_points"],
            matrix=data.get("matrix"),
        )


def load_camera_calibration(
    camera_id: str,
    calibration_dir: str = "calibration",
) -> Optional[HomographyCalibrator]:
    """
    Attempt to load calibration for a given camera_id from calibration/<camera_id>.json.
    Returns None if file does not exist or fails to load.
    """
    path = os.path.join(calibration_dir, f"{camera_id}.json")
    if os.path.exists(path):
        try:
            return HomographyCalibrator.from_file(path)
        except Exception as e:
            logger.warning(f"Failed to load calibration for '{camera_id}' from {path}: {e}")
            return None
    return None
