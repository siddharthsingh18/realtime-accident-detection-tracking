"""
Unit tests for the Incident Evidence Dossier system:
- Report data assembly across varied states (complete, missing kinematics, uncalibrated, unreviewed).
- Structured JSON export schema validation and ISO 8601 formatting.
- OASIS CAP 1.2 XML well-formedness and experimental tagging.
- ReportLab A4 PDF generation and Matplotlib kinematic charts.
- PDF disk cache lifecycle and verdict-driven cache invalidation.
- FastAPI dossier endpoints (/dossier.pdf, /dossier.json, /dossier.cap.xml, /bundle.zip).
"""

import os
import io
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from api import db, dossier
from api.main import app


@pytest.fixture(autouse=True)
def setup_test_db(tmp_path, monkeypatch):
    """Initializes isolated SQLite database for each test run."""
    test_db = str(tmp_path / "test_incidents.db")
    monkeypatch.setattr(db, "DB_PATH", test_db)
    monkeypatch.setattr(dossier, "INCIDENTS_DIR", str(tmp_path / "incidents"))
    os.makedirs(str(tmp_path / "incidents"), exist_ok=True)
    db.init_db()


def test_extract_track_time_series_calibrated():
    """Verifies that calibrated tracks produce metric speeds (km/h) and decel (m/s²)."""
    class MockVehicle:
        track_id = 1
        ground_history = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (2.2, 0.0)]

    vehicles = [MockVehicle()]
    res = dossier.extract_track_time_series(vehicles, involved_ids=[1], fps=10.0, is_calibrated=True)

    assert res["is_calibrated"] is True
    assert res["speed_unit"] == "km/h"
    assert res["decel_unit"] == "m/s²"
    assert "1" in res["vehicles"]
    pts = res["vehicles"]["1"]
    assert len(pts) == 3
    assert pts[-1]["t_rel_s"] == 0.0
    # Speed at last step: dx = 0.2m in 0.1s => 2.0 m/s * 3.6 = 7.2 km/h
    assert pts[-1]["speed"] == 7.2
    # Deceleration at last step from 36 km/h to 7.2 km/h => (10 - 2) / 0.1 = 80 m/s^2
    assert pts[-1]["decel"] > 0


def test_extract_track_time_series_uncalibrated():
    """Verifies that uncalibrated tracks produce pixel speeds (px/s) and decel (px/s²)."""
    class MockVehicle:
        track_id = 2
        history = [(100.0, 200.0), (120.0, 200.0), (130.0, 200.0)]

    vehicles = [MockVehicle()]
    res = dossier.extract_track_time_series(vehicles, involved_ids=[2], fps=10.0, is_calibrated=False)

    assert res["is_calibrated"] is False
    assert res["speed_unit"] == "px/s"
    assert res["decel_unit"] == "px/s²"
    pts = res["vehicles"]["2"]
    assert len(pts) == 2
    assert pts[-1]["speed"] == 100.0  # 10 px * 10 fps


def test_assemble_dossier_data_complete():
    """Tests assembly with all kinematics, camera coordinates, and operator review present."""
    inc_id = "inc_test_full"
    now_iso = datetime.now(timezone.utc).isoformat()

    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at=now_iso,
        peak_conf=0.95,
        bbox=[100, 100, 200, 200],
        involved_ids=[1, 2],
        snapshot_path=None,
        clip_path=None,
        settings={"vehicle_conf": 0.35},
        model_info={"accident_model": "YOLOv8s"},
        kinematics={
            "is_calibrated": True,
            "ttc_s": 1.25,
            "closing_speed_mps": 14.5,
            "max_peak_decel_mps2": 8.2,
            "relative_speed_drop_mps": 6.0,
            "is_queued_traffic": False,
        },
        time_series={
            "is_calibrated": True,
            "speed_unit": "km/h",
            "decel_unit": "m/s²",
            "vehicles": {"1": [{"t_rel_s": -0.5, "speed": 50.0, "decel": 0.0}, {"t_rel_s": 0.0, "speed": 10.0, "decel": 8.0}]},
        },
    )
    db.update_incident_verdict(inc_id, verdict="true_accident", note="Clear side impact")

    data = dossier.assemble_dossier_data(inc_id)

    assert data["incident_id"] == inc_id
    assert data["schema_version"] == "1.0.0"
    assert data["camera"]["name"] == "Camera 01: North Junction"
    assert data["camera"]["lat"] == 28.6139
    assert data["classification"]["peak_conf"] == 0.95
    assert data["kinematics"]["ttc_s"] == 1.25
    assert data["operator_review"]["verdict"] == "true_accident"
    assert data["operator_review"]["verdict_note"] == "Clear side impact"


def test_assemble_dossier_data_missing_kinematics_and_unreviewed():
    """Tests assembly when kinematics is null and incident is unreviewed."""
    inc_id = "inc_test_minimal"
    now_iso = datetime.now(timezone.utc).isoformat()

    # Create uncalibrated camera without coordinates
    db.upsert_camera(camera_id="cam_uncal", name="Indoor Garage Cam", source="test", lat=None, lng=None, heading=None)

    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_uncal",
        session_id="sess_2",
        zone_id=2,
        origin="collision_heuristic",
        confirmed_at=now_iso,
        peak_conf=0.75,
        bbox=[50, 50, 150, 150],
        involved_ids=[3],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={},
        kinematics=None,
        time_series=None,
    )

    data = dossier.assemble_dossier_data(inc_id)

    assert data["incident_id"] == inc_id
    assert data["kinematics"] is None
    assert data["camera"]["lat"] is None
    assert data["camera"]["lng"] is None
    assert data["operator_review"]["verdict"] == "Not yet reviewed"
    assert data["operator_review"]["verdict_note"] == "Not available"


