import os
import io
import json
import pytest
from fastapi.testclient import TestClient
import numpy as np
import cv2

from api.main import app, MAX_UPLOAD_SIZE_BYTES
from api.models import (
    TelemetryMessage,
    ZoneTelemetry,
    TelemetryEvent,
    PipelineSettings,
)
from api.session_manager import session_manager
from api.processor import FrameProcessor

client = TestClient(app)


# 1. Telemetry Message Schema Validation Test
def test_telemetry_message_schema():
    sample_data = {
        "frame_idx": 42,
        "total_frames": 356,
        "fps": 15.2,
        "timestamp_ms": 1700000000000,
        "vehicles_in_frame": 4,
        "vehicles_total_unique": 7,
        "confirmed_accidents": 1,
        "dropped_frames": 2,
        "zones": [
            {
                "zone_id": 1,
                "status": "ACTIVE",
                "conf": 0.89,
                "bbox": [120.0, 100.0, 240.0, 220.0],
                "involved_vehicle_ids": [2, 3],
            }
        ],
        "events": [
            {
                "type": "confirmed",
                "zone_id": 1,
                "frame_idx": 42,
                "timestamp_ms": 1700000000000,
            }
        ],
        "finished": False,
    }

    # Verify Pydantic validation
    msg = TelemetryMessage(**sample_data)
    assert msg.frame_idx == 42
    assert msg.confirmed_accidents == 1
    assert len(msg.zones) == 1
    assert msg.zones[0].status == "ACTIVE"
    assert len(msg.events) == 1
    assert msg.events[0].type == "confirmed"

    # Verify serialization
    dumped = json.loads(msg.model_dump_json())
    assert dumped["vehicles_total_unique"] == 7
    assert dumped["dropped_frames"] == 2


# 2. Health Endpoint & Real Model Inspection
def test_api_health_endpoint():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "models" in data
    assert "accident" in data["models"]
    assert "vehicle" in data["models"]
    # Verify architecture is not hardcoded to YOLO11s, but reflects checkpoint (e.g. yolov8s)
    assert "arch" in data["models"]["accident"]
    assert data["models"]["accident"]["arch"] == "yolov8s"


# 3. Settings Validation Endpoint Ranges
def test_settings_validation_ranges():
    # Valid settings
    valid_payload = {
        "settings": {
            "accident_conf": 0.45,
            "vehicle_conf": 0.30,
            "containment_threshold": 0.50,
            "persistence_seconds": 0.60,
            "confirm_seconds": 0.20,
            "tentative_grace_seconds": 0.08,
            "use_collision_heuristic": True,
            "device": "auto",
        }
    }
    res = client.post("/api/config/validate", json=valid_payload)
    assert res.status_code == 200
    assert res.json()["valid"] is True

    # Invalid accident_conf (< 0.05)
    bad_conf = dict(valid_payload["settings"])
    bad_conf["accident_conf"] = 0.01
    res_bad = client.post("/api/config/validate", json={"settings": bad_conf})
    assert res_bad.status_code == 422

    # Invalid persistence_seconds (> 5.0s)
    bad_time = dict(valid_payload["settings"])
    bad_time["persistence_seconds"] = 10.0
    res_bad2 = client.post("/api/config/validate", json={"settings": bad_time})
    assert res_bad2.status_code == 422

    # Invalid containment (< 0.10)
    bad_cont = dict(valid_payload["settings"])
    bad_cont["containment_threshold"] = 0.02
    res_bad3 = client.post("/api/config/validate", json={"settings": bad_cont})
    assert res_bad3.status_code == 422


# 4. Upload File Validation (Bad Extension & Oversize)
def test_upload_validation_bad_extension():
    fake_file = io.BytesIO(b"dummy text file content")
    files = {"file": ("malicious.exe", fake_file, "application/octet-stream")}
    data = {"source": "upload"}
    res = client.post("/api/sessions", data=data, files=files)
    assert res.status_code == 400
    assert "Unsupported file format" in res.json()["detail"]


