import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "threads;1"
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
    Query,
    Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
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
    ZoneTelemetry,
    SystemStatusResponse,
)
from api.processor import FrameProcessor, get_shared_detector
from api.session_manager import session_manager
from api.routes_demos import router as demos_router
from api.routes_incidents import router as incidents_router
from api.routes_cameras import router as cameras_router
from api.routes_compare import router as compare_router
from api.routes_notifications import router as notifications_router
from api.sse import alert_bus
from api import db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("TrafficMonitor.API")

# File upload limits
MAX_UPLOAD_SIZE_BYTES = int(os.environ.get("MAX_UPLOAD_SIZE_BYTES", 500 * 1024 * 1024))  # 500 MB
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}

# Optional Bearer Token Authentication
API_TOKEN = os.environ.get("API_TOKEN")

app = FastAPI(
    title="Road Accident Detection & Incident Command API",
    version="2.2.0",
    description="Operator-grade FastAPI service powering real-time CCTV monitoring, incident persistence, and multi-camera coordination.",
)

# Initialize database schema & default cameras
db.init_db()

# Optional Bearer Check Hook
@app.middleware("http")
async def optional_api_token_middleware(request: Request, call_next):
    if API_TOKEN:
        # Exclude public docs and health endpoints
        if request.url.path not in ("/api/health", "/docs", "/openapi.json"):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer ") or auth_header[7:] != API_TOKEN:
                return JSONResponse(status_code=401, content={"detail": "Unauthorized: valid Bearer token required"})
    response = await call_next(request)
    return response


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
app.include_router(incidents_router)
app.include_router(cameras_router)
app.include_router(compare_router)
app.include_router(notifications_router)


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """
    Returns system status, device capabilities, and real model architecture
    inspected from the loaded checkpoint metadata.
    """
    try:
        detector = get_shared_detector()
        acc_model = detector.accident_model

        arch = "yolov8s"
        if hasattr(acc_model, "ckpt") and isinstance(acc_model.ckpt, dict):
            train_args = acc_model.ckpt.get("train_args", {})
            if isinstance(train_args, dict):
                arch = train_args.get("model", "yolov8s.yaml").replace(".yaml", "")

        acc_classes = {str(cid): acc_model.names[cid] for cid in detector.accident_class_ids}
        veh_classes = [detector.vehicle_model.names[cid] for cid in detector.vehicle_classes]

        models_info = {
            "accident": {
                "file": detector.accident_weights,
                "arch": arch,
                "classes": acc_classes,
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
        iou_threshold=l_cfg.get("iou_match_threshold", 0.30),
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


@app.get("/api/system", response_model=SystemStatusResponse)
def get_system_status() -> SystemStatusResponse:
    """Returns concurrent session usage, per-camera FPS, and hardware contention metrics."""
    detector = get_shared_detector()
    data = session_manager.get_system_status(device=str(detector.device))
    return SystemStatusResponse(**data)


@app.get("/api/stats")
def get_incident_stats(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    camera_id: Optional[str] = Query(None, alias="camera"),
):
    """Returns incident counts, origin breakdowns, verdict counts, and reviewed false alarm share."""
    return db.get_stats(from_date=from_date, to_date=to_date, camera_id=camera_id)


@app.get("/api/alerts/stream")
async def sse_alerts_stream():
    """
    Server-Sent Events (SSE) channel that emits only 'confirmed', 'cleared',
    'verdict' and 'system_warning' events across all cameras.
    """
    queue = alert_bus.subscribe()

    async def event_generator():
        try:
            # Initial ping
            yield "event: connected\ndata: {\"status\":\"listening\"}\n\n"
            while True:
                msg = await queue.get()
                ev_type = msg.get("event", "alert")
                ev_data = json.dumps(msg.get("data", {}))
                yield f"event: {ev_type}\ndata: {ev_data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            alert_bus.unsubscribe(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/sessions", response_model=SessionCreateResponse)
async def create_session(
    request: Request,
    source: Optional[str] = Form(None),
    camera_id: Optional[str] = Form(None),
    settings: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    """
    Creates an analysis session for sample videos, uploaded video files, or live webcam.
    Enforces maximum of 4 concurrent sessions with HTTP 409 Conflict rejection.
    """
    parsed_source = source
    parsed_camera_id = camera_id or "cam_01"
    parsed_settings = None

    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            body = await request.json()
            parsed_source = body.get("source")
            parsed_camera_id = body.get("camera_id") or parsed_camera_id
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

        _, ext = os.path.splitext(file.filename or "")
        ext = ext.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
            )

        tfile = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        temp_file_path = tfile.name
        bytes_written = 0

        try:
            while chunk := await file.read(1024 * 1024):
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

    session = session_manager.create_session(
        source=parsed_source,
        camera_id=parsed_camera_id,
        source_path=source_path,
        temp_file_path=temp_file_path,
        settings=parsed_settings,
    )

    return SessionCreateResponse(
        session_id=session.session_id,
        source=session.source,
        camera_id=session.camera_id,
        total_frames=session.total_frames,
        fps=session.fps,
        message=f"Session {session.session_id} initialized for camera {session.camera_id}",
    )


@app.websocket("/api/sessions/{session_id}/stream")
async def websocket_stream_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = session_manager.get_session(session_id)
    if not session or not session.cap or not session.processor:
        await websocket.close(code=4004, reason="Session not found or not initialized for streaming")
        return

    session.status = "running"
    logger.info(f"WebSocket client connected to session {session_id} on camera {session.camera_id}")

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
                    session.status = "finished"
                    stop_event.set()
                    break
                elif mtype == "pause":
                    session.is_paused = True
                    session.status = "paused"
                elif mtype == "resume":
                    session.is_paused = False
                    session.status = "running"
                elif mtype == "settings":
                    new_settings_data = msg.get("settings")
                    if not isinstance(new_settings_data, dict):
                        new_settings_data = {k: v for k, v in msg.items() if k != "type"}
                    try:
                        current_dict = session.processor.settings.model_dump()
                        current_dict.update(new_settings_data)
                        new_settings = PipelineSettings(**current_dict)
                        session.processor.update_settings(new_settings)
                        session.settings = new_settings
                        logger.info(f"Live settings applied for session {session_id}: {new_settings_data}")
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

            loop = asyncio.get_running_loop()
            ret, frame = await loop.run_in_executor(None, session.read_frame)
            if not ret or frame is None:
                all_final_zones = session.processor.persistence_mgr.all_zones()
                final_zones = [
                    ZoneTelemetry(
                        zone_id=z.zone_id,
                        status=z.status,
                        conf=float(z.conf),
                        bbox=(float(z.bbox[0]), float(z.bbox[1]), float(z.bbox[2]), float(z.bbox[3])),
                        involved_vehicle_ids=list(z.involved_vehicle_ids),
                        speed_loss_pct=getattr(z, "speed_loss_pct", None),
                        first_seen_frame=getattr(z, "first_seen_frame", frame_idx),
                        confirmed_at_ms=int(time.time() * 1000) if z.status in ("ACTIVE", "MAINTAINED") else None,
                        origin=session.processor.zone_origins.get(z.zone_id, "detector"),
                    )
                    for z in all_final_zones
                ]
                final_telemetry = TelemetryMessage(
                    frame_idx=frame_idx,
                    total_frames=session.total_frames,
                    fps=session.fps,
                    timestamp_ms=int(time.time() * 1000),
                    camera_id=session.camera_id,
                    vehicles_in_frame=0,
                    vehicles_total_unique=len(session.processor.unique_vehicle_ids),
                    confirmed_accidents=len(session.processor.persistence_mgr.confirmed_zones()),
                    dropped_frames=dropped_frames_count,
                    zones=final_zones,
                    events=[],
                    finished=True,
                )
                await websocket.send_text(final_telemetry.model_dump_json())
                session.status = "finished"
                break

            t_start = time.time()
            timestamp_ms = int(time.time() * 1000)

            jpeg_bytes, telemetry, _ = await loop.run_in_executor(
                None, session.processor.process, frame, timestamp_ms, frame_idx, session.fps
            )
            telemetry.dropped_frames = dropped_frames_count
            session.current_fps = telemetry.fps

            # Broadcast new alert events to global SSE bus
            for ev in telemetry.events:
                asyncio.create_task(alert_bus.broadcast(ev.type, ev.model_dump()))

            try:
                await websocket.send_text(telemetry.model_dump_json())
                await websocket.send_bytes(jpeg_bytes)
            except Exception as e:
                logger.warning(f"Failed to send frame {frame_idx} to client: {e}")
                dropped_frames_count += 1
                session.processor.dropped_frames = dropped_frames_count
                session.dropped_frames = dropped_frames_count

            frame_idx += 1
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
    await websocket.accept()
    session = session_manager.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    session.init_webcam_processor(estimated_fps=15.0)
    processor = session.processor
    session.status = "running"
    logger.info(f"Webcam WebSocket connected for session {session_id}")

    frame_idx = 0
    last_timestamp_ms = None
    smoothed_fps = 15.0
    loop = asyncio.get_running_loop()

    try:
        while True:
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

            if last_timestamp_ms is not None:
                dt_ms = max(1, timestamp_ms - last_timestamp_ms)
                inst_fps = 1000.0 / dt_ms
                smoothed_fps = 0.85 * smoothed_fps + 0.15 * inst_fps
            last_timestamp_ms = timestamp_ms

            nparr = np.frombuffer(jpeg_bytes_in, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            jpeg_out, telemetry, _ = await loop.run_in_executor(
                None, processor.process, frame, timestamp_ms, frame_idx, smoothed_fps
            )
            telemetry.fps = round(smoothed_fps, 1)
            session.current_fps = telemetry.fps

            # Broadcast events to SSE bus
            for ev in telemetry.events:
                asyncio.create_task(alert_bus.broadcast(ev.type, ev.model_dump()))

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
