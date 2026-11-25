import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from api import db
from api.models import (
    CameraItem,
    CameraUpdateRequest,
    CameraCalibrationData,
    CameraCalibrationRequest,
)
from src.calibration import load_camera_calibration, HomographyCalibrator

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
        heading=body.heading,
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


@router.get("/{camera_id}/calibration", response_model=CameraCalibrationData)
def get_camera_calibration(camera_id: str):
    calibrator = load_camera_calibration(camera_id)
    if not calibrator:
        raise HTTPException(status_code=404, detail=f"No calibration found for camera '{camera_id}'.")
    return CameraCalibrationData(**calibrator.to_dict())


@router.put("/{camera_id}/calibration", response_model=CameraCalibrationData)
def set_camera_calibration(camera_id: str, body: CameraCalibrationRequest):
    try:
        calibrator = HomographyCalibrator(
            camera_id=camera_id,
            image_points=body.image_points,
            ground_points=body.ground_points,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid calibration parameters: {e}")

    calib_file = os.path.join("calibration", f"{camera_id}.json")
    calibrator.save(calib_file)
    return CameraCalibrationData(**calibrator.to_dict())


@router.delete("/{camera_id}/calibration")
def delete_camera_calibration(camera_id: str):
    calib_file = os.path.join("calibration", f"{camera_id}.json")
    if os.path.exists(calib_file):
        os.remove(calib_file)
        return {"status": "ok", "message": f"Calibration for camera '{camera_id}' deleted."}
    raise HTTPException(status_code=404, detail=f"No calibration found for camera '{camera_id}'.")


