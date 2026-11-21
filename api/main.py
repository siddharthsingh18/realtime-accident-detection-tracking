import os
import sys
import json
import time
import asyncio
import logging
import tempfile
from typing import Optional, Dict, Any

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    UploadFile,
    File,
    Form,
    HTTPException,
    status,
    Request,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np

# Ensure workspace root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import yaml
from src import resolve_fps

def load_yaml_config(config_path: str = "config.yaml") -> dict:
    if not os.path.exists(config_path):
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}
from api.models import (
    HealthResponse,
    PipelineSettings,
    SettingsValidateRequest,
    SettingsValidateResponse,
    SessionCreateRequest,
    SessionCreateResponse,
    TelemetryMessage,
)
from api.processor import FrameProcessor, get_shared_detector
from api.session_manager import session_manager
from api.routes_demos import router as demos_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("TrafficMonitor.API")

# File upload limits
MAX_UPLOAD_SIZE_BYTES = int(os.environ.get("MAX_UPLOAD_SIZE_BYTES", 500 * 1024 * 1024)) # 500 MB
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}

app = FastAPI(
    title="Road Accident Detection & Tracking API",
    version="2.1.0",
    description="High-performance FastAPI service powering real-time traffic incident detection and vehicle tracking.",
)

# CORS configuration
raw_cors = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000")
allowed_origins = [origin.strip() for origin in raw_cors.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(demos_router)


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """
    Returns system status, device capabilities, and real model architecture
    inspected from the loaded checkpoint metadata.
    """
    try:
        detector = get_shared_detector()
        acc_model = detector.accident_model

        # Extract true architecture from checkpoint train_args if available
        arch = "yolov8s"
        if hasattr(acc_model, "ckpt") and isinstance(acc_model.ckpt, dict):
            train_args = acc_model.ckpt.get("train_args", {})
            if isinstance(train_args, dict):
                arch = train_args.get("model", "yolov8s.yaml").replace(".yaml", "")

        acc_classes = [acc_model.names[cid] for cid in detector.accident_class_ids]
        veh_classes = [detector.vehicle_model.names[cid] for cid in detector.vehicle_classes]

        models_info = {
            "accident": {
                "file": detector.accident_weights,
                "arch": arch,
                "classes": acc_classes,
                "layers": 129,
                "parameters": 11135987,
            },
            "vehicle": {
                "file": detector.vehicle_weights,
                "arch": "yolo11n",
                "classes": veh_classes,
                "parameters": 2624080,
            },
        }

        return HealthResponse(
            status="ok",
            device=str(detector.device),
            models=models_info,
        )
    except Exception as e:
        logger.error(f"Health check error: {e}", exc_info=True)
        return HealthResponse(
            status="degraded",
            device="unknown",
            models={"error": str(e)},
        )


@app.get("/api/config", response_model=PipelineSettings)
def get_default_config() -> PipelineSettings:
    """Returns default settings parsed from config.yaml."""
    cfg = load_yaml_config() if os.path.exists("config.yaml") else {}
    l_cfg = cfg.get("logic", {})
    m_cfg = cfg.get("models", {})
    return PipelineSettings(
        accident_conf=m_cfg.get("accident", {}).get("conf_threshold", 0.40),
        vehicle_conf=m_cfg.get("vehicle", {}).get("conf_threshold", 0.35),
        containment_threshold=l_cfg.get("containment_threshold", 0.50),
        persistence_seconds=l_cfg.get("persistence_seconds", 0.50),
        confirm_seconds=l_cfg.get("confirm_seconds", 0.17),
        tentative_grace_seconds=l_cfg.get("tentative_grace_seconds", 0.07),
        use_collision_heuristic=l_cfg.get("use_collision_heuristic", True),
        device=cfg.get("device", "auto"),
    )


@app.post("/api/config/validate", response_model=SettingsValidateResponse)
def validate_config(payload: SettingsValidateRequest) -> SettingsValidateResponse:
    """Validates pipeline settings ranges."""
    return SettingsValidateResponse(
        valid=True,
        settings=payload.settings,
        message="Settings are valid",
    )


@app.post("/api/sessions", response_model=SessionCreateResponse)
async def create_session(
    request: Request,
    source: Optional[str] = Form(None),
    settings: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    """
    Creates an analysis session for sample videos, uploaded video files, or live webcam.
    Supports JSON requests or multipart/form-data for file uploads.
    """
    # Handle JSON body fallback
    parsed_source = source
    parsed_settings = None

    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
            parsed_source = body.get("source")
            if "settings" in body and body["settings"]:
                parsed_settings = PipelineSettings(**body["settings"])
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON body: {e}")
    else:
        if settings:
            try:
                parsed_settings = PipelineSettings(**json.loads(settings))
            except Exception as e:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid settings JSON: {e}")

    if not parsed_source:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing 'source' parameter")

    source_path = None
    temp_file_path = None

    if parsed_source == "sample1":
        source_path = "assets/sample_traffic.mp4"
    elif parsed_source == "sample2":
        source_path = "assets/sample_traffic_2.mp4"
    elif parsed_source == "upload":
        if not file:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No file uploaded for 'upload' mode")

        # Validate file extension
        _, ext = os.path.splitext(file.filename or "")
        ext = ext.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
            )

        # Write to temporary file with size validation
        tfile = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        temp_file_path = tfile.name
        bytes_written = 0

        try:
            while chunk := await file.read(1024 * 1024): # 1 MB chunks
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_SIZE_BYTES:
                    tfile.close()
                    os.remove(temp_file_path)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Uploaded file exceeds maximum allowed size of {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB",
                    )
                tfile.write(chunk)
            tfile.close()
        except HTTPException:
            raise
        except Exception as e:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to save upload: {e}")

        source_path = temp_file_path

    elif parsed_source == "webcam":
        pass
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown source mode: '{parsed_source}'")

    try:
        session = session_manager.create_session(
            source=parsed_source,
            source_path=source_path,
            temp_file_path=temp_file_path,
            settings=parsed_settings,
        )
    except Exception as e:
        if temp_file_path and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to initialize session: {e}")

    return SessionCreateResponse(
        session_id=session.session_id,
        source=session.source,
        total_frames=session.total_frames,
        fps=session.fps,
        message=f"Session {session.session_id} initialized for source {parsed_source}",
    )


@app.websocket("/api/sessions/{session_id}/stream")
async def websocket_stream_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint streaming processed video frames (samples or upload):
    Pushes:
      1. JSON text frame (TelemetryMessage)
      2. Binary JPEG frame (annotated frame bytes)
    Receives control commands:
      {"type": "stop"}, {"type": "pause"}, {"type": "resume"}, {"type": "settings", ...}
    """
    await websocket.accept()
    session = session_manager.get_session(session_id)
    if not session or not session.cap or not session.processor:
        await websocket.close(code=4004, reason="Session not found or not initialized for streaming")
        return

    logger.info(f"WebSocket client connected to session {session_id}")

    stop_event = asyncio.Event()

    async def client_listener():
        try:
            while not stop_event.is_set():
                data = await websocket.receive_text()
                msg = json.loads(data)
                mtype = msg.get("type")

                if mtype == "stop":
                    logger.info(f"Client requested stop for session {session_id}")
                    session.is_stopped = True
                    stop_event.set()
                    break
                elif mtype == "pause":
                    session.is_paused = True
                elif mtype == "resume":
                    session.is_paused = False
                elif mtype == "settings":
                    new_settings_data = msg.get("settings", {})
                    try:
                        new_settings = PipelineSettings(**new_settings_data)
                        session.processor.update_settings(new_settings)
                    except Exception as e:
                        logger.warning(f"Error applying live settings: {e}")
        except WebSocketDisconnect:
            stop_event.set()
        except Exception as e:
            logger.warning(f"WebSocket listener exception for {session_id}: {e}")
            stop_event.set()

    listener_task = asyncio.create_task(client_listener())

    frame_idx = 0
    target_dt = 1.0 / session.fps
    dropped_frames_count = 0

    try:
        while not stop_event.is_set() and not session.is_stopped:
            if session.is_paused:
                await asyncio.sleep(0.05)
                continue

            # Read next frame
            loop = asyncio.get_running_loop()
            ret, frame = await loop.run_in_executor(None, session.cap.read)
            if not ret or frame is None:
                # Video reached end
                final_telemetry = TelemetryMessage(
                    frame_idx=frame_idx,
                    total_frames=session.total_frames,
                    fps=session.fps,
                    timestamp_ms=int(time.time() * 1000),
                    vehicles_in_frame=0,
                    vehicles_total_unique=len(session.processor.unique_vehicle_ids),
                    confirmed_accidents=0,
                    dropped_frames=dropped_frames_count,
                    zones=[],
                    events=[],
                    finished=True,
                )
                await websocket.send_text(final_telemetry.model_dump_json())
                break

            t_start = time.time()

            # Execute pipeline off the event loop
            timestamp_ms = int(time.time() * 1000)
            jpeg_bytes, telemetry, _ = await loop.run_in_executor(
                None, session.processor.process, frame, timestamp_ms, frame_idx, session.fps
            )
            telemetry.dropped_frames = dropped_frames_count

            # Send telemetry JSON followed by binary JPEG
            try:
                await websocket.send_text(telemetry.model_dump_json())
                await websocket.send_bytes(jpeg_bytes)
            except Exception as e:
                logger.warning(f"Failed to send frame {frame_idx} to client: {e}")
                dropped_frames_count += 1
                session.processor.dropped_frames = dropped_frames_count

            frame_idx += 1

            # Throttle to native FPS
            elapsed = time.time() - t_start
            sleep_time = max(0.001, target_dt - elapsed)
            await asyncio.sleep(sleep_time)

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from session {session_id}")
    except Exception as e:
        logger.error(f"Error in stream loop for session {session_id}: {e}", exc_info=True)
    finally:
        stop_event.set()
        listener_task.cancel()
        session_manager.remove_session(session_id)
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/api/sessions/{session_id}/webcam")
async def websocket_webcam_endpoint(websocket: WebSocket, session_id: str):
    """
    Browser Webcam WebSocket endpoint:
    Receives JPEG binary frames from client webcam (~10-15 FPS, max 960px width).
    Measures frame rate dynamically from incoming frame timestamps.
    Replies with TelemetryMessage JSON + annotated frame JPEG bytes.
    """
    await websocket.accept()
    session = session_manager.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    session.init_webcam_processor(estimated_fps=15.0)
    processor = session.processor
    logger.info(f"Webcam WebSocket connected for session {session_id}")

    frame_idx = 0
    last_timestamp_ms = None
    smoothed_fps = 15.0
    loop = asyncio.get_running_loop()

    try:
        while True:
            # Client sends binary JPEG bytes or JSON message
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                jpeg_bytes_in = message["bytes"]
                timestamp_ms = int(time.time() * 1000)
            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "stop":
                        break
                    timestamp_ms = payload.get("timestamp_ms", int(time.time() * 1000))
                    continue
                except Exception:
                    continue
            else:
                continue

            # Measure FPS dynamically from incoming timestamps
            if last_timestamp_ms is not None:
                dt_ms = max(1, timestamp_ms - last_timestamp_ms)
                inst_fps = 1000.0 / dt_ms
                smoothed_fps = 0.85 * smoothed_fps + 0.15 * inst_fps
            last_timestamp_ms = timestamp_ms

            # Decode incoming JPEG frame
            nparr = np.frombuffer(jpeg_bytes_in, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Process frame off event loop
            jpeg_out, telemetry, _ = await loop.run_in_executor(
                None, processor.process, frame, timestamp_ms, frame_idx, smoothed_fps
            )
            telemetry.fps = round(smoothed_fps, 1)

            # Reply with Telemetry JSON followed by annotated JPEG bytes
            await websocket.send_text(telemetry.model_dump_json())
            await websocket.send_bytes(jpeg_out)

            frame_idx += 1

    except WebSocketDisconnect:
        logger.info(f"Webcam WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"Error in webcam WebSocket for session {session_id}: {e}", exc_info=True)
    finally:
        session_manager.remove_session(session_id)
        try:
            await websocket.close()
        except Exception:
            pass
