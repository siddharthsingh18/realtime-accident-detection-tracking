import logging
from typing import List, Dict, Any, Optional
from collections import deque
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("TrafficMonitor.Tracker")


class TrackedVehicle:
    """
    Data structure representing a vehicle tracked across frames.
    Maintains centroid history (pixels) and ground position history (meters) when calibrated.
    """
    def __init__(
        self,
        track_id: int,
        bbox: List[float],
        conf: float,
        class_id: int,
        class_name: str,
        max_history: int = 30,
    ):
        self.track_id = track_id
        self.bbox = bbox  # [x1, y1, x2, y2]
        self.conf = conf
        self.class_id = class_id
        self.class_name = class_name
        self.is_suppressed = False
        self.accident_id: Optional[int] = None
        self.history: deque = deque(maxlen=max_history)
        self.ground_history: deque = deque(maxlen=max_history)
        self.speed_history_kmh: deque = deque(maxlen=5)
        self.speed_px_s: float = 0.0
        self.speed_kmh: Optional[float] = None
        self.update_centroid(bbox)

    @property
    def centroid(self) -> List[float]:
        x1, y1, x2, y2 = self.bbox
        return [(x1 + x2) / 2.0, (y1 + y2) / 2.0]

    @property
    def bottom_center(self) -> List[float]:
        """Bottom-center point of bounding box on the road surface."""
        x1, y1, x2, y2 = self.bbox
        return [(x1 + x2) / 2.0, y2]

    def update_centroid(self, bbox: List[float]):
        self.bbox = bbox
        self.history.append(self.centroid)

    def update_ground_position(self, gx: float, gy: float):
        self.ground_history.append((gx, gy))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "track_id": self.track_id,
            "bbox": self.bbox,
            "conf": self.conf,
            "class_id": self.class_id,
            "class_name": self.class_name,
            "is_suppressed": self.is_suppressed,
            "accident_id": self.accident_id,
            "centroid": self.centroid,
            "bottom_center": self.bottom_center,
            "speed_px_s": self.speed_px_s,
            "speed_kmh": self.speed_kmh,
        }


class VehicleTracker:
    """
    Tracks vehicles using BoT-SORT algorithm integrated with YOLO11n.
    Maintains persistent IDs and track histories across video frames.
    Computes speed in pixels/s and, when a HomographyCalibrator is provided, in km/h.
    """

    def __init__(
        self,
        vehicle_model: YOLO,
        tracker_type: str = "botsort.yaml",
        conf: float = 0.35,
        iou: float = 0.50,
        classes: Optional[List[int]] = None,
        device: str = "cpu",
        max_history: int = 30,
        calibrator: Optional[Any] = None,
        fps: float = 30.0,
    ):
        self.model = vehicle_model
        self.tracker_type = tracker_type
        self.conf = conf
        self.iou = iou
        self.classes = classes
        self.device = device
        self.max_history = max_history
        self.calibrator = calibrator
        self.fps = fps

        # Active tracks dictionary: track_id -> TrackedVehicle
        self.active_tracks: Dict[int, TrackedVehicle] = {}

    def update(self, frame: np.ndarray, fps: Optional[float] = None) -> List[TrackedVehicle]:
        """
        Runs BoT-SORT tracking on the current frame.
        Computes vehicle speed in pixels/sec and km/h (if calibrated).
        Returns a list of currently active TrackedVehicle objects.
        """
        effective_fps = fps if fps is not None and fps > 0 else self.fps
        dt = 1.0 / effective_fps if effective_fps > 0 else (1.0 / 30.0)

        results = self.model.track(
            source=frame,
            persist=True,
            tracker=self.tracker_type,
            conf=self.conf,
            iou=self.iou,
            classes=self.classes,
            device=self.device,
            verbose=False,
        )

        current_frame_tracks: List[TrackedVehicle] = []
        if not results or len(results) == 0:
            return current_frame_tracks

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return current_frame_tracks

        # Check if tracking IDs are available
        has_ids = boxes.id is not None
        track_ids = (
            boxes.id.int().cpu().tolist() if has_ids else list(range(len(boxes)))
        )

        for i, box in enumerate(boxes):
            track_id = int(track_ids[i])
            xyxy = box.xyxy[0].cpu().numpy().tolist()
            conf = float(box.conf[0].cpu().numpy())
            cls_id = int(box.cls[0].cpu().numpy())
            cls_name = self.model.names.get(cls_id, f"vehicle_{cls_id}")

            if track_id in self.active_tracks:
                vehicle = self.active_tracks[track_id]
                vehicle.update_centroid(xyxy)
                vehicle.conf = conf
                vehicle.is_suppressed = False  # Reset each frame before spatial logic
                vehicle.accident_id = None
            else:
                vehicle = TrackedVehicle(
                    track_id=track_id,
                    bbox=xyxy,
                    conf=conf,
                    class_id=cls_id,
                    class_name=cls_name,
                    max_history=self.max_history,
                )
                self.active_tracks[track_id] = vehicle

            # 1. Pixel-based speed calculation (fallback / uncalibrated)
            if len(vehicle.history) >= 2:
                pts = list(vehicle.history)
                dx = pts[-1][0] - pts[-2][0]
                dy = pts[-1][1] - pts[-2][1]
                vehicle.speed_px_s = float(np.hypot(dx, dy) * effective_fps)
            else:
                vehicle.speed_px_s = 0.0

            # 2. Metric speed in km/h if camera is calibrated
            if self.calibrator is not None:
                try:
                    gx, gy = self.calibrator.transform_bottom_center(xyxy)
                    vehicle.update_ground_position(gx, gy)
                    if len(vehicle.ground_history) >= 2:
                        g_pts = list(vehicle.ground_history)
                        raw_speed_kmh = self.calibrator.compute_speed_kmh(g_pts[-2], g_pts[-1], dt)
                        vehicle.speed_history_kmh.append(raw_speed_kmh)
                        # Smooth speed using median of recent frames to reduce detector jitter
                        vehicle.speed_kmh = float(np.median(vehicle.speed_history_kmh))
                    else:
                        vehicle.speed_kmh = 0.0
                except Exception as e:
                    logger.debug(f"Failed to compute ground coordinates for track #{track_id}: {e}")
                    vehicle.speed_kmh = None
            else:
                vehicle.speed_kmh = None

            current_frame_tracks.append(vehicle)

        # Cleanup tracks that haven't been seen for a long time (retain active set)
        current_ids = set(track_ids)
        stale_ids = [tid for tid in self.active_tracks if tid not in current_ids]
        for tid in stale_ids:
            del self.active_tracks[tid]

        return current_frame_tracks

    def reset(self):
        """Reset all tracked state."""
        self.active_tracks.clear()
