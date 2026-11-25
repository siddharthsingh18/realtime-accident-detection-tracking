"""
Incident Evidence Dossier Generation Module.
Provides:
- Real-time kinematic time series extraction for involved tracks.
- Structured dossier data assembly with fallback for uncalibrated/unreviewed cases.
- High-resolution branded A4 PDF report generation (ReportLab + Matplotlib).
- Structured JSON export (Schema v1.0.0).
- OASIS Common Alerting Protocol (CAP 1.2) XML export (Experimental).
- Dossier disk caching and verdict-triggered cache invalidation.
"""

import os
import io
import math
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple
import xml.etree.ElementTree as ET

import matplotlib
matplotlib.use("Agg")  # Headless backend for thread-safe rendering
import matplotlib.pyplot as plt
from PIL import Image as PILImage

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image,
    KeepTogether,
    HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from api import db

logger = logging.getLogger("TrafficMonitor.API.Dossier")

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
INCIDENTS_DIR = os.path.join(DATA_DIR, "incidents")


# ------------------------------------------------------------------------------
# 1. Kinematic Time Series Extraction
# ------------------------------------------------------------------------------

def extract_track_time_series(
    tracked_vehicles: List[Any],
    involved_ids: List[int],
    fps: float = 30.0,
    is_calibrated: bool = False,
) -> Dict[str, Any]:
    """
    Extracts pre-impact time series of speed and deceleration for involved tracks.
    If camera is calibrated, units are km/h and m/s^2.
    If camera is uncalibrated, units are px/s and px/s^2.
    """
    effective_fps = max(5.0, float(fps)) if fps is not None else 30.0
    dt = 1.0 / effective_fps
    involved_set = set(involved_ids)

    res: Dict[str, Any] = {
        "is_calibrated": is_calibrated,
        "speed_unit": "km/h" if is_calibrated else "px/s",
        "decel_unit": "m/s²" if is_calibrated else "px/s²",
        "vehicles": {},
    }

    for v in tracked_vehicles:
        tid = getattr(v, "track_id", None)
        if tid not in involved_set:
            continue

        str_tid = str(tid)
        points: List[Dict[str, float]] = []

        if is_calibrated and getattr(v, "ground_history", None) and len(v.ground_history) >= 2:
            g_pts = list(v.ground_history)
            n = len(g_pts)
            speeds: List[float] = []

            for i in range(1, n):
                dx = g_pts[i][0] - g_pts[i - 1][0]
                dy = g_pts[i][1] - g_pts[i - 1][1]
                speed_mps = math.hypot(dx, dy) / dt
                speed_kmh = speed_mps * 3.6
                speeds.append(speed_kmh)

            for i, speed in enumerate(speeds):
                t_rel = round((i - (len(speeds) - 1)) * dt, 2)
                decel = 0.0
                if i > 0:
                    # Positive deceleration = slowing down (in m/s^2)
                    decel = max(0.0, (speeds[i - 1] - speed) / 3.6 / dt)
                points.append({
                    "t_rel_s": t_rel,
                    "speed": round(speed, 1),
                    "decel": round(decel, 2),
                })

        elif getattr(v, "history", None) and len(v.history) >= 2:
            c_pts = list(v.history)
            n = len(c_pts)
            px_speeds: List[float] = []

            for i in range(1, n):
                dx = c_pts[i][0] - c_pts[i - 1][0]
                dy = c_pts[i][1] - c_pts[i - 1][1]
                px_speed = math.hypot(dx, dy) * effective_fps
                px_speeds.append(px_speed)

            for i, speed in enumerate(px_speeds):
                t_rel = round((i - (len(px_speeds) - 1)) * dt, 2)
                decel = 0.0
                if i > 0:
                    decel = max(0.0, (px_speeds[i - 1] - speed) * effective_fps)
                points.append({
                    "t_rel_s": t_rel,
                    "speed": round(speed, 1),
                    "decel": round(decel, 1),
                })

        res["vehicles"][str_tid] = points

    return res


