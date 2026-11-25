import os
import io
import csv
import zipfile
import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Header, status
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse

from api import db, dossier
from api.models import (
    IncidentItem,
    IncidentListResponse,
    IncidentVerdictUpdate,
    PipelineSettings,
)

logger = logging.getLogger("TrafficMonitor.API.RoutesIncidents")
from api.range_response import create_range_response
from api.compare import run_pipeline_simulation

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


@router.get("", response_model=IncidentListResponse)
def get_incidents(
    camera_id: Optional[str] = Query(None),
    verdict: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows, total = db.list_incidents(
        camera_id=camera_id,
        verdict=verdict,
        origin=origin,
        from_date=from_date,
        to_date=to_date,
        search=search,
        limit=limit,
        offset=offset,
    )
    items = [IncidentItem(**r) for r in rows]
    return IncidentListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/export.csv")
def export_incidents_csv(
    camera_id: Optional[str] = Query(None),
    verdict: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    rows, _ = db.list_incidents(
        camera_id=camera_id,
        verdict=verdict,
        from_date=from_date,
        to_date=to_date,
        limit=5000,
        offset=0,
    )

    output = io.StringIO()
    writer = csv.writer(output)

    # Header with metadata note
    writer.writerow(["# Road Incident Export"])
    writer.writerow([f"# Filter: camera={camera_id or 'all'}, verdict={verdict or 'all'}, range={from_date or 'start'} to {to_date or 'end'}, total_records={len(rows)}"])
    writer.writerow([
        "id", "camera_id", "session_id", "zone_id", "origin",
        "confirmed_at", "cleared_at", "peak_conf", "verdict",
        "verdict_note", "verdict_at", "involved_vehicle_ids"
    ])

    for r in rows:
        writer.writerow([
            r["id"],
            r["camera_id"],
            r["session_id"],
            r["zone_id"],
            r["origin"],
            r["confirmed_at"],
            r["cleared_at"] or "",
            f"{r['peak_conf']:.3f}",
            r["verdict"] or "unreviewed",
            r.get("verdict_note") or "",
            r.get("verdict_at") or "",
            ";".join(str(vid) for vid in r.get("involved_vehicle_ids", [])),
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=incidents_export.csv"},
    )


@router.get("/{incident_id}", response_model=IncidentItem)
def get_incident_detail(incident_id: str):
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found.")
    return IncidentItem(**inc)


@router.patch("/{incident_id}/verdict", response_model=IncidentItem)
def update_verdict(incident_id: str, update: IncidentVerdictUpdate):
    inc = db.update_incident_verdict(incident_id, verdict=update.verdict, note=update.note)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found.")
    return IncidentItem(**inc)


@router.delete("/{incident_id}")
def delete_incident(incident_id: str):
    success = db.soft_delete_incident(incident_id, delete=True)
    if not success:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found.")
    return {"status": "ok", "message": f"Incident '{incident_id}' soft deleted (undoable for 10s)."}


@router.post("/{incident_id}/restore")
def restore_incident(incident_id: str):
    success = db.soft_delete_incident(incident_id, delete=False)
    if not success:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found.")
    return {"status": "ok", "message": f"Incident '{incident_id}' restored."}


@router.get("/{incident_id}/audit")
def get_incident_audit(incident_id: str):
    return db.get_incident_audit(incident_id)


@router.get("/{incident_id}/snapshot")
def get_incident_snapshot(incident_id: str, phase: str = Query("impact")):
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    if phase == "before":
        p = inc.get("snapshot_before_path") or os.path.join("data", "incidents", f"{incident_id}_before.jpg")
        if p and os.path.exists(p):
            return FileResponse(p, media_type="image/jpeg")
    elif phase == "after":
        p = inc.get("snapshot_after_path") or os.path.join("data", "incidents", f"{incident_id}_after.jpg")
        if p and os.path.exists(p):
            return FileResponse(p, media_type="image/jpeg")

    # Default impact snapshot
    snap_path = inc.get("snapshot_path")
    if snap_path and os.path.exists(snap_path):
        return FileResponse(snap_path, media_type="image/jpeg")

    alt_impact = os.path.join("data", "incidents", f"{incident_id}_impact.jpg")
    if os.path.exists(alt_impact):
        return FileResponse(alt_impact, media_type="image/jpeg")

    # If file is missing, try default incident directory
    alt_path = os.path.join("data", "incidents", f"{incident_id}.jpg")
    if os.path.exists(alt_path):
        return FileResponse(alt_path, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Snapshot file not found on disk")


@router.get("/{incident_id}/clip")
def get_incident_clip(incident_id: str, range_header: Optional[str] = Header(None, alias="Range")):
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    clip_path = inc.get("clip_path")
    if clip_path and os.path.exists(clip_path):
        return create_range_response(clip_path, range_header)

    alt_path = os.path.join("data", "incidents", f"{incident_id}.mp4")
    if os.path.exists(alt_path):
        return create_range_response(alt_path, range_header)

    raise HTTPException(status_code=404, detail="Clip video file not found on disk (may still be rendering).")


@router.get("/{incident_id}/evidence.zip")
def download_evidence_zip(incident_id: str):
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Snapshot
        snap_path = inc.get("snapshot_path")
        if snap_path and os.path.exists(snap_path):
            zf.write(snap_path, arcname=f"{incident_id}_snapshot.jpg")

        # Clip
        clip_path = inc.get("clip_path")
        if clip_path and os.path.exists(clip_path):
            zf.write(clip_path, arcname=f"{incident_id}_clip.mp4")

        # JSON Metadata
        zf.writestr(f"{incident_id}_metadata.json", json.dumps(inc, indent=2))

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={incident_id}_evidence.zip"},
    )


@router.get("/{incident_id}/dossier.pdf")
def get_incident_dossier_pdf(incident_id: str):
    """
    Returns an A4 PDF evidence dossier.
    Cached on disk; re-generated on demand if invalidated or missing.
    """
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    cached_pdf = dossier.get_cached_dossier_pdf(incident_id)
    if cached_pdf and os.path.exists(cached_pdf):
        return FileResponse(
            cached_pdf,
            media_type="application/pdf",
            filename=f"{incident_id}_dossier.pdf",
        )

    try:
        data = dossier.assemble_dossier_data(incident_id)
        out_path = os.path.join(dossier.INCIDENTS_DIR, f"{incident_id}_dossier.pdf")
        dossier.generate_dossier_pdf(data, out_path=out_path)
        return FileResponse(
            out_path,
            media_type="application/pdf",
            filename=f"{incident_id}_dossier.pdf",
        )
    except Exception as e:
        logger.error(f"Failed to generate dossier PDF for {incident_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Dossier PDF generation failed: {str(e)}")


@router.get("/{incident_id}/dossier.json")
def get_incident_dossier_json(incident_id: str):
    """Returns a structured JSON evidence dossier (Schema v1.0.0)."""
    try:
        data = dossier.assemble_dossier_data(incident_id)
        json_payload = dossier.generate_dossier_json(data)
        return JSONResponse(
            content=json_payload,
            headers={"Content-Disposition": f"attachment; filename={incident_id}_dossier.json"},
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Incident not found")
    except Exception as e:
        logger.error(f"Failed to export dossier JSON for {incident_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Dossier JSON export failed: {str(e)}")


@router.get("/{incident_id}/dossier.cap.xml")
def get_incident_dossier_cap_xml(incident_id: str):
    """
    Returns an OASIS Common Alerting Protocol (CAP 1.2) XML export.
    Designated as experimental and not validated against live emergency dispatch systems.
    """
    try:
        data = dossier.assemble_dossier_data(incident_id)
        xml_content = dossier.generate_dossier_cap_xml(data)
        return Response(
            content=xml_content,
            media_type="application/xml",
            headers={"Content-Disposition": f"attachment; filename={incident_id}_dossier.cap.xml"},
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Incident not found")
    except Exception as e:
        logger.error(f"Failed to export CAP XML for {incident_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Dossier CAP XML export failed: {str(e)}")


@router.get("/{incident_id}/bundle.zip")
def download_incident_bundle_zip(incident_id: str):
    """
    Returns a unified archive containing:
    - PDF Evidence Dossier
    - Structured JSON Dossier
    - OASIS CAP 1.2 XML
    - Pre-roll, Impact, and Post-roll snapshots
    - H.264 MP4 synchronized incident clip
    """
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    try:
        data = dossier.assemble_dossier_data(incident_id)

        # Ensure PDF exists in cache
        cached_pdf = dossier.get_cached_dossier_pdf(incident_id)
        if not cached_pdf or not os.path.exists(cached_pdf):
            cached_pdf = os.path.join(dossier.INCIDENTS_DIR, f"{incident_id}_dossier.pdf")
            dossier.generate_dossier_pdf(data, out_path=cached_pdf)

        json_payload = dossier.generate_dossier_json(data)
        cap_xml = dossier.generate_dossier_cap_xml(data)

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            # 1. Dossier PDF
            if os.path.exists(cached_pdf):
                zf.write(cached_pdf, arcname=f"{incident_id}_dossier.pdf")

            # 2. Dossier JSON
            zf.writestr(f"{incident_id}_dossier.json", json.dumps(json_payload, indent=2))

            # 3. CAP 1.2 XML
            zf.writestr(f"{incident_id}_dossier.cap.xml", cap_xml)

            # 4. Snapshots
            snaps = data.get("evidence_files", {})
            for key, label in [("snapshot_before", "before"), ("snapshot_impact", "impact"), ("snapshot_after", "after")]:
                p = snaps.get(key)
                if p and os.path.exists(p):
                    zf.write(p, arcname=f"{incident_id}_{label}.jpg")

            # 5. Incident MP4 Clip
            clip_path = snaps.get("clip")
            if clip_path and os.path.exists(clip_path):
                zf.write(clip_path, arcname=f"{incident_id}_clip.mp4")

        zip_buffer.seek(0)
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={incident_id}_bundle.zip"},
        )
    except Exception as e:
        logger.error(f"Failed to generate evidence bundle for {incident_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Evidence bundle generation failed: {str(e)}")


@router.post("/{incident_id}/replay")
def replay_incident_tuning(incident_id: str, draft_settings: PipelineSettings):
    """
    Re-runs the incident clip through the pipeline with draft settings
    to compare whether the alert would have fired with new parameters.
    """
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")

    clip_path = inc.get("clip_path") or os.path.join("data", "incidents", f"{incident_id}.mp4")
    # If incident clip is missing, fall back to sample traffic video
    if not os.path.exists(clip_path):
        clip_path = "assets/sample_traffic.mp4"

    sim_res = run_pipeline_simulation(
        video_path=clip_path,
        settings=draft_settings,
        profile_name="Draft Settings Replay",
        max_frames=120,
    )

    alert_fired = sim_res.confirmed_alerts_count > 0

    return {
        "incident_id": incident_id,
        "original_outcome": {
            "origin": inc["origin"],
            "peak_conf": inc["peak_conf"],
            "verdict": inc["verdict"],
        },
        "replay_outcome": {
            "alert_fired": alert_fired,
            "confirmed_zones_count": sim_res.confirmed_alerts_count,
            "frame_ranges": sim_res.frame_ranges,
            "draft_settings": draft_settings.model_dump(),
        },
        "warning": "Tuning on individual incidents may cause overfitting. Validate against continuous normal traffic footage.",
    }


@router.get("/{incident_id}/notifications")
def get_incident_notifications(incident_id: str):
    inc = db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return db.get_incident_notifications(incident_id)

