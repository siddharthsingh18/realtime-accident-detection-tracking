import os
import cv2
import json
import time
import pytest
import numpy as np
from fastapi.testclient import TestClient

from api.main import app
from api import db
from api.models import PipelineSettings
from api.session_manager import session_manager, MAX_CONCURRENT_SESSIONS
from api.processor import FrameProcessor

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    db.init_db()
    # Clean test incidents
    conn = db.get_connection()
    with conn:
        conn.execute("DELETE FROM verdict_audit")
        conn.execute("DELETE FROM incidents")
    conn.close()


def test_incident_lifecycle_and_verdict_audit():
    # Insert incident
    inc = db.insert_incident(
        incident_id="inc_test_001",
        camera_id="cam_01",
        session_id="sess_001",
        zone_id=1,
        origin="detector",
        confirmed_at="2026-11-21T06:00:00Z",
        peak_conf=0.85,
        bbox=[100.0, 150.0, 300.0, 400.0],
        involved_ids=[2, 3],
        snapshot_path="data/incidents/inc_test_001.jpg",
        clip_path="data/incidents/inc_test_001.mp4",
        settings={"accident_conf": 0.40},
        model_info={"arch": "yolov8s"},
    )
    assert inc["id"] == "inc_test_001"
    assert inc["origin"] == "detector"
    assert inc["verdict"] is None

    # Retrieve via API
    res = client.get("/api/incidents/inc_test_001")
    assert res.status_code == 200
    data = res.json()
    assert data["zone_id"] == 1
    assert data["involved_vehicle_ids"] == [2, 3]

    # Update verdict to true_accident
    res_patch = client.patch(
        "/api/incidents/inc_test_001/verdict",
        json={"verdict": "true_accident", "note": "Clear rear-end impact"},
    )
    assert res_patch.status_code == 200
    updated = res_patch.json()
    assert updated["verdict"] == "true_accident"
    assert updated["verdict_note"] == "Clear rear-end impact"

    # Verify audit trail
    res_audit = client.get("/api/incidents/inc_test_001/audit")
    assert res_audit.status_code == 200
    audit_rows = res_audit.json()
    assert len(audit_rows) == 1
    assert audit_rows[0]["new_verdict"] == "true_accident"

    # Soft delete and restore (10s undo window)
    res_del = client.delete("/api/incidents/inc_test_001")
    assert res_del.status_code == 200

    # Verify hidden from standard list
    res_list = client.get("/api/incidents")
    assert res_list.status_code == 200
    assert len(res_list.json()["items"]) == 0

    # Restore
    res_restore = client.post("/api/incidents/inc_test_001/restore")
    assert res_restore.status_code == 200
    res_list2 = client.get("/api/incidents")
    assert len(res_list2.json()["items"]) == 1


def test_incidents_csv_export():
    db.insert_incident(
        incident_id="inc_export_test",
        camera_id="cam_01",
        session_id="sess_01",
        zone_id=1,
        origin="collision_heuristic",
        confirmed_at="2026-11-21T06:10:00Z",
        peak_conf=0.75,
        bbox=[50, 50, 150, 150],
        involved_ids=[1],
        snapshot_path="",
        clip_path="",
        settings={},
        model_info={},
    )

    res = client.get("/api/incidents/export.csv")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    text = res.text
    assert "inc_export_test" in text
    assert "collision_heuristic" in text
    assert "# Road Incident Export" in text


def test_stats_counts_and_honesty_caveats():
    # Insert 3 incidents: 2 false alarms, 1 true accident
    for i in range(2):
        inc_id = f"inc_fa_{i}"
        db.insert_incident(
            incident_id=inc_id,
            camera_id="cam_01",
            session_id="sess_01",
            zone_id=i,
            origin="detector",
            confirmed_at="2026-11-21T07:00:00Z",
            peak_conf=0.70,
            bbox=[0, 0, 10, 10],
            involved_ids=[],
            snapshot_path="",
            clip_path="",
            settings={},
            model_info={},
        )
        db.update_incident_verdict(inc_id, "false_alarm", note="Lane change")

    db.insert_incident(
        incident_id="inc_ta_1",
        camera_id="cam_01",
        session_id="sess_01",
        zone_id=9,
        origin="both",
        confirmed_at="2026-11-21T07:30:00Z",
        peak_conf=0.92,
        bbox=[0, 0, 10, 10],
        involved_ids=[],
        snapshot_path="",
        clip_path="",
        settings={},
        model_info={},
    )
    db.update_incident_verdict("inc_ta_1", "true_accident", note="Severe crash")

    res = client.get("/api/stats")
    assert res.status_code == 200
    stats = res.json()
    assert stats["total_incidents"] == 3
    assert stats["reviewed_count"] == 3
    assert stats["false_alarm_count"] == 2
    assert stats["true_accident_count"] == 1
    assert stats["false_alarm_share"] == round(2 / 3, 4)
    assert stats["insufficient_data"] is True  # < 20 reviews
    assert "Based only on incidents an operator reviewed" in stats["operator_caveat"]


def test_four_session_cap_and_409_rejection():
    created_ids = []
    try:
        # Create 4 concurrent sessions
        for i in range(MAX_CONCURRENT_SESSIONS):
            res = client.post("/api/sessions", json={"source": "sample1", "camera_id": f"cam_0{i+1}"})
            assert res.status_code == 200
            created_ids.append(res.json()["session_id"])

        # 5th session must receive 409 Conflict
        res_5th = client.post("/api/sessions", json={"source": "sample1", "camera_id": "cam_05"})
        assert res_5th.status_code == 409
        assert "Hardware capacity reached" in res_5th.json()["detail"]
    finally:
        for sid in created_ids:
            session_manager.remove_session(sid)


