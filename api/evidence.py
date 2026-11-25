import os
import time
import shutil
import logging
import threading
import subprocess
from collections import deque
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple
import cv2
import numpy as np

logger = logging.getLogger("TrafficMonitor.API.Evidence")

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
INCIDENTS_DIR = os.path.join(DATA_DIR, "incidents")


class FrameBufferItem:
    __slots__ = ("frame_idx", "timestamp_ms", "annotated_frame")

    def __init__(self, frame_idx: int, timestamp_ms: int, annotated_frame: np.ndarray):
        self.frame_idx = frame_idx
        self.timestamp_ms = timestamp_ms
        self.annotated_frame = annotated_frame


class SessionEvidenceRingBuffer:
    """
    Maintains a rolling ring-buffer of the last ~10 seconds of annotated frames.
    On confirmation, triggers snapshot creation and schedules clip generation
    including pre-roll and post-roll frames.
    """

    def __init__(self, max_seconds: float = 12.0, fps: float = 30.0):
        self.fps = max(5.0, fps)
        self.capacity = int(max_seconds * self.fps)
        self.buffer = deque(maxlen=self.capacity)
        self._lock = threading.Lock()
        os.makedirs(INCIDENTS_DIR, exist_ok=True)

    def append(self, frame_idx: int, timestamp_ms: int, frame: np.ndarray):
        with self._lock:
            # We copy or store the frame for clipping
            self.buffer.append(FrameBufferItem(frame_idx, timestamp_ms, frame.copy()))

    def capture_snapshot(self, incident_id: str, frame: np.ndarray) -> str:
        """Saves high-res JPEG snapshot at moment of impact confirmation."""
        os.makedirs(INCIDENTS_DIR, exist_ok=True)
        snapshot_filename = f"{incident_id}.jpg"
        snapshot_path = os.path.join(INCIDENTS_DIR, snapshot_filename)
        cv2.imwrite(snapshot_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        # Also maintain explicit _impact.jpg alias
        impact_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_impact.jpg")
        cv2.imwrite(impact_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        return snapshot_path

    def schedule_clip_capture(
        self,
        incident_id: str,
        confirmed_frame_idx: int,
        pre_roll_seconds: float = 5.0,
        post_roll_seconds: float = 5.0,
        on_complete: Optional[Any] = None,
    ):
        """
        Schedules H.264 clip generation spanning pre-roll to post-roll frames
        and extracts 3-phase evidence snapshots (before, impact, after).
        Runs off the event loop in a background daemon thread.
        """
        pre_frames_count = int(pre_roll_seconds * self.fps)
        post_frames_count = int(post_roll_seconds * self.fps)

        def worker():
            try:
                # Wait for post-roll frames to accumulate
                time.sleep(post_roll_seconds + 0.5)

                with self._lock:
                    all_items = list(self.buffer)

                if not all_items:
                    logger.warning(f"No frames in buffer to render clip for {incident_id}")
                    return

                # Find the confirmed frame index
                target_idx = None
                for i, item in enumerate(all_items):
                    if item.frame_idx >= confirmed_frame_idx:
                        target_idx = i
                        break

                if target_idx is None:
                    target_idx = len(all_items) - 1

                start_idx = max(0, target_idx - pre_frames_count)
                end_idx = min(len(all_items), target_idx + post_frames_count)
                clip_frames = [item.annotated_frame for item in all_items[start_idx:end_idx]]

                if not clip_frames:
                    logger.warning(f"Empty clip frames slice for {incident_id}")
                    return

                # 1. Save 3-phase evidence snapshots in background thread
                before_snap_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_before.jpg")
                impact_snap_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_impact.jpg")
                after_snap_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_after.jpg")

                cv2.imwrite(before_snap_path, all_items[start_idx].annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                cv2.imwrite(impact_snap_path, all_items[target_idx].annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                cv2.imwrite(after_snap_path, all_items[end_idx - 1].annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

                # 2. Render H.264 MP4 clip
                clip_path = _render_h264_clip(incident_id, clip_frames, self.fps)

                # 3. Update DB asynchronously with generated evidence paths
                try:
                    from api import db
                    db.update_incident_evidence_files(
                        incident_id=incident_id,
                        snapshot_before_path=before_snap_path,
                        snapshot_after_path=after_snap_path,
                        clip_path=clip_path,
                    )
                except Exception as dbe:
                    logger.warning(f"Failed to update incident evidence paths for {incident_id}: {dbe}")

                if on_complete:
                    on_complete(clip_path)

            except Exception as e:
                logger.error(f"Error generating incident clip for {incident_id}: {e}", exc_info=True)

        threading.Thread(target=worker, daemon=True).start()


def _render_h264_clip(incident_id: str, frames: List[np.ndarray], fps: float) -> str:
    """Encodes list of frames into H.264 MP4 using ffmpeg subprocess (off the event loop)."""
    os.makedirs(INCIDENTS_DIR, exist_ok=True)
    out_mp4 = os.path.join(INCIDENTS_DIR, f"{incident_id}.mp4")
    temp_avi = os.path.join(INCIDENTS_DIR, f"{incident_id}_temp.avi")

    h, w = frames[0].shape[:2]

    # First write temporary lossless raw avi
    fourcc = cv2.VideoWriter_fourcc(*"MJPG")
    writer = cv2.VideoWriter(temp_avi, fourcc, fps, (w, h))
    for f in frames:
        writer.write(f)
    writer.release()

    # Transcode with ffmpeg if available
    ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if os.path.exists(ffmpeg_bin) or shutil.which("ffmpeg"):
        cmd = [
            ffmpeg_bin if os.path.exists(ffmpeg_bin) else "ffmpeg",
            "-y",
            "-i", temp_avi,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "23",
            "-movflags", "+faststart",
            out_mp4
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if res.returncode == 0:
            if os.path.exists(temp_avi):
                os.remove(temp_avi)
            return out_mp4
        else:
            logger.warning(f"ffmpeg transcode failed with returncode {res.returncode}, using fallback: {res.stderr.decode('utf-8', errors='ignore')}")

    # Fallback to direct mp4v if ffmpeg failed
    if os.path.exists(temp_avi):
        os.rename(temp_avi, out_mp4)
    return out_mp4


def run_retention_cleanup(retention_days: int = 30, max_gb: float = 5.0):
    """Prunes old incident files exceeding retention days or max GB size."""
    if not os.path.exists(INCIDENTS_DIR):
        return

    now = time.time()
    max_age_seconds = retention_days * 86400
    files_with_mtime: List[Tuple[str, float, int]] = []
    total_bytes = 0

    for fname in os.listdir(INCIDENTS_DIR):
        fpath = os.path.join(INCIDENTS_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        stat = os.stat(fpath)
        total_bytes += stat.st_size

        # Delete if older than retention_days
        if now - stat.st_mtime > max_age_seconds:
            try:
                os.remove(fpath)
                logger.info(f"Pruned expired incident file: {fname}")
                continue
            except Exception as e:
                logger.warning(f"Could not remove {fname}: {e}")

        files_with_mtime.append((fpath, stat.st_mtime, stat.st_size))

    # If still exceeds max_gb, prune oldest
    max_bytes = int(max_gb * 1024 * 1024 * 1024)
    if total_bytes > max_bytes:
        files_with_mtime.sort(key=lambda x: x[1])  # oldest first
        for fpath, _, size in files_with_mtime:
            if total_bytes <= max_bytes:
                break
            try:
                os.remove(fpath)
                total_bytes -= size
                logger.info(f"Pruned incident file for size limit: {os.path.basename(fpath)}")
            except Exception as e:
                logger.warning(f"Could not prune {fpath}: {e}")

