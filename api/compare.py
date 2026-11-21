import os
import time
import logging
from typing import Dict, Any, List, Tuple
import cv2

from api.models import PipelineSettings, CompareRunResult, CompareResponse
from api.processor import FrameProcessor
from src import resolve_fps

logger = logging.getLogger("TrafficMonitor.API.Compare")


def run_pipeline_simulation(
    video_path: str,
    settings: PipelineSettings,
    profile_name: str,
    max_frames: int = 150,
) -> CompareRunResult:
    """Runs a single pass of the video through FrameProcessor and records raw outcomes."""
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    raw_fps = cap.get(cv2.CAP_PROP_FPS)
    fps = resolve_fps(raw_fps)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    limit = min(total, max_frames) if total > 0 else max_frames

    processor = FrameProcessor(
        settings=settings,
        fps=fps,
        total_frames=limit,
        camera_id=f"comp_{profile_name}",
    )

    confirmed_zones_map: Dict[int, Dict[str, Any]] = {}
    frame_ranges: List[Tuple[int, int]] = []
    zone_start_frames: Dict[int, int] = {}
    total_processed = 0

    try:
        for idx in range(limit):
            ret, frame = cap.read()
            if not ret:
                break
            total_processed += 1
            _, telemetry, _ = processor.process(frame, frame_idx=idx, current_fps=fps)

            # Check events for frame ranges
            for ev in telemetry.events:
                if ev.type == "confirmed":
                    zone_start_frames[ev.zone_id] = idx
                    confirmed_zones_map[ev.zone_id] = {
                        "zone_id": ev.zone_id,
                        "first_seen_frame": idx,
                        "origin": telemetry.zones[0].origin if telemetry.zones else "detector",
                    }
                elif ev.type == "cleared":
                    start_f = zone_start_frames.pop(ev.zone_id, None)
                    if start_f is not None:
                        frame_ranges.append((start_f, idx))

        # Close any open ranges at end of processing
        for zid, start_f in zone_start_frames.items():
            frame_ranges.append((start_f, total_processed - 1))

    finally:
        cap.release()

    return CompareRunResult(
        profile_name=profile_name,
        settings=settings,
        total_frames=total_processed,
        confirmed_alerts_count=len(confirmed_zones_map),
        confirmed_zones=list(confirmed_zones_map.values()),
        frame_ranges=frame_ranges,
    )


def execute_ab_comparison(
    video_path: str,
    profile_a_settings: PipelineSettings,
    profile_b_settings: PipelineSettings,
    profile_a_name: str = "Profile A (Collision Heuristic ON)",
    profile_b_name: str = "Profile B (Collision Heuristic OFF)",
    max_frames: int = 150,
) -> CompareResponse:
    logger.info(f"Executing A/B comparison on {video_path} between '{profile_a_name}' and '{profile_b_name}'")
    run_a = run_pipeline_simulation(video_path, profile_a_settings, profile_a_name, max_frames=max_frames)
    run_b = run_pipeline_simulation(video_path, profile_b_settings, profile_b_name, max_frames=max_frames)

    return CompareResponse(
        source=os.path.basename(video_path),
        run_a=run_a,
        run_b=run_b,
        caveat="Raw counts and frame ranges only. No precision/recall or model accuracy score is inferred.",
    )

