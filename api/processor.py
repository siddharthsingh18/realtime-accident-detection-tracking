import os
import time
import logging
import threading
from typing import Tuple, List, Dict, Any, Set, Optional
from datetime import datetime, timezone
import cv2
import numpy as np
from ultralytics import YOLO

from src import (
    DualDetector,
    VehicleTracker,
    AccidentPersistenceManager,
    VehicleCollisionDetector,
    suppress_vehicles_in_accidents,
    seconds_to_frames,
    Visualizer,
)
from api.models import (
    PipelineSettings,
    TelemetryMessage,
    ZoneTelemetry,
    TelemetryEvent,
    TrackTelemetry,
    FrameSize,
    InferenceBreakdown,
)
from api.evidence import SessionEvidenceRingBuffer
from api import db

logger = logging.getLogger("TrafficMonitor.API.Processor")

_detector_cache: Dict[str, DualDetector] = {}
_inference_lock = threading.Lock()


def get_shared_detector(device: Optional[str] = None, backend: str = "pytorch") -> DualDetector:
    dev_key = f"{device or 'auto'}_{backend.lower()}"
    if dev_key not in _detector_cache:
        logger.info(f"Loading shared DualDetector for device: {device or 'auto'}, backend: {backend}")
        accident_path = "models/accident_yolo11s.onnx" if backend.lower() == "onnx" and os.path.exists("models/accident_yolo11s.onnx") else "models/accident_yolo11s.pt"
        vehicle_path = "models/yolo11n.onnx" if backend.lower() == "onnx" and os.path.exists("models/yolo11n.onnx") else "models/yolo11n.pt"
        _detector_cache[dev_key] = DualDetector(
            accident_weights=accident_path,
            vehicle_weights=vehicle_path,
            device=None if dev_key.startswith("auto") else device,
            backend=backend,
        )
    return _detector_cache[dev_key]