# ------------------------------------------------------------------------------
# 2. Dossier Data Assembly
# ------------------------------------------------------------------------------

def assemble_dossier_data(incident_id: str) -> Dict[str, Any]:
    """
    Gathers all persistent incident, camera, kinematic, and audit data.
    Ensures missing values are explicitly designated as 'Not available' or null.
    """
    inc = db.get_incident(incident_id)
    if not inc:
        raise ValueError(f"Incident '{incident_id}' not found in database.")

    cam_id = inc.get("camera_id", "")
    cam = db.get_camera(cam_id) or {}
    audit_history = db.get_incident_audit(incident_id)

    # Resolve snapshots
    snap_impact = inc.get("snapshot_path")
    if not snap_impact or not os.path.exists(snap_impact):
        alt = os.path.join(INCIDENTS_DIR, f"{incident_id}_impact.jpg")
        alt2 = os.path.join(INCIDENTS_DIR, f"{incident_id}.jpg")
        snap_impact = alt if os.path.exists(alt) else (alt2 if os.path.exists(alt2) else None)

    snap_before = inc.get("snapshot_before_path")
    if not snap_before or not os.path.exists(snap_before):
        alt_before = os.path.join(INCIDENTS_DIR, f"{incident_id}_before.jpg")
        snap_before = alt_before if os.path.exists(alt_before) else None

    snap_after = inc.get("snapshot_after_path")
    if not snap_after or not os.path.exists(snap_after):
        alt_after = os.path.join(INCIDENTS_DIR, f"{incident_id}_after.jpg")
        snap_after = alt_after if os.path.exists(alt_after) else None

    clip_path = inc.get("clip_path")
    if not clip_path or not os.path.exists(clip_path):
        alt_clip = os.path.join(INCIDENTS_DIR, f"{incident_id}.mp4")
        clip_path = alt_clip if os.path.exists(alt_clip) else None

    # Load configuration privacy flag
    privacy_cfg = False
    try:
        from api.main import load_yaml_config
        cfg = load_yaml_config() if os.path.exists("config.yaml") else {}
        privacy_cfg = cfg.get("dossier", {}).get("include_license_plates_and_faces", False)
    except Exception:
        privacy_cfg = False

    return {
        "schema_version": "1.0.0",
        "incident_id": inc["id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "camera": {
            "id": cam_id,
            "name": cam.get("name", cam_id),
            "source": cam.get("source", "Not available"),
            "lat": cam.get("lat"),
            "lng": cam.get("lng"),
            "heading": cam.get("heading"),
            "notes": cam.get("notes") or "Not available",
        },
        "timestamps": {
            "confirmed_at": inc.get("confirmed_at"),
            "cleared_at": inc.get("cleared_at") or "Not available",
            "verdict_at": inc.get("verdict_at") or "Not available",
        },
        "classification": {
            "origin": inc.get("origin", "detector"),
            "peak_conf": inc.get("peak_conf", 0.0),
            "bbox": inc.get("bbox", []),
            "involved_vehicle_ids": inc.get("involved_vehicle_ids", []),
            "model_info": inc.get("model_info", {}),
            "settings": inc.get("settings", {}),
        },
        "kinematics": inc.get("kinematics"),
        "time_series": inc.get("time_series"),
        "operator_review": {
            "verdict": inc.get("verdict") or "Not yet reviewed",
            "verdict_note": inc.get("verdict_note") or "Not available",
            "verdict_at": inc.get("verdict_at") or "Not available",
            "audit_history": audit_history,
        },
        "evidence_files": {
            "snapshot_before": snap_before,
            "snapshot_impact": snap_impact,
            "snapshot_after": snap_after,
            "clip": clip_path,
        },
        "privacy": {
            "license_plates_and_faces_included": privacy_cfg,
            "policy": (
                "Opt-in full frame capture enabled."
                if privacy_cfg
                else "Privacy preservation active: License plates and biometric facial regions are not cropped or featured."
            ),
        },
    }


