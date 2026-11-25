import os
import shutil
from typing import List
from fastapi import APIRouter, Request, HTTPException, status
import cv2

from api.models import DemoItem
from api.range_response import create_range_response

router = APIRouter(prefix="/api/demos", tags=["demos"])

DEMO_CONFIGS = {
    "scenario1": {
        "title": "Scenario 1: Vehicle Collision Dynamics",
        "description": "High-speed highway collision with abrupt vehicle deceleration and emergency alert trigger.",
        "h264_path": "outputs/h264/scenario1.mp4",
        "legacy_path": "outputs/output_scenario1.mp4",
    },
    "scenario2": {
        "title": "Scenario 2: Multi-Vehicle Incident",
        "description": "Multi-car traffic collision and multi-object tracking surveillance.",
        "h264_path": "outputs/h264/scenario2.mp4",
        "legacy_path": "outputs/output_scenario2.mp4",
    },
}


_demo_cache = {}

def _get_demo_metadata(name: str, config: dict) -> DemoItem:
    if name in _demo_cache:
        return _demo_cache[name]
    h264_path = config["h264_path"]
    legacy_path = config["legacy_path"]

    target_path = h264_path if os.path.exists(h264_path) else legacy_path
    exists = os.path.exists(target_path)
    is_h264 = os.path.exists(h264_path)

    resolution = "1280x720"
    fps = 30.0
    duration = 0.0
    size_bytes = 0

    if exists:
        size_bytes = os.path.getsize(target_path)
        cap = cv2.VideoCapture(target_path)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            if w > 0 and h > 0:
                resolution = f"{w}x{h}"
            f = cap.get(cv2.CAP_PROP_FPS)
            if f and f > 0:
                fps = round(f, 2)
            total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            if total and total > 0 and fps > 0:
                duration = round(total / fps, 2)
            cap.release()

    demo_url = f"/api/demos/{name}/video"
    item = DemoItem(
        name=name,
        title=config["title"],
        description=config["description"],
        resolution=resolution,
        fps=fps,
        duration_seconds=duration,
        size_bytes=size_bytes,
        playable=is_h264,
        url=demo_url,
        video_url=demo_url,
    )
    _demo_cache[name] = item
    return item


@router.get("", response_model=List[DemoItem])
def list_demos() -> List[DemoItem]:
    items = []
    for name, config in DEMO_CONFIGS.items():
        items.append(_get_demo_metadata(name, config))
    return items


@router.get("/{name}/video")
def stream_demo_video(name: str, request: Request):
    if name not in DEMO_CONFIGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Demo '{name}' not found")

    config = DEMO_CONFIGS[name]
    h264_path = config["h264_path"]
    legacy_path = config["legacy_path"]

    if os.path.exists(h264_path):
        return create_range_response(request, h264_path)

    # Check if legacy non-H.264 file exists
    if os.path.exists(legacy_path):
        ffmpeg_exists = bool(shutil.which("ffmpeg"))
        if not ffmpeg_exists:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Demo file is encoded in mp4v which cannot be played directly by web browsers. ffmpeg is missing on the server to re-encode it to H.264 (avc1). Please install ffmpeg or run scripts/reencode_demos.py.",
            )
        # Attempt on-demand re-encode
        from scripts.reencode_demos import reencode_file
        success = reencode_file(legacy_path, h264_path)
        if success and os.path.exists(h264_path):
            return create_range_response(request, h264_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to transcode demo video to H.264 for browser playback.",
        )

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Demo video file '{name}' does not exist on disk.")

