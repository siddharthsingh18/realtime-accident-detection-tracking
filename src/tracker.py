import os
import logging
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import deque
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("TrafficMonitor.Tracker")


def _box_iou(box1: List[float], box2: List[float]) -> float:
    """Helper IoU computation for vehicle pair proximity checking."""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    w = max(0.0, x2 - x1)
    h = max(0.0, y2 - y1)
    inter = w * h
    if inter <= 0.0:
        return 0.0
    a1 = max(0.0, box1[2] - box1[0]) * max(0.0, box1[3] - box1[1])
    a2 = max(0.0, box2[2] - box2[0]) * max(0.0, box2[3] - box2[1])
    union = a1 + a2 - inter
    return inter / union if union > 0.0 else 0.0


class TrackedVehicle:
    """
    Data structure representing a vehicle tracked across frames.
    Maintains centroid history (pixels) and ground position history (meters) when calibrated.
    Also tracks lifetime motion metrics (max speed, abrupt deceleration/heading, prior contacts)
    for static-wreck false-alarm filtering.
    """
    def __init__(
        self,
        track_id: int,
        bbox: List[float],
        conf: float,
        class_id: int,
        class_name: str,
        max_history: int = 150,
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

        # Lifetime kinematics & history metrics for static-wreck filtering
        self.total_frames_seen: int = 1
        self.first_frame_idx: Optional[int] = None
        self.max_speed_px_s: float = 0.0
        self.max_speed_kmh: Optional[float] = None
        self.last_significant_movement_frame: int = 0
        self.had_abrupt_deceleration: bool = False
        self.had_abrupt_heading_change: bool = False
        self.had_prior_overlap_or_contact: bool = False
        self.interacting_track_ids: Set[int] = set()
        self.recent_headings: deque = deque(maxlen=10)

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
            "total_frames_seen": self.total_frames_seen,
            "max_speed_px_s": self.max_speed_px_s,
            "max_speed_kmh": self.max_speed_kmh,
            "had_abrupt_deceleration": self.had_abrupt_deceleration,
            "had_abrupt_heading_change": self.had_abrupt_heading_change,
            "had_prior_overlap_or_contact": self.had_prior_overlap_or_contact,
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
        max_history: int = 150,
        calibrator: Optional[Any] = None,
        fps: float = 30.0,
        imgsz: int = 640,
        with_reid: bool = False,
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
        self.imgsz = imgsz
        self.with_reid = with_reid

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

        # Select tracker config based on ReID flag
        tracker_cfg = (
            "config/trackers/botsort_reid.yaml"
            if self.with_reid and os.path.exists("config/trackers/botsort_reid.yaml")
            else self.tracker_type
        )

        results = self.model.track(
            source=frame,
            persist=True,
            tracker=tracker_cfg,
            conf=self.conf,
            iou=self.iou,
            classes=self.classes,
            device=self.device,
            imgsz=self.imgsz,
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
                vehicle.total_frames_seen += 1
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

            prev_speed_px = vehicle.speed_px_s
            prev_speed_kmh = vehicle.speed_kmh

            # 1. Pixel-based speed calculation (fallback / uncalibrated)
            if len(vehicle.history) >= 2:
                pts = list(vehicle.history)
                dx = pts[-1][0] - pts[-2][0]
                dy = pts[-1][1] - pts[-2][1]
                inst_speed_px = float(np.hypot(dx, dy) * effective_fps)
                vehicle.speed_px_s = inst_speed_px

                # Heading analysis if moving with meaningful speed (> 10 px/s)
                if inst_speed_px > 10.0:
                    curr_heading = float(np.arctan2(dy, dx))
                    if len(vehicle.recent_headings) >= 1:
                        prev_heading = vehicle.recent_headings[-1]
                        angle_diff = abs(curr_heading - prev_heading)
                        angle_diff = min(angle_diff, 2 * np.pi - angle_diff)
                        # Sharp heading deviation >= 45 degrees (0.785 rad)
                        if angle_diff >= 0.785:
                            vehicle.had_abrupt_heading_change = True
                    vehicle.recent_headings.append(curr_heading)

                # Check abrupt pixel deceleration (e.g. was moving > 35 px/s and dropped suddenly)
                if prev_speed_px > 35.0 and (prev_speed_px - inst_speed_px) >= 25.0:
                    vehicle.had_abrupt_deceleration = True
            else:
                vehicle.speed_px_s = 0.0

            # Update lifetime peak pixel speed
            if vehicle.speed_px_s > vehicle.max_speed_px_s:
                vehicle.max_speed_px_s = vehicle.speed_px_s

            if vehicle.speed_px_s > 12.0:
                vehicle.last_significant_movement_frame = vehicle.total_frames_seen

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

                        # Check metric deceleration (e.g. was moving > 15 km/h and dropped by > 12 km/h in 1 frame)
                        if prev_speed_kmh is not None and prev_speed_kmh > 15.0 and (prev_speed_kmh - vehicle.speed_kmh) >= 12.0:
                            vehicle.had_abrupt_deceleration = True

                        if vehicle.max_speed_kmh is None or vehicle.speed_kmh > vehicle.max_speed_kmh:
                            vehicle.max_speed_kmh = vehicle.speed_kmh

                        if vehicle.speed_kmh > 3.0:
                            vehicle.last_significant_movement_frame = vehicle.total_frames_seen
                    else:
                        vehicle.speed_kmh = 0.0
                except Exception as e:
                    logger.debug(f"Failed to compute ground coordinates for track #{track_id}: {e}")
                    vehicle.speed_kmh = None
            else:
                vehicle.speed_kmh = None

            current_frame_tracks.append(vehicle)

        # 3. Inter-vehicle proximity & overlap detection
        n_tracks = len(current_frame_tracks)
        for i in range(n_tracks):
            v_i = current_frame_tracks[i]
            for j in range(i + 1, n_tracks):
                v_j = current_frame_tracks[j]
                iou_val = _box_iou(v_i.bbox, v_j.bbox)
                is_contact = False
                if iou_val > 0.05:
                    is_contact = True
                elif self.calibrator is not None and len(v_i.ground_history) and len(v_j.ground_history):
                    g_dist = float(np.hypot(
                        v_i.ground_history[-1][0] - v_j.ground_history[-1][0],
                        v_i.ground_history[-1][1] - v_j.ground_history[-1][1],
                    ))
                    if g_dist < 2.5:
                        is_contact = True

                if is_contact:
                    v_i.had_prior_overlap_or_contact = True
                    v_j.had_prior_overlap_or_contact = True
                    v_i.interacting_track_ids.add(v_j.track_id)
                    v_j.interacting_track_ids.add(v_i.track_id)

        # Cleanup tracks that haven't been seen for a long time (retain active set)
        current_ids = set(track_ids)
        stale_ids = [tid for tid in self.active_tracks if tid not in current_ids]
        for tid in stale_ids:
            del self.active_tracks[tid]

        return current_frame_tracks

    def reset(self):
        """Reset all tracked state."""
        self.active_tracks.clear()
