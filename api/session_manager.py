import os
import uuid
import logging
from typing import Dict, Optional, List
import cv2
from fastapi import HTTPException

from src import resolve_fps
from api.models import PipelineSettings, SessionSystemInfo
from api.processor import FrameProcessor
from api import db

logger = logging.getLogger("TrafficMonitor.API.Sessions")

MAX_CONCURRENT_SESSIONS = 4


class SessionState:
    def __init__(
        self,
        session_id: str,
        source: str,
        camera_id: str = "cam_01",
        source_path: Optional[str] = None,
        temp_file_path: Optional[str] = None,
        settings: Optional[PipelineSettings] = None,
    ):
        self.session_id = session_id
        self.source = source
        self.camera_id = camera_id
        self.source_path = source_path
        self.temp_file_path = temp_file_path
        self.settings = settings or PipelineSettings()

        self.cap: Optional[cv2.VideoCapture] = None
        self.fps: float = 30.0
        self.current_fps: float = 30.0
        self.total_frames: Optional[int] = None
        self.processor: Optional[FrameProcessor] = None

        self.status: str = "connecting"
        self.is_paused: bool = False
        self.is_stopped: bool = False
        self.queue_depth: int = 0
        self.dropped_frames: int = 0

        # Load camera ignore region if configured
        ignore_region = []
        cam_data = db.get_camera(self.camera_id)
        if cam_data and cam_data.get("ignore_region"):
            ignore_region = cam_data["ignore_region"]

        if self.source in ("sample1", "sample2", "upload") and self.source_path:
            self._init_capture(ignore_region)

    def _init_capture(self, ignore_region: Optional[List[List[float]]] = None):
        if not self.source_path or not os.path.exists(self.source_path):
            raise FileNotFoundError(f"Video file not found at: {self.source_path}")

        self.cap = cv2.VideoCapture(self.source_path)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open video file: {self.source_path}")

        raw_fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = resolve_fps(raw_fps)
        total = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.total_frames = total if total > 0 else None

        self.processor = FrameProcessor(
            settings=self.settings,
            fps=self.fps,
            total_frames=self.total_frames,
            camera_id=self.camera_id,
            session_id=self.session_id,
            ignore_region=ignore_region,
        )

    def init_webcam_processor(self, estimated_fps: float = 15.0):
        self.fps = estimated_fps
        ignore_region = []
        cam_data = db.get_camera(self.camera_id)
        if cam_data and cam_data.get("ignore_region"):
            ignore_region = cam_data["ignore_region"]

        self.processor = FrameProcessor(
            settings=self.settings,
            fps=self.fps,
            total_frames=None,
            camera_id=self.camera_id,
            session_id=self.session_id,
            ignore_region=ignore_region,
        )

    def cleanup(self):
        self.is_stopped = True
        self.status = "finished"
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception as e:
                logger.warning(f"Error releasing video capture for session {self.session_id}: {e}")
            self.cap = None

        if self.temp_file_path and os.path.exists(self.temp_file_path):
            try:
                os.remove(self.temp_file_path)
                logger.info(f"Cleaned up temporary upload file: {self.temp_file_path}")
            except Exception as e:
                logger.warning(f"Error deleting temporary file {self.temp_file_path}: {e}")
            self.temp_file_path = None


class SessionManager:
    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}

    def create_session(
        self,
        source: str,
        camera_id: str = "cam_01",
        source_path: Optional[str] = None,
        temp_file_path: Optional[str] = None,
        settings: Optional[PipelineSettings] = None,
    ) -> SessionState:
        # If there is already a session for this camera_id, clean it up and replace it
        existing_for_cam = [s for s in list(self.sessions.values()) if s.camera_id == camera_id]
        for old_s in existing_for_cam:
            self.remove_session(old_s.session_id)

        # Clean up any sessions that have finished or stopped
        finished_ids = [sid for sid, s in list(self.sessions.items()) if s.is_stopped or s.status == "finished"]
        for fid in finished_ids:
            self.remove_session(fid)

        # Enforce maximum concurrent session cap for active sessions
        if len(self.sessions) >= MAX_CONCURRENT_SESSIONS:
            logger.warning(f"Session request rejected: max {MAX_CONCURRENT_SESSIONS} concurrent sessions reached.")
            raise HTTPException(
                status_code=409,
                detail=f"Hardware capacity reached: maximum of {MAX_CONCURRENT_SESSIONS} concurrent camera sessions supported. Running a 5th session would introduce inference contention and frame drops."
            )

        session_id = str(uuid.uuid4())
        session = SessionState(
            session_id=session_id,
            source=source,
            camera_id=camera_id,
            source_path=source_path,
            temp_file_path=temp_file_path,
            settings=settings,
        )
        self.sessions[session_id] = session
        logger.info(f"Created session {session_id} for camera '{camera_id}' ({len(self.sessions)}/{MAX_CONCURRENT_SESSIONS} active)")
        return session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        return self.sessions.get(session_id)

    def remove_session(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if session:
            session.cleanup()
            logger.info(f"Removed session {session_id} ({len(self.sessions)}/{MAX_CONCURRENT_SESSIONS} active)")

    def get_system_status(self, device: str = "auto") -> Dict:
        active_count = len(self.sessions)
        session_infos = [
            SessionSystemInfo(
                session_id=s.session_id,
                camera_id=s.camera_id,
                source=s.source,
                status=s.status,
                fps=round(s.current_fps, 1),
                dropped_frames=s.dropped_frames,
                queue_depth=s.queue_depth,
            )
            for s in self.sessions.values()
        ]
        warning = None
        if active_count >= 3:
            warning = f"High pipeline concurrency ({active_count}/4 active sessions). GPU/CPU memory bandwidth shared across parallel detectors."

        return {
            "active_sessions": active_count,
            "max_concurrent_sessions": MAX_CONCURRENT_SESSIONS,
            "device": device,
            "sessions": session_infos,
            "hardware_contention_warning": warning,
        }


session_manager = SessionManager()
