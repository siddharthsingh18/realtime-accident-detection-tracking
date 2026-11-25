import os
import logging
from typing import Optional
import requests

from api.notifications.base import BaseNotifier
from api.notifications.models import AlertPayload, NotificationResult

logger = logging.getLogger("TrafficMonitor.Notifications.Telegram")


class TelegramNotifier(BaseNotifier):
    """
    Dispatches alerts to a Telegram chat or channel via Bot API.
    Uploads snapshot photo with formatted caption when available,
    falling back to HTML text message.
    """
    channel_name: str = "telegram"

    def __init__(
        self,
        bot_token: Optional[str] = None,
        chat_id: Optional[str] = None,
        timeout_seconds: float = 10.0,
    ):
        self.bot_token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        self.chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        self.timeout = timeout_seconds

    def is_configured(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    def format_caption(self, payload: AlertPayload) -> str:
        prefix = "🧪 <b>[TEST ALERT]</b> " if payload.is_test else "🚨 <b>INCIDENT ALERT: ROAD ACCIDENT DETECTED</b>\n"
        speed_info = ""
        if payload.speed_kmh is not None:
            speed_info = f"\n⚡ <b>Speed:</b> {payload.speed_kmh:.1f} km/h"
            if payload.speed_loss_kmh is not None:
                speed_info += f" (Drop: -{payload.speed_loss_kmh:.1f} km/h)"
        elif payload.speed_px_s is not None and payload.speed_px_s > 0:
            speed_info = f"\n⚡ <b>Speed:</b> {payload.speed_px_s:.0f} px/s"

        vehicles_str = ", ".join(f"#{vid}" for vid in payload.vehicles_involved) if payload.vehicles_involved else "N/A"
        url_link = f'\n🔗 <a href="{payload.incident_url}">Review Incident in Console</a>' if payload.incident_url else ""

        return (
            f"{prefix}\n"
            f"📹 <b>Camera:</b> {payload.camera_name} (<code>{payload.camera_id}</code>)\n"
            f"⏱ <b>Time:</b> {payload.timestamp_iso}\n"
            f"📍 <b>Zone ID:</b> #{payload.zone_id} | <b>Confidence:</b> {payload.confidence:.0%}\n"
            f"🚗 <b>Vehicles:</b> {vehicles_str}\n"
            f"⚠️ <b>Severity:</b> {payload.severity}"
            f"{speed_info}"
            f"{url_link}"
        )

    def send(self, payload: AlertPayload) -> NotificationResult:
        if not self.is_configured():
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                error="Telegram channel not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing)",
            )

        caption = self.format_caption(payload)
        base_url = f"https://api.telegram.org/bot{self.bot_token}"

        # 1. Try sending with snapshot photo if exists
        if payload.snapshot_path and os.path.exists(payload.snapshot_path):
            try:
                photo_url = f"{base_url}/sendPhoto"
                with open(payload.snapshot_path, "rb") as photo_file:
                    resp = requests.post(
                        photo_url,
                        data={
                            "chat_id": self.chat_id,
                            "caption": caption[:1024],  # Telegram caption limit
                            "parse_mode": "HTML",
                        },
                        files={"photo": photo_file},
                        timeout=self.timeout,
                    )
                if resp.status_code == 200:
                    return NotificationResult(channel=self.channel_name, success=True, response_code=200)
                else:
                    logger.warning(f"Telegram sendPhoto failed with status {resp.status_code}, falling back to text.")
            except Exception as e:
                logger.warning(f"Telegram photo upload encountered error: {self.sanitize_error(e)}, falling back to text.")

        # 2. Fallback to standard text message
        try:
            msg_url = f"{base_url}/sendMessage"
            resp = requests.post(
                msg_url,
                json={
                    "chat_id": self.chat_id,
                    "text": caption,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": False,
                },
                timeout=self.timeout,
            )
            if resp.status_code == 200:
                return NotificationResult(channel=self.channel_name, success=True, response_code=200)
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                response_code=resp.status_code,
                error=f"HTTP {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as e:
            sanitized = self.sanitize_error(e)
            logger.error(f"Telegram notification error: {sanitized}")
            return NotificationResult(channel=self.channel_name, success=False, error=sanitized)