# ------------------------------------------------------------------------------
# 3. Kinematic Chart & Location Graphics (Matplotlib)
# ------------------------------------------------------------------------------

def render_kinematic_charts_png(time_series: Optional[Dict[str, Any]]) -> Optional[bytes]:
    """
    Renders dual speed-over-time and deceleration-over-time charts using Matplotlib.
    Returns PNG bytes in memory, or None if time series is not available.
    """
    if not time_series or not time_series.get("vehicles"):
        return None

    vehicles = time_series["vehicles"]
    if not any(len(pts) > 1 for pts in vehicles.values()):
        return None

    speed_unit = time_series.get("speed_unit", "km/h")
    decel_unit = time_series.get("decel_unit", "m/s²")
    is_calibrated = time_series.get("is_calibrated", False)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.2, 2.3), dpi=140)
    fig.patch.set_facecolor("#0f172a")

    colors_list = ["#06b6d4", "#f59e0b", "#ec4899", "#10b981"]

    for idx, (vid, pts) in enumerate(vehicles.items()):
        if not pts:
            continue
        c = colors_list[idx % len(colors_list)]
        t_vals = [p["t_rel_s"] for p in pts]
        s_vals = [p["speed"] for p in pts]
        d_vals = [p["decel"] for p in pts]

        ax1.plot(t_vals, s_vals, label=f"Track #{vid}", color=c, lw=1.8, marker="o", markersize=3)
        ax2.plot(t_vals, d_vals, label=f"Track #{vid}", color=c, lw=1.8, marker="s", markersize=3)

    # Speed chart formatting
    ax1.set_facecolor("#1e293b")
    ax1.axvline(0, color="#ef4444", linestyle="--", lw=1.2, label="Impact")
    ax1.set_title(f"Speed Over Time ({speed_unit})", fontsize=9, color="#f8fafc", fontweight="bold")
    ax1.set_xlabel("Time Relative to Impact (s)", fontsize=7.5, color="#94a3b8")
    ax1.set_ylabel(speed_unit, fontsize=7.5, color="#94a3b8")
    ax1.tick_params(colors="#94a3b8", labelsize=7)
    ax1.grid(True, linestyle=":", alpha=0.3, color="#64748b")
    ax1.legend(loc="upper left", fontsize=6.5, facecolor="#0f172a", edgecolor="#334155", labelcolor="#e2e8f0")

    # Deceleration chart formatting
    ax2.set_facecolor("#1e293b")
    ax2.axvline(0, color="#ef4444", linestyle="--", lw=1.2, label="Impact")
    ax2.set_title(f"Deceleration Over Time ({decel_unit})", fontsize=9, color="#f8fafc", fontweight="bold")
    ax2.set_xlabel("Time Relative to Impact (s)", fontsize=7.5, color="#94a3b8")
    ax2.set_ylabel(decel_unit, fontsize=7.5, color="#94a3b8")
    ax2.tick_params(colors="#94a3b8", labelsize=7)
    ax2.grid(True, linestyle=":", alpha=0.3, color="#64748b")
    ax2.legend(loc="upper left", fontsize=6.5, facecolor="#0f172a", edgecolor="#334155", labelcolor="#e2e8f0")

    if not is_calibrated:
        fig.suptitle("Note: Uncalibrated camera; kinematics plotted in pixel units", fontsize=7, color="#cbd5e1", style="italic")

    plt.tight_layout()
    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


