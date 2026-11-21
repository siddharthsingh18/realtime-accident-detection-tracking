import time
import logging
from typing import Tuple, List, Dict, Any, Set, Optional
import cv2
import numpy as np

from src import (
    DualDetector,
    VehicleTracker,
    AccidentPersistenceManager,
    VehicleCollisionDetector,
    suppress_vehicles_in_accidents,
    seconds_to_frames,
    Visualizer,
)
from api.models import PipelineSettings, TelemetryMessage, ZoneTelemetry, TelemetryEvent

logger = logging.getLogger("TrafficMonitor.API.Processor")

# Shared detector cache by device to avoid re-allocating 30MB+ neural networks per session
_detector_cache: Dict[str, DualDetector] = {}


def get_shared_detector(device: Optional[str] = None) -> DualDetector:
    dev_key = device or "auto"
    if dev_key not in _detector_cache:
        logger.info(f"Loading shared DualDetector for device: {dev_key}")
        _detector_cache[dev_key] = DualDetector(
            accident_weights="models/accident_yolo11s.pt",
            vehicle_weights="models/yolo11n.pt",
            device=None if dev_key == "auto" else dev_key,
        )
    return _detector_cache[dev_key]


class FrameProcessor:
    """
    Reusable per-frame computer vision pipeline extracting the core algorithm from main.py:
    - Pretrained YOLO11n vehicle detection + BoT-SORT multi-object tracking.
    - Custom YOLO accident detection + kinematic collision gating.
    - 4-state confirmation state machine (TENTATIVE -> ACTIVE -> MAINTAINED -> removed).
    - Visual suppression on confirmed accident zones.
    - Overlay rendering with OpenCV visualizer.
    - Emits JPEG bytes and strongly typed telemetry.
    """

    def __init__(
        self,
        settings: Optional[PipelineSettings] = None,
        fps: float = 30.0,
        total_frames: Optional[int] = None,
    ):
        self.settings = settings or PipelineSettings()
        self.fps = max(1.0, fps)
        self.total_frames = total_frames

        # Resolve time-based timeouts to frame counts
        self.persistence_frames = seconds_to_frames(self.settings.persistence_seconds, self.fps)
        self.confirm_hits = seconds_to_frames(self.settings.confirm_seconds, self.fps)
        self.tentative_grace = seconds_to_frames(self.settings.tentative_grace_seconds, self.fps)
        self.confirm_window = max(self.confirm_hits + 3, 8)

        # Get or initialize detector
        self.detector = get_shared_detector(self.settings.device)
        self.detector.accident_conf = self.settings.accident_conf
        self.detector.vehicle_conf = self.settings.vehicle_conf

        # Tracker
        self.tracker = VehicleTracker(
            vehicle_model=self.detector.vehicle_model,
            tracker_type="botsort.yaml",
            conf=self.settings.vehicle_conf,
            iou=0.50,
            device=self.detector.device,
            max_history=30,
        )

        # Persistence manager with confirmation gate
        self.persistence_mgr = AccidentPersistenceManager(
            persistence_frames=self.persistence_frames,
            iou_match_threshold=0.30,
            smoothing_alpha=0.70,
            confirm_hits=self.confirm_hits,
            confirm_window=self.confirm_window,
            tentative_grace=self.tentative_grace,
        )

        # Kinematic collision detector
        self.collision_detector = VehicleCollisionDetector(fps=self.fps)

        # Visualizer
        self.visualizer = Visualizer(
            show_tracking_ids=True,
            show_confidence=True,
            show_alert_banner=True,
            show_hud_stats=True,
            suppress_vehicle_labels=True,
            line_thickness=2,
        )

        # Session tracking state
        self.unique_vehicle_ids: Set[int] = set()
        self.previous_confirmed_zone_ids: Set[int] = set()
        self.dropped_frames: int = 0
        self.last_frame_time = time.time()
        self.ema_fps = self.fps

    def update_settings(self, new_settings: PipelineSettings):
        """Live updates settings where safe."""
        self.settings = new_settings
        self.detector.accident_conf = new_settings.accident_conf
        self.detector.vehicle_conf = new_settings.vehicle_conf
        self.tracker.conf = new_settings.vehicle_conf

        # Update persistence thresholds
        self.persistence_frames = seconds_to_frames(new_settings.persistence_seconds, self.fps)
        self.confirm_hits = seconds_to_frames(new_settings.confirm_seconds, self.fps)
        self.tentative_grace = seconds_to_frames(new_settings.tentative_grace_seconds, self.fps)
        self.confirm_window = max(self.confirm_hits + 3, 8)

        self.persistence_mgr.persistence_frames = self.persistence_frames
        self.persistence_mgr.confirm_hits = self.confirm_hits
        self.persistence_mgr.confirm_window = self.confirm_window
        self.persistence_mgr.tentative_grace = self.tentative_grace

    def process(
        self,
        frame: np.ndarray,
        timestamp_ms: Optional[int] = None,
        frame_idx: int = 0,
        current_fps: Optional[float] = None,
    ) -> Tuple[bytes, TelemetryMessage, np.ndarray]:
        """
        Process a single video frame and return:
        (jpeg_bytes, TelemetryMessage, annotated_frame)
        """
        t0 = time.time()
        if timestamp_ms is None:
            timestamp_ms = int(time.time() * 1000)

        effective_fps = current_fps or self.fps

        # 1. Track Vehicles with BoT-SORT
        tracked_vehicles = self.tracker.update(frame)
        for v in tracked_vehicles:
            self.unique_vehicle_ids.add(v.track_id)

        # 2. Detect Accidents with Custom YOLO Detector
        raw_accidents = self.detector.detect_accidents(frame)

        # 3. Detect Inter-Vehicle Collisions (if enabled)
        if self.settings.use_collision_heuristic:
            collisions = self.collision_detector.detect(tracked_vehicles, fps=effective_fps)
        else:
            collisions = []
        all_candidates = raw_accidents + collisions

        # 4. Confirmation State Machine -> Returns confirmed zones (ACTIVE / MAINTAINED)
        confirmed_accidents = self.persistence_mgr.update(all_candidates)

        # 5. Track state transitions for events log
        current_confirmed_ids = {z.zone_id for z in confirmed_accidents}
        events: List[TelemetryEvent] = []

        newly_confirmed = current_confirmed_ids - self.previous_confirmed_zone_ids
        for zid in sorted(newly_confirmed):
            events.append(
                TelemetryEvent(
                    type="confirmed",
                    zone_id=zid,
                    frame_idx=frame_idx,
                    timestamp_ms=timestamp_ms,
                )
            )

        newly_cleared = self.previous_confirmed_zone_ids - current_confirmed_ids
        for zid in sorted(newly_cleared):
            events.append(
                TelemetryEvent(
                    type="cleared",
                    zone_id=zid,
                    frame_idx=frame_idx,
                    timestamp_ms=timestamp_ms,
                )
            )

        self.previous_confirmed_zone_ids = current_confirmed_ids

        # 6. Containment Matching & Suppression of normal labels inside confirmed accident zones
        if confirmed_accidents:
            tracked_vehicles, confirmed_accidents = suppress_vehicles_in_accidents(
                vehicles=tracked_vehicles,
                accident_zones=confirmed_accidents,
                containment_threshold=self.settings.containment_threshold,
                iou_threshold=0.30,
            )

        dt = time.time() - t0
        proc_fps = 1.0 / dt if dt > 0 else effective_fps

        # 7. Render OpenCV Annotations (HUD, alert banner, boxes)
        annotated_frame = self.visualizer.render(
            frame=frame,
            vehicles=tracked_vehicles,
            accident_zones=confirmed_accidents,
            fps=proc_fps,
            frame_idx=frame_idx,
        )

        # Encode annotated frame to JPEG
        ret, jpeg_buffer = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        jpeg_bytes = jpeg_buffer.tobytes() if ret else b""

        # 8. Assemble Telemetry Message
        zone_telemetry = [
            ZoneTelemetry(
                zone_id=z.zone_id,
                status=z.status,
                conf=float(z.conf),
                bbox=[float(coord) for coord in z.bbox],
                involved_vehicle_ids=list(z.involved_vehicle_ids),
            )
            for z in confirmed_accidents
        ]

        telemetry = TelemetryMessage(
            frame_idx=frame_idx,
            total_frames=self.total_frames,
            fps=round(proc_fps, 1),
            timestamp_ms=timestamp_ms,
            vehicles_in_frame=len(tracked_vehicles),
            vehicles_total_unique=len(self.unique_vehicle_ids),
            confirmed_accidents=len(confirmed_accidents),
            dropped_frames=self.dropped_frames,
            zones=zone_telemetry,
            events=events,
            finished=False,
        )

        return jpeg_bytes, telemetry, annotated_frame

