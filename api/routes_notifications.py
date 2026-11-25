from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.notifications.dispatcher import get_dispatcher
from api.notifications.models import AlertPayload
from api import db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationSettingsUpdate(BaseModel):
    cooldown_seconds: Optional[float] = Field(None, ge=5.0, le=3600.0)


class NotificationLogItem(BaseModel):
    id: int
    incident_id: str
    camera_id: str
    channel: str
    status: str
    attempts: int
    last_error: Optional[str] = None
    created_at: str
    updated_at: str


@router.get("/settings")
def get_notification_settings():
    dispatcher = get_dispatcher()
    channels_status = {}
    for name, notifier in dispatcher.channels.items():
        channels_status[name] = {
            "channel": name,
            "configured": notifier.is_configured(),
        }

    return {
        "cooldown_seconds": dispatcher.cooldown_seconds,
        "channels": channels_status,
    }


@router.post("/settings")
def update_notification_settings(body: NotificationSettingsUpdate):
    dispatcher = get_dispatcher()
    if body.cooldown_seconds is not None:
        dispatcher.cooldown_seconds = body.cooldown_seconds
    return {
        "status": "ok",
        "cooldown_seconds": dispatcher.cooldown_seconds,
    }


@router.post("/test/{channel}")
def send_test_notification(channel: str):
    dispatcher = get_dispatcher()
    if channel not in dispatcher.channels and channel != "all":
        raise HTTPException(status_code=400, detail=f"Invalid channel '{channel}'. Choose from: {list(dispatcher.channels.keys())} or 'all'")

    target_channels = None if channel == "all" else [channel]

    test_payload = AlertPayload(
        incident_id=f"test_alert_{int(dispatcher.cooldown_seconds)}",
        camera_id="cam_01",
        camera_name="Camera 01: North Junction",
        timestamp_iso="2026-11-25T19:00:00Z",
        zone_id=999,
        confidence=0.99,
        vehicles_involved=[1, 2],
        speed_kmh=64.5,
        speed_loss_kmh=42.0,
        severity="CRITICAL",
        incident_url="http://localhost:5173/incidents/test_alert_999",
        is_test=True,
    )

    enqueued = dispatcher.dispatch_async(test_payload, specific_channels=target_channels)
    return {
        "status": "queued" if enqueued else "rejected",
        "channel": channel,
        "message": f"Test alert enqueued for channel '{channel}'" if enqueued else "Queue full or rejected",
    }


@router.get("/logs", response_model=List[NotificationLogItem])
def list_notification_logs(limit: int = 50):
    rows = db.list_recent_notifications(limit=limit)
    return [NotificationLogItem(**r) for r in rows]