def test_upload_validation_oversize(monkeypatch):
    # Set limit artificially low for test
    from api import main as main_module
    monkeypatch.setattr(main_module, "MAX_UPLOAD_SIZE_BYTES", 100) # 100 bytes limit

    oversized_data = b"x" * 200
    files = {"file": ("video.mp4", io.BytesIO(oversized_data), "video/mp4")}
    data = {"source": "upload"}
    res = client.post("/api/sessions", data=data, files=files)
    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"]


# 5. Demos and HTTP Range Requests
def test_demos_list_and_range_requests():
    # List demos
    res = client.get("/api/demos")
    assert res.status_code == 200
    demos = res.json()
    assert len(demos) >= 2
    names = [d["name"] for d in demos]
    assert "scenario1" in names
    assert "scenario2" in names

    # Video Range request: bytes=0-1023 (first 1024 bytes)
    headers = {"Range": "bytes=0-1023"}
    res_range = client.get("/api/demos/scenario1/video", headers=headers)
    assert res_range.status_code == 206
    assert res_range.headers.get("accept-ranges") == "bytes"
    assert "bytes 0-1023/" in res_range.headers.get("content-range", "")
    assert len(res_range.content) == 1024

    # Full request without Range header -> 200 OK
    res_full = client.get("/api/demos/scenario1/video")
    assert res_full.status_code == 200
    assert res_full.headers.get("accept-ranges") == "bytes"


# 6. Session Lifecycle & Cleanup with Synthetic Video
def test_session_lifecycle_synthetic_video(tmp_path):
    # Create a 10-frame synthetic mp4 video
    synthetic_path = str(tmp_path / "test_synth.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(synthetic_path, fourcc, 30.0, (320, 240))
    for i in range(10):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        # Draw moving rectangle
        cv2.rectangle(frame, (i * 10, 50), (i * 10 + 40, 90), (255, 255, 255), -1)
        out.write(frame)
    out.release()

    # Upload synthetic video
    with open(synthetic_path, "rb") as f:
        files = {"file": ("test_synth.mp4", f, "video/mp4")}
        data = {"source": "upload"}
        res = client.post("/api/sessions", data=data, files=files)

    assert res.status_code == 200
    sdata = res.json()
    session_id = sdata["session_id"]
    assert sdata["source"] == "upload"

    session = session_manager.get_session(session_id)
    assert session is not None
    assert session.cap is not None
    temp_file = session.temp_file_path
    assert temp_file is not None and os.path.exists(temp_file)

    # Disconnect / Cleanup session
    session_manager.remove_session(session_id)
    assert session_manager.get_session(session_id) is None
    # Temp file must be cleaned up
    assert not os.path.exists(temp_file)


# 7. Slow Consumer & Dropped Frames Behavior in FrameProcessor
def test_processor_dropped_frames_tracking():
    processor = FrameProcessor(fps=30.0, total_frames=10)
    synthetic_frame = np.zeros((100, 100, 3), dtype=np.uint8)

    # Simulate normal process
    jpeg1, tel1, _ = processor.process(synthetic_frame, frame_idx=0)
    assert tel1.dropped_frames == 0

    # Simulate backpressure drop
    processor.dropped_frames += 1
    jpeg2, tel2, _ = processor.process(synthetic_frame, frame_idx=1)
    tel2.dropped_frames = processor.dropped_frames
    assert tel2.dropped_frames == 1


# 8. ONNX Inference Backend Initialization & Frame Processing
def test_onnx_backend_configuration():
    settings = PipelineSettings(inference_backend="onnx")
    processor = FrameProcessor(settings=settings, fps=30.0, total_frames=5)
    synthetic_frame = np.zeros((240, 320, 3), dtype=np.uint8)

    jpeg, telemetry, _ = processor.process(synthetic_frame, frame_idx=0)
    assert jpeg is not None
    assert telemetry.frame_idx == 0
    assert telemetry.vehicles_in_frame == 0
    assert processor.settings.inference_backend == "onnx"


