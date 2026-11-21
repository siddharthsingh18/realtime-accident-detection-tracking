import os
import uuid
import logging
from typing import Dict, Optional
import cv2

from src import resolve_fps
from api.models import PipelineSettings
from api.processor import FrameProcessor

logger = logging.getLogger("TrafficMonitor.API.Sessions")


class SessionState:
    def __init__(
        self,
        session_id: str,
        source: str,
        source_path: Optional[str] = None,
        temp_file_path: Optional[str] = None,
        settings: Optional[PipelineSettings] = None,
    ):
        self.session_id = session_id
        self.source = source
        self.source_path = source_path
        self.temp_file_path = temp_file_path
        self.settings = settings or PipelineSettings()

        self.cap: Optional[cv2.VideoCapture] = None
        self.fps: float = 30.0
        self.total_frames: Optional[int] = None
        self.processor: Optional[FrameProcessor] = None

        self.is_paused: bool = False
        self.is_stopped: bool = False

        if self.source in ("sample1", "sample2", "upload") and self.source_path:
            self._init_capture()

    def _init_capture(self):
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
        )

    def init_webcam_processor(self, estimated_fps: float = 15.0):
        self.fps = estimated_fps
        self.processor = FrameProcessor(
            settings=self.settings,
            fps=self.fps,
            total_frames=None,
        )

    def cleanup(self):
        self.is_stopped = True
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
        source_path: Optional[str] = None,
        temp_file_path: Optional[str] = None,
        settings: Optional[PipelineSettings] = None,
    ) -> SessionState:
        session_id = str(uuid.uuid4())
        session = SessionState(
            session_id=session_id,
            source=source,
            source_path=source_path,
            temp_file_path=temp_file_path,
            settings=settings,
        )
        self.sessions[session_id] = session
        logger.info(f"Created session {session_id} for source '{source}'")
        return session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        return self.sessions.get(session_id)

    def remove_session(self, session_id: str):
        session = self.sessions.pop(session_id, None)
        if session:
            session.cleanup()
            logger.info(f"Removed session {session_id}")


# Global session manager instance
session_manager = SessionManager()