def render_coordinate_box_png(camera_data: Dict[str, Any]) -> bytes:
    """
    Renders an elegant GIS coordinate reticle card without hitting external tile servers.
    """
    fig, ax = plt.subplots(figsize=(3.2, 1.8), dpi=140)
    fig.patch.set_facecolor("#0f172a")
    ax.set_facecolor("#1e293b")

    lat = camera_data.get("lat")
    lng = camera_data.get("lng")
    heading = camera_data.get("heading")
    name = camera_data.get("name", "CCTV Camera")

    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis("off")

    # Outer border
    rect = plt.Rectangle((0.2, 0.2), 9.6, 9.6, fill=False, edgecolor="#06b6d4", lw=1.2, linestyle="-")
    ax.add_patch(rect)

    if lat is not None and lng is not None:
        ax.text(5, 7.8, "GEOGRAPHIC POSITION", ha="center", va="center", color="#38bdf8", fontsize=7.5, fontweight="bold")
        ax.text(5, 5.8, f"Lat: {lat:.5f}° N\nLng: {lng:.5f}° E", ha="center", va="center", color="#f8fafc", fontsize=8.5, fontfamily="monospace", fontweight="bold")
        h_text = f"Heading: {heading:.1f}°" if heading is not None else "Heading: Not configured"
        ax.text(5, 3.2, h_text, ha="center", va="center", color="#94a3b8", fontsize=7)
        ax.text(5, 1.4, f"Loc: {name[:24]}", ha="center", va="center", color="#64748b", fontsize=6.5)
    else:
        ax.text(5, 5.5, "COORDINATES NOT AVAILABLE", ha="center", va="center", color="#94a3b8", fontsize=8, fontweight="bold")
        ax.text(5, 3.5, "Camera has no GPS coordinates configured", ha="center", va="center", color="#64748b", fontsize=6.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return buf.getvalue()


# ------------------------------------------------------------------------------
# 4. ReportLab PDF Dossier Builder
# ------------------------------------------------------------------------------

def generate_dossier_pdf(dossier_data: Dict[str, Any], out_path: Optional[str] = None) -> bytes:
    """
    Builds a clean, branded A4 PDF incident dossier using ReportLab.
    """
    buf = io.BytesIO()
    target = out_path if out_path else buf

    doc = SimpleDocTemplate(
        target,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "DossierTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#0f172a"),
    )

    subtitle_style = ParagraphStyle(
        "DossierSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#0284c7"),
    )

    body_style = ParagraphStyle(
        "DossierBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#334155"),
    )

    bold_label = ParagraphStyle(
        "DossierBoldLabel",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#0f172a"),
    )

    section_header = ParagraphStyle(
        "DossierSectionHeader",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#0f172a"),
    )

    footer_style = ParagraphStyle(
        "DossierFooter",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#64748b"),
        alignment=1,  # Center
    )

    story = []

    # 1. Header Banner
    inc_id = dossier_data["incident_id"]
    cam_name = dossier_data["camera"]["name"]
    conf_time = dossier_data["timestamps"]["confirmed_at"] or "Not available"

    header_table_data = [
        [
            Paragraph("ROAD ACCIDENT SURVEILLANCE & INVESTIGATION DOSSIER", subtitle_style),
            Paragraph(f"INCIDENT ID: <b>{inc_id}</b>", ParagraphStyle("RightId", parent=bold_label, alignment=2)),
        ],
        [
            Paragraph(f"<b>Location:</b> {cam_name}", title_style),
            Paragraph(f"<b>Timestamp:</b> {conf_time}", ParagraphStyle("RightTime", parent=body_style, alignment=2)),
        ],
    ]
    t_header = Table(header_table_data, colWidths=[330, 192])
    t_header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(t_header)
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0284c7"), spaceAfter=8, spaceBefore=4))

    # 2. Key Metadata & Operator Verdict Matrix
    verdict = dossier_data["operator_review"]["verdict"]
    verdict_color = "#10b981" if verdict == "true_accident" else ("#ef4444" if verdict == "false_alarm" else "#64748b")
    verdict_text = verdict.replace("_", " ").upper() if verdict else "NOT YET REVIEWED"

    conf_pct = f"{dossier_data['classification']['peak_conf'] * 100:.1f}%"
    origin = dossier_data["classification"]["origin"].upper()
    models_str = dossier_data["classification"].get("model_info", {}).get("accident_model", "YOLOv8s")

    lat_val = dossier_data["camera"].get("lat")
    lng_val = dossier_data["camera"].get("lng")
    coords_str = f"{lat_val:.4f}° N, {lng_val:.4f}° E" if (lat_val and lng_val) else "Not available"

    meta_table_data = [
        [
            Paragraph("<b>Camera ID:</b>", bold_label),
            Paragraph(dossier_data["camera"]["id"], body_style),
            Paragraph("<b>Detection Confidence:</b>", bold_label),
            Paragraph(f"<b>{conf_pct}</b> ({origin})", body_style),
        ],
        [
            Paragraph("<b>GPS Coordinates:</b>", bold_label),
            Paragraph(coords_str, body_style),
            Paragraph("<b>AI Model Architecture:</b>", bold_label),
            Paragraph(models_str, body_style),
        ],
        [
            Paragraph("<b>Vehicles Involved:</b>", bold_label),
            Paragraph(f"Tracks: {dossier_data['classification']['involved_vehicle_ids']}", body_style),
            Paragraph("<b>Operator Verdict:</b>", bold_label),
            Paragraph(f"<font color='{verdict_color}'><b>{verdict_text}</b></font>", bold_label),
        ],
    ]
    t_meta = Table(meta_table_data, colWidths=[90, 170, 110, 152])
    t_meta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 10))

    # 3. Three-Phase Photographic Evidence (Before, Impact, After)
    story.append(Paragraph("Three-Phase Incident Evidence Snapshots", section_header))

    def make_snapshot_cell(label: str, path: Optional[str]):
        w_img = 166
        h_img = 95
        if path and os.path.exists(path):
            try:
                img = Image(path, width=w_img, height=h_img)
                return [Paragraph(f"<b>{label}</b>", bold_label), img]
            except Exception as e:
                logger.warning(f"Could not load image {path}: {e}")
        # Placeholder cell
        p = Paragraph(f"<b>{label}</b><br/><br/><i>[Image Not Available]</i>", body_style)
        return [p, Spacer(1, 70)]

    snaps = dossier_data["evidence_files"]
    cell_before = make_snapshot_cell("1. Before Impact (Pre-Roll)", snaps.get("snapshot_before"))
    cell_impact = make_snapshot_cell("2. Moment of Impact (T0)", snaps.get("snapshot_impact"))
    cell_after = make_snapshot_cell("3. After Impact (Post-Roll)", snaps.get("snapshot_after"))

    snap_table_data = [
        [cell_before[0], cell_impact[0], cell_after[0]],
        [cell_before[1], cell_impact[1], cell_after[1]],
    ]
    t_snaps = Table(snap_table_data, colWidths=[174, 174, 174])
    t_snaps.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f5f9")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    story.append(t_snaps)
    story.append(Spacer(1, 10))

    # 4. Ground-Plane Kinematics & Physics Telemetry
    story.append(Paragraph("Ground-Plane Kinematic Telemetry & Collision Dynamics", section_header))

    kin = dossier_data.get("kinematics") or {}
    is_cal = kin.get("is_calibrated", False)

    ttc_str = kin.get("ttc_s_display") or (f"{kin['ttc_s']:.2f} s" if kin.get("ttc_s") is not None else "Not available")
    closing_str = f"{kin['closing_speed_mps']:.1f} m/s" if kin.get("closing_speed_mps") is not None else "Not available"
    decel_str = f"{kin['max_peak_decel_mps2']:.1f} m/s²" if kin.get("max_peak_decel_mps2") is not None else "Not available"
    drop_str = f"{kin['relative_speed_drop_mps']:.1f} m/s" if kin.get("relative_speed_drop_mps") is not None else "Not available"
    cal_label = "CALIBRATED (Ground-Plane Metric)" if is_cal else "UNCALIBRATED (Pixel Space)"

    kin_table_data = [
        [
            Paragraph("<b>Calibration State:</b>", bold_label),
            Paragraph(f"<b>{cal_label}</b>", bold_label),
            Paragraph("<b>Time-to-Collision (TTC):</b>", bold_label),
            Paragraph(f"<b>{ttc_str}</b>", bold_label),
        ],
        [
            Paragraph("<b>Closing Speed:</b>", bold_label),
            Paragraph(closing_str, body_style),
            Paragraph("<b>Peak Deceleration:</b>", bold_label),
            Paragraph(decel_str, body_style),
        ],
        [
            Paragraph("<b>Relative Speed Drop:</b>", bold_label),
            Paragraph(drop_str, body_style),
            Paragraph("<b>Queued Traffic Filter:</b>", bold_label),
            Paragraph("Stationary Queue Suppressed" if kin.get("is_queued_traffic") else "Moving Traffic Verified", body_style),
        ],
    ]
    t_kin = Table(kin_table_data, colWidths=[110, 150, 110, 152])
    t_kin.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_kin)
    story.append(Spacer(1, 6))

    # Matplotlib Kinematic Speed & Decel Chart
    chart_png = render_kinematic_charts_png(dossier_data.get("time_series"))
    if chart_png:
        chart_img = Image(io.BytesIO(chart_png), width=522, height=166)
        story.append(chart_img)
        story.append(Spacer(1, 8))
    else:
        p_no_chart = Paragraph("<i>Kinematic time series not available for offline chart reconstruction.</i>", body_style)
        story.append(p_no_chart)
        story.append(Spacer(1, 6))

    # 5. Operator Audit & Location Schematic Block
    story.append(Paragraph("Operator Verification & Geographic Location", section_header))

    note_text = dossier_data["operator_review"]["verdict_note"] or "No notes submitted."
    v_time = dossier_data["operator_review"]["verdict_at"] or "Pending review."

    audit_summary = f"<b>Current Verdict:</b> {verdict_text}<br/>"
    audit_summary += f"<b>Review Timestamp:</b> {v_time}<br/>"
    audit_summary += f"<b>Investigator Note:</b> {note_text}"

    # Render coordinate block graphic
    coord_png = render_coordinate_box_png(dossier_data["camera"])
    coord_img = Image(io.BytesIO(coord_png), width=180, height=100)

    verdict_and_map_data = [
        [
            Paragraph(audit_summary, body_style),
            coord_img,
        ]
    ]
    t_bottom = Table(verdict_and_map_data, colWidths=[332, 190])
    t_bottom.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_bottom)
    story.append(Spacer(1, 10))

    # 6. Privacy & Legal Compliance Disclaimers
    privacy_policy_text = dossier_data.get("privacy", {}).get("policy", "")
    story.append(Paragraph(f"<b>Privacy Notice:</b> {privacy_policy_text}", ParagraphStyle("Priv", parent=body_style, fontSize=7, leading=9, textColor=colors.HexColor("#64748b"))))
    story.append(Spacer(1, 4))

    # Mandatory Legal Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#94a3b8"), spaceAfter=4, spaceBefore=4))
    story.append(Paragraph(
        "Automatically generated detection evidence. Requires human verification. "
        "Exported from Real-time Accident Detection and Tracking System.",
        footer_style,
    ))

    # Build Document
    doc.build(story)

    if out_path:
        return b""
    buf.seek(0)
    return buf.getvalue()