def test_ignore_region_server_side_filtering():
    # Polygon around top-left (0,0) to (200,200)
    ignore_poly = [[0, 0], [200, 0], [200, 200], [0, 200]]
    processor = FrameProcessor(
        settings=PipelineSettings(),
        fps=30.0,
        ignore_region=ignore_poly,
    )

    # Box inside ignore region
    box_inside = [50, 50, 150, 150]
    assert processor.is_in_ignore_region(box_inside, frame_w=1280, frame_h=720) is True

    # Box outside ignore region
    box_outside = [300, 300, 450, 450]
    assert processor.is_in_ignore_region(box_outside, frame_w=1280, frame_h=720) is False

    # Test normalized coordinates [0..1]
    norm_poly = [[0.0, 0.0], [0.25, 0.0], [0.25, 0.25], [0.0, 0.25]]
    norm_processor = FrameProcessor(
        settings=PipelineSettings(),
        fps=30.0,
        ignore_region=norm_poly,
    )
    # Box inside (100, 100 on 1000x1000 -> 0.1, 0.1)
    assert norm_processor.is_in_ignore_region([50, 50, 150, 150], frame_w=1000, frame_h=1000) is True
    # Box outside (500, 500 on 1000x1000 -> 0.5, 0.5)
    assert norm_processor.is_in_ignore_region([450, 450, 550, 550], frame_w=1000, frame_h=1000) is False


def test_detection_inside_ignore_polygon_produces_no_alert(monkeypatch):
    """
    Verify that an accident detection whose centroid falls inside a normalized ignore polygon
    is discarded server-side and produces no confirmed alerts or incident DB entries.
    """
    # Top-left quadrant ignore polygon in normalized coordinates: [0.0..0.4] x [0.0..0.4]
    norm_ignore_poly = [[0.0, 0.0], [0.4, 0.0], [0.4, 0.4], [0.0, 0.4]]
    settings = PipelineSettings(confirm_seconds=0.03, persistence_seconds=0.1)
    processor = FrameProcessor(
        settings=settings,
        fps=30.0,
        camera_id="cam_test_ignore",
        ignore_region=norm_ignore_poly,
    )

    frame = np.zeros((720, 1280, 3), dtype=np.uint8)

    # 1. Detection inside ignore region: centroid at (150, 150) -> normalized (0.117, 0.208)
    det_inside = [{"bbox": [100.0, 100.0, 200.0, 200.0], "conf": 0.95, "class_name": "accident"}]
    monkeypatch.setattr(processor.detector, "detect_accidents", lambda f: det_inside)
    monkeypatch.setattr(processor.tracker, "update", lambda f, fps=30.0: [])

    # Process 5 consecutive frames
    for i in range(5):
        jpeg, telemetry, _ = processor.process(frame, frame_idx=i)
        # Assert no alerts produced
        assert telemetry.confirmed_accidents == 0
        assert not any(ev.type == "confirmed" for ev in telemetry.events)
        assert len(processor.persistence_mgr.active_zones) == 0

    # 2. Detection outside ignore region: centroid at (800, 500) -> normalized (0.625, 0.694)
    det_outside = [{"bbox": [750.0, 450.0, 850.0, 550.0], "conf": 0.95, "class_name": "accident"}]
    monkeypatch.setattr(processor.detector, "detect_accidents", lambda f: det_outside)

    confirmed_seen = False
    for i in range(5, 12):
        jpeg, telemetry, _ = processor.process(frame, frame_idx=i)
        if any(ev.type == "confirmed" for ev in telemetry.events):
            confirmed_seen = True
            assert telemetry.confirmed_accidents >= 1
            break

    assert confirmed_seen is True, "Detection outside ignore polygon should confirm and produce alert"


def test_cameras_crud_and_ignore_region_persistence():
    # Upsert new camera
    cam_data = {
        "name": "Test Highway Camera",
        "source": "sample2",
        "lat": 28.5355,
        "lng": 77.3910,
        "notes": "Testing camera",
        "settings_profile": {"accident_conf": 0.55},
        "ignore_region": [[10, 10], [100, 10], [100, 100], [10, 100]],
    }
    res = client.put("/api/cameras/cam_test_99", json=cam_data)
    assert res.status_code == 200
    saved = res.json()
    assert saved["id"] == "cam_test_99"
    assert saved["name"] == "Test Highway Camera"
    assert len(saved["ignore_region"]) == 4

    # Fetch camera list
    res_list = client.get("/api/cameras")
    assert res_list.status_code == 200
    cams = res_list.json()
    assert any(c["id"] == "cam_test_99" for c in cams)

    # Delete camera
    res_del = client.delete("/api/cameras/cam_test_99")
    assert res_del.status_code == 200


def test_compare_endpoint_runs_two_profiles():
    payload = {
        "source": "sample1",
        "profile_a_settings": {"use_collision_heuristic": True},
        "profile_b_settings": {"use_collision_heuristic": False},
        "profile_a_name": "Heuristic ON",
        "profile_b_name": "Heuristic OFF",
        "max_frames": 40,
    }
    res = client.post("/api/compare", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "run_a" in data
    assert "run_b" in data
    assert data["run_a"]["profile_name"] == "Heuristic ON"
    assert data["run_b"]["profile_name"] == "Heuristic OFF"
    assert "Raw counts and frame ranges only" in data["caveat"]