def test_generate_dossier_json():
    """Verifies structured JSON export format."""
    inc_id = "inc_json_test"
    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        peak_conf=0.88,
        bbox=[0, 0, 10, 10],
        involved_ids=[1],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={},
    )

    data = dossier.assemble_dossier_data(inc_id)
    json_out = dossier.generate_dossier_json(data)

    assert json_out["schema_version"] == "1.0.0"
    assert json_out["incident_id"] == inc_id
    assert "classification" in json_out
    assert "evidence_files" in json_out


def test_generate_dossier_cap_xml_well_formed():
    """Parses generated CAP 1.2 XML with ElementTree to ensure valid XML structure."""
    inc_id = "inc_cap_test"
    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at="2026-11-26T00:00:00+00:00",
        peak_conf=0.91,
        bbox=[10, 20, 30, 40],
        involved_ids=[1, 2],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={"accident_model": "YOLOv8s"},
        kinematics={"is_calibrated": True, "ttc_s": 0.8},
    )

    data = dossier.assemble_dossier_data(inc_id)
    xml_str = dossier.generate_dossier_cap_xml(data)

    root = ET.fromstring(xml_str)
    assert "alert" in root.tag
    assert root.find("{urn:oasis:names:tc:emergency:cap:1.2}status").text == "Actual"
    assert root.find("{urn:oasis:names:tc:emergency:cap:1.2}msgType").text == "Alert"

    info = root.find("{urn:oasis:names:tc:emergency:cap:1.2}info")
    assert info is not None
    assert info.find("{urn:oasis:names:tc:emergency:cap:1.2}category").text == "Safety"
    assert info.find("{urn:oasis:names:tc:emergency:cap:1.2}event").text == "Traffic Collision"

    # Confirm experimental warning notice is present
    note = root.find("{urn:oasis:names:tc:emergency:cap:1.2}note").text
    assert "EXPERIMENTAL" in note


def test_generate_dossier_pdf():
    """Verifies ReportLab generates a valid PDF starting with %PDF- header."""
    inc_id = "inc_pdf_test"
    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        peak_conf=0.92,
        bbox=[100, 100, 300, 300],
        involved_ids=[1, 2],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={"accident_model": "YOLOv8s"},
        kinematics={"is_calibrated": True, "ttc_s": 1.1, "max_peak_decel_mps2": 7.5},
        time_series={
            "is_calibrated": True,
            "speed_unit": "km/h",
            "decel_unit": "m/s²",
            "vehicles": {"1": [{"t_rel_s": -1.0, "speed": 40.0, "decel": 0.0}, {"t_rel_s": 0.0, "speed": 5.0, "decel": 7.0}]},
        },
    )

    data = dossier.assemble_dossier_data(inc_id)
    pdf_bytes = dossier.generate_dossier_pdf(data)

    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF-")


def test_dossier_cache_lifecycle_and_invalidation():
    """Tests PDF caching and invalidation on operator verdict update."""
    inc_id = "inc_cache_test"
    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        peak_conf=0.85,
        bbox=[0, 0, 50, 50],
        involved_ids=[1],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={},
    )

    data = dossier.assemble_dossier_data(inc_id)
    cache_path = os.path.join(dossier.INCIDENTS_DIR, f"{inc_id}_dossier.pdf")

    # Generate and verify cached
    dossier.generate_dossier_pdf(data, out_path=cache_path)
    assert os.path.exists(cache_path)
    assert dossier.get_cached_dossier_pdf(inc_id) == cache_path

    # Invalidate via verdict update
    db.update_incident_verdict(inc_id, verdict="false_alarm", note="Camera glare reflection")
    assert not os.path.exists(cache_path)
    assert dossier.get_cached_dossier_pdf(inc_id) is None


def test_dossier_api_endpoints():
    """Verifies GET /api/incidents/{id}/dossier.* and /bundle.zip via FastAPI TestClient."""
    client = TestClient(app)
    inc_id = "inc_api_test"

    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="sess_1",
        zone_id=1,
        origin="detector",
        confirmed_at=datetime.now(timezone.utc).isoformat(),
        peak_conf=0.90,
        bbox=[10, 20, 30, 40],
        involved_ids=[1],
        snapshot_path=None,
        clip_path=None,
        settings={},
        model_info={},
    )

    # 1. PDF endpoint
    res_pdf = client.get(f"/api/incidents/{inc_id}/dossier.pdf")
    assert res_pdf.status_code == 200
    assert res_pdf.headers["content-type"] == "application/pdf"
    assert res_pdf.content.startswith(b"%PDF-")

    # 2. JSON endpoint
    res_json = client.get(f"/api/incidents/{inc_id}/dossier.json")
    assert res_json.status_code == 200
    assert res_json.headers["content-type"].startswith("application/json")
    payload = res_json.json()
    assert payload["incident_id"] == inc_id

    # 3. CAP XML endpoint
    res_xml = client.get(f"/api/incidents/{inc_id}/dossier.cap.xml")
    assert res_xml.status_code == 200
    assert "xml" in res_xml.headers["content-type"]
    assert b"<alert" in res_xml.content

    # 4. Bundle ZIP endpoint
    res_zip = client.get(f"/api/incidents/{inc_id}/bundle.zip")
    assert res_zip.status_code == 200
    assert "application/zip" in res_zip.headers["content-type"]

    # 5. Non-existent incident 404 check
    res_404 = client.get("/api/incidents/inc_nonexistent/dossier.pdf")
    assert res_404.status_code == 404