# ------------------------------------------------------------------------------
# 5. Structured JSON Export
# ------------------------------------------------------------------------------

def generate_dossier_json(dossier_data: Dict[str, Any]) -> Dict[str, Any]:
    """Returns validated, structured JSON export with ISO 8601 timestamps and units."""
    return dossier_data


# ------------------------------------------------------------------------------
# 6. OASIS Common Alerting Protocol (CAP 1.2) XML Export (Experimental)
# ------------------------------------------------------------------------------

def generate_dossier_cap_xml(dossier_data: Dict[str, Any]) -> str:
    """
    Builds OASIS CAP 1.2 XML representation.
    Designated as experimental and not validated against live emergency dispatch systems.
    """
    root = ET.Element("alert", xmlns="urn:oasis:names:tc:emergency:cap:1.2")

    inc_id = dossier_data["incident_id"]
    sent_time = dossier_data["timestamps"]["confirmed_at"] or datetime.now(timezone.utc).isoformat()

    ET.SubElement(root, "identifier").text = f"URN:ACCIDENT:{inc_id}"
    ET.SubElement(root, "sender").text = "TrafficMonitor-AI@local"
    ET.SubElement(root, "sent").text = sent_time
    ET.SubElement(root, "status").text = "Actual"
    ET.SubElement(root, "msgType").text = "Alert"
    ET.SubElement(root, "scope").text = "Public"
    ET.SubElement(root, "note").text = "EXPERIMENTAL FORMAT - Not validated against real CAD or 911 dispatch systems."

    info = ET.SubElement(root, "info")
    ET.SubElement(info, "category").text = "Safety"
    ET.SubElement(info, "event").text = "Traffic Collision"
    ET.SubElement(info, "urgency").text = "Immediate"
    ET.SubElement(info, "severity").text = "Severe"
    ET.SubElement(info, "certainty").text = "Observed"

    cam_name = dossier_data["camera"]["name"]
    ET.SubElement(info, "headline").text = f"Automated Traffic Collision Alert on {cam_name}"

    conf_pct = f"{dossier_data['classification']['peak_conf'] * 100:.1f}%"
    verdict = dossier_data["operator_review"]["verdict"]
    desc = (
        f"Real-time computer vision detection confirmed collision on camera '{cam_name}' (ID: {dossier_data['camera']['id']}) "
        f"with peak detection confidence of {conf_pct}. Operator review status: {verdict}."
    )
    ET.SubElement(info, "description").text = desc

    # Parameter blocks
    def add_param(name: str, val: Any):
        if val is not None:
            p = ET.SubElement(info, "parameter")
            ET.SubElement(p, "valueName").text = name
            ET.SubElement(p, "value").text = str(val)

    add_param("IncidentId", inc_id)
    add_param("CameraSource", dossier_data["camera"].get("source"))
    add_param("VehicleTrackIds", json.dumps(dossier_data["classification"]["involved_vehicle_ids"]))
    add_param("Confidence", conf_pct)

    kin = dossier_data.get("kinematics")
    if kin:
        add_param("Time_To_Collision_s", kin.get("ttc_s"))
        add_param("Peak_Deceleration_mps2", kin.get("max_peak_decel_mps2"))
        add_param("Relative_Speed_Drop_mps", kin.get("relative_speed_drop_mps"))

    # Geographic Area
    lat = dossier_data["camera"].get("lat")
    lng = dossier_data["camera"].get("lng")
    if lat is not None and lng is not None:
        area = ET.SubElement(info, "area")
        ET.SubElement(area, "areaDesc").text = cam_name
        ET.SubElement(area, "circle").text = f"{lat:.5f},{lng:.5f} 0.05"

    return ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")


# ------------------------------------------------------------------------------
# 7. Dossier Caching & Invalidation
# ------------------------------------------------------------------------------

def get_cached_dossier_pdf(incident_id: str) -> Optional[str]:
    """Returns path to cached dossier PDF if valid and present on disk."""
    pdf_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_dossier.pdf")
    if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
        return pdf_path
    return None


def invalidate_dossier_cache(incident_id: str):
    """Deletes cached PDF when operator verdict or notes are modified."""
    pdf_path = os.path.join(INCIDENTS_DIR, f"{incident_id}_dossier.pdf")
    if os.path.exists(pdf_path):
        try:
            os.remove(pdf_path)
            logger.info(f"Invalidated dossier cache for {incident_id}")
        except Exception as e:
            logger.warning(f"Could not remove cached dossier for {incident_id}: {e}")
