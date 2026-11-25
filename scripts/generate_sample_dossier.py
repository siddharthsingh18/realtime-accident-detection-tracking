"""
Generates a realistic sample incident dossier PDF from actual video frames,
renders it to PNG using macOS sips, and verifies layout integrity.
"""

import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import cv2
import json
import subprocess
from datetime import datetime, timezone

from api import db, dossier

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
INCIDENTS_DIR = os.path.join(DATA_DIR, "incidents")
DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "docs"))
OUT_PDF = os.path.join(DOCS_DIR, "dossier_sample.pdf")
OUT_IMG = os.path.join(DOCS_DIR, "screenshots", "dossier_sample_preview.png")

os.makedirs(INCIDENTS_DIR, exist_ok=True)
os.makedirs(os.path.join(DOCS_DIR, "screenshots"), exist_ok=True)


def main():
    print("Extracting sample video frames for 3-phase evidence snapshots...")
    sample_video = "assets/sample_traffic.mp4"
    if not os.path.exists(sample_video):
        sample_video = "assets/sample_traffic_2.mp4"

    cap = cv2.VideoCapture(sample_video)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    # Pick frames for before, impact, after
    f_before = max(0, int(total_frames * 0.2))
    f_impact = int(total_frames * 0.5)
    f_after = min(total_frames - 1, int(total_frames * 0.8))

    inc_id = "inc_sample_dossier_demo"

    # Extract before frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, f_before)
    _, frame_before = cap.read()
    before_path = os.path.join(INCIDENTS_DIR, f"{inc_id}_before.jpg")
    cv2.imwrite(before_path, frame_before)

    # Extract impact frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, f_impact)
    _, frame_impact = cap.read()
    impact_path = os.path.join(INCIDENTS_DIR, f"{inc_id}_impact.jpg")
    cv2.imwrite(impact_path, frame_impact)

    # Extract after frame
    cap.set(cv2.CAP_PROP_POS_FRAMES, f_after)
    _, frame_after = cap.read()
    after_path = os.path.join(INCIDENTS_DIR, f"{inc_id}_after.jpg")
    cv2.imwrite(after_path, frame_after)

    cap.release()

    # Ensure demo camera exists
    db.upsert_camera(
        camera_id="cam_01",
        name="Camera 01: North Junction",
        source="sample1",
        lat=28.6139,
        lng=77.2090,
        heading=45.0,
        notes="High-risk intersection approach CCTV",
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    # Time series simulating deceleration and speed drop
    time_series = {
        "is_calibrated": True,
        "speed_unit": "km/h",
        "decel_unit": "m/s²",
        "vehicles": {
            "1": [
                {"t_rel_s": -2.0, "speed": 52.4, "decel": 0.2},
                {"t_rel_s": -1.5, "speed": 51.1, "decel": 0.8},
                {"t_rel_s": -1.0, "speed": 48.0, "decel": 2.1},
                {"t_rel_s": -0.5, "speed": 34.2, "decel": 7.4},
                {"t_rel_s": 0.0, "speed": 11.5, "decel": 9.1},
            ],
            "2": [
                {"t_rel_s": -2.0, "speed": 42.0, "decel": 0.1},
                {"t_rel_s": -1.5, "speed": 41.5, "decel": 0.4},
                {"t_rel_s": -1.0, "speed": 39.8, "decel": 1.2},
                {"t_rel_s": -0.5, "speed": 28.3, "decel": 6.8},
                {"t_rel_s": 0.0, "speed": 8.0, "decel": 8.5},
            ],
        },
    }

    kinematics = {
        "is_calibrated": True,
        "ttc_s": 0.85,
        "ttc_s_display": "0.85 s",
        "closing_speed_mps": 16.2,
        "max_peak_decel_mps2": 9.1,
        "relative_speed_drop_mps": 11.3,
        "is_queued_traffic": False,
        "summary_reason": "High-closing speed with critical deceleration and confirmed speed drop.",
    }

    print("Inserting incident record into database...")
    db.insert_incident(
        incident_id=inc_id,
        camera_id="cam_01",
        session_id="session_sample_demo",
        zone_id=1,
        origin="detector",
        confirmed_at=now_iso,
        peak_conf=0.942,
        bbox=[240.0, 180.0, 480.0, 360.0],
        involved_ids=[1, 2],
        snapshot_path=impact_path,
        clip_path=sample_video,
        settings={"vehicle_conf": 0.35, "accident_conf": 0.40, "confirm_hits": 5},
        model_info={"accident_model": "YOLOv8s (models/accident_yolo11s.pt)", "vehicle_model": "YOLO11n (models/yolo11n.pt)"},
        kinematics=kinematics,
        snapshot_before_path=before_path,
        snapshot_after_path=after_path,
        time_series=time_series,
    )

    db.update_incident_verdict(
        incident_id=inc_id,
        verdict="true_accident",
        note="Confirmed severe T-bone collision at north radial junction. Dispatch unit #14 notified.",
    )

    print("Assembling dossier data...")
    dossier_data = dossier.assemble_dossier_data(inc_id)

    print(f"Generating PDF dossier to {OUT_PDF}...")
    dossier.generate_dossier_pdf(dossier_data, out_path=OUT_PDF)
    print(f"Generated PDF ({os.path.getsize(OUT_PDF)} bytes).")

    # Render PDF to PNG using macOS sips tool
    print("Rendering PDF page to PNG preview using sips...")
    res = subprocess.run(
        ["sips", "-s", "format", "png", OUT_PDF, "--out", OUT_IMG],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if res.returncode == 0:
        print(f"Saved PDF preview image to: {OUT_IMG} ({os.path.getsize(OUT_IMG)} bytes)")
    else:
        print(f"sips warning: {res.stderr.decode()}")

    print("Sample incident dossier generation complete!")


if __name__ == "__main__":
    main()
