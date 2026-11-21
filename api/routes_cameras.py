from typing import List, Optional
from fastapi import APIRouter, HTTPException
from api import db
from api.models import CameraItem, CameraUpdateRequest

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("", response_model=List[CameraItem])
def list_cameras():
    cams = db.list_cameras()
    return [CameraItem(**c) for c in cams]


@router.get("/{camera_id}", response_model=CameraItem)
def get_camera(camera_id: str):
    cam = db.get_camera(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found.")
    return CameraItem(**cam)


@router.put("/{camera_id}", response_model=CameraItem)
def update_camera(camera_id: str, body: CameraUpdateRequest):
    cam = db.upsert_camera(
        camera_id=camera_id,
        name=body.name,
        source=body.source,
        lat=body.lat,
        lng=body.lng,
        notes=body.notes,
        settings_profile=body.settings_profile,
        ignore_region=body.ignore_region,
    )
    return CameraItem(**cam)


@router.delete("/{camera_id}")
def delete_camera(camera_id: str):
    success = db.delete_camera(camera_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found.")
    return {"status": "ok", "message": f"Camera '{camera_id}' removed."}