class FrameProcessor:
    """
    Operator-grade computer vision pipeline:
    - BoT-SORT vehicle tracking with motion trails & speed calculation.
    - YOLO accident detector + kinematic collision gating.
    - Ignore-region polygon filtering (server-side discard).
    - Confirmation state machine (TENTATIVE -> ACTIVE -> MAINTAINED -> removed).
    - Evidence capture (rolling ring buffer, snapshot & H.264 clip generation).
    - SQLite incident persistence.
    """

    def __init__(
        self,
        settings: Optional[PipelineSettings] = None,
        fps: float = 30.0,
        total_frames: Optional[int] = None,
        camera_id: str = "cam_01",
        session_id: Optional[str] = None,
        ignore_region: Optional[List[List[float]]] = None,
    ):
        self.settings = settings or PipelineSettings()
        self.fps = max(1.0, fps)
        self.total_frames = total_frames
        self.camera_id = camera_id
        self.session_id = session_id or f"sess_{camera_id}_{int(time.time())}"
        self.ignore_region = ignore_region or []

        # Timeouts in frames
        self.persistence_frames = seconds_to_frames(self.settings.persistence_seconds, self.fps)
        self.confirm_hits = seconds_to_frames(self.settings.confirm_seconds, self.fps)
        self.tentative_grace = seconds_to_frames(self.settings.tentative_grace_seconds, self.fps)
        self.confirm_window = max(self.confirm_hits + 3, 8)

        # Detectors and tracker
        self.detector = get_shared_detector(self.settings.device, self.settings.inference_backend)
        self.detector.accident_conf = self.settings.accident_conf
        self.detector.vehicle_conf = self.settings.vehicle_conf

        # Each camera session gets a dedicated YOLO vehicle model to ensure BoT-SORT
        # tracking state and optical flow pyramids remain fully isolated across concurrent cameras.
        backend = self.settings.inference_backend.lower()
        veh_weights = "models/yolo11n.onnx" if backend == "onnx" and os.path.exists("models/yolo11n.onnx") else "models/yolo11n.pt"
        vehicle_model_inst = YOLO(veh_weights)
        self.tracker = VehicleTracker(
            vehicle_model=vehicle_model_inst,
            tracker_type="botsort.yaml",
            conf=self.settings.vehicle_conf,
            iou=0.50,
            device=self.detector.device,
            max_history=30,
        )

        self.persistence_mgr = AccidentPersistenceManager(
            persistence_frames=self.persistence_frames,
            iou_match_threshold=self.settings.iou_threshold,
            smoothing_alpha=0.70,
            confirm_hits=self.confirm_hits,
            confirm_window=self.confirm_window,
            tentative_grace=self.tentative_grace,
        )

        self.collision_detector = VehicleCollisionDetector(fps=self.fps)

        self.visualizer = Visualizer(
            show_tracking_ids=True,
            show_confidence=True,
            show_alert_banner=True,
            show_hud_stats=True,
            suppress_vehicle_labels=True,
            line_thickness=2,
        )

        # Evidence ring buffer
        self.ring_buffer = SessionEvidenceRingBuffer(max_seconds=12.0, fps=self.fps)

        # Tracking state
        self.unique_vehicle_ids: Set[int] = set()
        self.previous_confirmed_zone_ids: Set[int] = set()
        self.zone_origins: Dict[int, str] = {}
        self.active_incidents_by_zone: Dict[int, str] = {}
        self.dropped_frames: int = 0
        self.last_frame_time = time.time()

    def update_settings(self, new_settings: PipelineSettings):
        self.settings = new_settings
        self.detector.accident_conf = new_settings.accident_conf
        self.detector.vehicle_conf = new_settings.vehicle_conf
        self.tracker.conf = new_settings.vehicle_conf

        self.persistence_frames = seconds_to_frames(new_settings.persistence_seconds, self.fps)
        self.confirm_hits = seconds_to_frames(new_settings.confirm_seconds, self.fps)
        self.tentative_grace = seconds_to_frames(new_settings.tentative_grace_seconds, self.fps)
        self.confirm_window = max(self.confirm_hits + 3, 8)

        self.persistence_mgr.persistence_frames = self.persistence_frames
        self.persistence_mgr.confirm_hits = self.confirm_hits
        self.persistence_mgr.confirm_window = self.confirm_window
        self.persistence_mgr.tentative_grace = self.tentative_grace
        self.persistence_mgr.iou_match_threshold = new_settings.iou_threshold

    def is_in_ignore_region(self, bbox: List[float]) -> bool:
        if not self.ignore_region or len(self.ignore_region) < 3:
            return False
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        poly = np.array(self.ignore_region, dtype=np.int32)
        dist = cv2.pointPolygonTest(poly, (cx, cy), False)
        return dist >= 0

    def process(
        self,
        frame: np.ndarray,
        timestamp_ms: Optional[int] = None,
        frame_idx: int = 0,
        current_fps: Optional[float] = None,
    ) -> Tuple[bytes, TelemetryMessage, np.ndarray]:
        t0 = time.time()
        if timestamp_ms is None:
            timestamp_ms = int(time.time() * 1000)

        effective_fps = current_fps or self.fps
        h, w = frame.shape[:2]

        # 1. Track Vehicles with BoT-SORT & 2. Detect Accidents with Custom YOLO Detector
        # Guarded by _inference_lock to ensure thread-safe forward passes on CPU across concurrent streams
        with _inference_lock:
            t_v0 = time.time()
            tracked_vehicles = self.tracker.update(frame)
            for v in tracked_vehicles:
                self.unique_vehicle_ids.add(v.track_id)
            t_vehicle = (time.time() - t_v0) * 1000

            t_a0 = time.time()
            raw_accidents = self.detector.detect_accidents(frame)
            t_accident = (time.time() - t_a0) * 1000

        # 3. Collision Heuristic + Ignore Region Filter + Confirmation Logic
        t_l0 = time.time()
        if self.settings.use_collision_heuristic:
            collisions = self.collision_detector.detect(tracked_vehicles, fps=effective_fps)
        else:
            collisions = []

        # Filter out candidates whose centroid falls inside the ignore region polygon
        valid_raw = [acc for acc in raw_accidents if not self.is_in_ignore_region(acc["bbox"])]
        valid_col = [col for col in collisions if not self.is_in_ignore_region(col["bbox"])]

        # Tag origins
        detector_zone_candidates = set()
        heuristic_zone_candidates = set()

        all_candidates = valid_raw + valid_col

        confirmed_accidents = self.persistence_mgr.update(all_candidates)

        # Update zone origins
        for z in confirmed_accidents:
            has_raw = any(
                abs(z.bbox[0] - r["bbox"][0]) < 30 and abs(z.bbox[1] - r["bbox"][1]) < 30
                for r in valid_raw
            )
            has_col = any(
                abs(z.bbox[0] - c["bbox"][0]) < 30 and abs(z.bbox[1] - c["bbox"][1]) < 30
                for c in valid_col
            )
            if has_raw and has_col:
                self.zone_origins[z.zone_id] = "both"
            elif has_col:
                self.zone_origins[z.zone_id] = "collision_heuristic"
            else:
                self.zone_origins[z.zone_id] = "detector"

        # State transition events
        current_confirmed_ids = {z.zone_id for z in confirmed_accidents}
        events: List[TelemetryEvent] = []

        newly_confirmed = current_confirmed_ids - self.previous_confirmed_zone_ids
        for zid in sorted(newly_confirmed):
            target_zone = next((z for z in confirmed_accidents if z.zone_id == zid), None)
            bbox_coords = tuple(float(c) for c in target_zone.bbox) if target_zone else None
            events.append(
                TelemetryEvent(
                    type="confirmed",
                    zone_id=zid,
                    frame_idx=frame_idx,
                    timestamp_ms=timestamp_ms,
                    camera_id=self.camera_id,
                    bbox=bbox_coords,
                    details=f"Accident confirmed in Zone #{zid} via {self.zone_origins.get(zid, 'detector')}",
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
                    camera_id=self.camera_id,
                    details=f"Accident cleared in Zone #{zid}",
                )
            )

        self.previous_confirmed_zone_ids = current_confirmed_ids

        # Suppression of normal vehicle labels inside confirmed accident zones
        if confirmed_accidents:
            tracked_vehicles, confirmed_accidents = suppress_vehicles_in_accidents(
                vehicles=tracked_vehicles,
                accident_zones=confirmed_accidents,
                containment_threshold=self.settings.containment_threshold,
                iou_threshold=0.30,
            )
        t_logic = (time.time() - t_l0) * 1000

        # 4. Render Annotations
        t_r0 = time.time()
        dt = time.time() - t0
        proc_fps = 1.0 / dt if dt > 0 else effective_fps

        annotated_frame = self.visualizer.render(
            frame=frame,
            vehicles=tracked_vehicles,
            accident_zones=confirmed_accidents,
            fps=proc_fps,
            frame_idx=frame_idx,
        )

        # Draw ignore region hatch on annotated frame if configured
        if self.ignore_region and len(self.ignore_region) >= 3:
            pts = np.array(self.ignore_region, np.int32).reshape((-1, 1, 2))
            cv2.polylines(annotated_frame, [pts], isClosed=True, color=(100, 116, 139), thickness=2)

        # Save into rolling evidence buffer
        self.ring_buffer.append(frame_idx, timestamp_ms, annotated_frame)

        # Handle DB incident persistence & evidence on confirmation
        for ev in events:
            if ev.type == "confirmed":
                zid = ev.zone_id
                target_zone = next((z for z in confirmed_accidents if z.zone_id == zid), None)
                if target_zone:
                    inc_id = f"inc_{self.camera_id}_{zid}_{timestamp_ms}"
                    self.active_incidents_by_zone[zid] = inc_id

                    # Save snapshot immediately
                    snap_path = self.ring_buffer.capture_snapshot(inc_id, annotated_frame)
                    clip_path = f"data/incidents/{inc_id}.mp4"

                    # Insert into DB
                    now_iso = datetime.now(timezone.utc).isoformat()
                    model_meta = {
                        "accident_model": "YOLOv8s (models/accident_yolo11s.pt)",
                        "vehicle_model": "YOLO11n (models/yolo11n.pt)",
                        "tracker": "BoT-SORT",
                    }
                    db.insert_incident(
                        incident_id=inc_id,
                        camera_id=self.camera_id,
                        session_id=self.session_id,
                        zone_id=zid,
                        origin=self.zone_origins.get(zid, "detector"),
                        confirmed_at=now_iso,
                        peak_conf=float(target_zone.conf),
                        bbox=[float(c) for c in target_zone.bbox],
                        involved_ids=list(target_zone.involved_vehicle_ids),
                        snapshot_path=snap_path,
                        clip_path=clip_path,
                        settings=self.settings.model_dump(),
                        model_info=model_meta,
                    )

                    # Schedule clip capture
                    self.ring_buffer.schedule_clip_capture(
                        incident_id=inc_id,
                        confirmed_frame_idx=frame_idx,
                        pre_roll_seconds=5.0,
                        post_roll_seconds=5.0,
                    )

            elif ev.type == "cleared":
                zid = ev.zone_id
                inc_id = self.active_incidents_by_zone.pop(zid, None)
                if inc_id:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    db.update_incident_cleared(inc_id, cleared_at=now_iso)

        ret, jpeg_buffer = cv2.imencode(".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        jpeg_bytes = jpeg_buffer.tobytes() if ret else b""
        t_render = (time.time() - t_r0) * 1000

        # Build detailed TrackTelemetry
        tracks_telemetry: List[TrackTelemetry] = []
        for v in tracked_vehicles:
            trail_pts: List[Tuple[float, float]] = []
            if hasattr(v, "history") and v.history:
                trail_pts = [(float(pt[0]), float(pt[1])) for pt in v.history][-30:]

            # Speed in pixels/sec
            speed_val = 0.0
            if hasattr(v, "speed") and v.speed is not None:
                speed_val = float(v.speed)

            tracks_telemetry.append(
                TrackTelemetry(
                    track_id=v.track_id,
                    cls=getattr(v, "cls_name", "vehicle"),
                    conf=float(v.conf),
                    bbox=(float(v.bbox[0]), float(v.bbox[1]), float(v.bbox[2]), float(v.bbox[3])),
                    speed_px_s=speed_val,
                    suppressed=bool(getattr(v, "suppressed", False)),
                    trail=trail_pts,
                )
            )

        # Build ZoneTelemetry across all tracking zones (ACTIVE, MAINTAINED, and TENTATIVE)
        all_zones = self.persistence_mgr.all_zones()
        zone_telemetry = [
            ZoneTelemetry(
                zone_id=z.zone_id,
                status=z.status,
                conf=float(z.conf),
                bbox=(float(z.bbox[0]), float(z.bbox[1]), float(z.bbox[2]), float(z.bbox[3])),
                involved_vehicle_ids=list(z.involved_vehicle_ids),
                speed_loss_pct=getattr(z, "speed_loss_pct", None),
                first_seen_frame=getattr(z, "first_seen_frame", frame_idx),
                confirmed_at_ms=timestamp_ms if z.status in ("ACTIVE", "MAINTAINED") else None,
                origin=self.zone_origins.get(z.zone_id, "detector"),
            )
            for z in all_zones
        ]

        total_ms = t_vehicle + t_accident + t_logic + t_render
        inference_breakdown = InferenceBreakdown(
            accident=round(t_accident, 1),
            vehicle=round(t_vehicle, 1),
            tracking=round(t_vehicle * 0.25, 1),  # tracking portion of vehicle loop
            logic=round(t_logic, 1),
            render=round(t_render, 1),
            total=round(total_ms, 1),
        )

        telemetry = TelemetryMessage(
            frame_idx=frame_idx,
            total_frames=self.total_frames,
            fps=round(proc_fps, 1),
            timestamp_ms=timestamp_ms,
            camera_id=self.camera_id,
            frame_size=FrameSize(w=w, h=h),
            vehicles_in_frame=len(tracked_vehicles),
            vehicles_total_unique=len(self.unique_vehicle_ids),
            confirmed_accidents=len(confirmed_accidents),
            dropped_frames=self.dropped_frames,
            inference_ms=inference_breakdown,
            tracks=tracks_telemetry,
            zones=zone_telemetry,
            events=events,
            finished=False,
        )

        return jpeg_bytes, telemetry, annotated_frame
