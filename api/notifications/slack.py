import os
import logging
from typing import Optional
import requests

from api.notifications.base import BaseNotifier
from api.notifications.models import AlertPayload, NotificationResult

logger = logging.getLogger("TrafficMonitor.Notifications.Slack")


class SlackNotifier(BaseNotifier):
    """
    Dispatches alerts to Slack via incoming webhook with Block Kit formatting.
    """
    channel_name: str = "slack"

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        timeout_seconds: float = 10.0,
    ):
        self.webhook_url = webhook_url or os.environ.get("SLACK_WEBHOOK_URL", "").strip()
        self.timeout = timeout_seconds

    def is_configured(self) -> bool:
        return bool(self.webhook_url and self.webhook_url.startswith("https://hooks.slack.com/"))

    def build_blocks(self, payload: AlertPayload) -> dict:
        title = "🧪 [TEST ALERT] Traffic Monitor Alert" if payload.is_test else "🚨 Road Accident Detected"
        vehicles_str = ", ".join(f"#{v}" for v in payload.vehicles_involved) if payload.vehicles_involved else "N/A"

        fields = [
            {"type": "mrkdwn", "text": f"*Camera:*\n{payload.camera_name} (`{payload.camera_id}`)"},
            {"type": "mrkdwn", "text": f"*Time:*\n{payload.timestamp_iso}"},
            {"type": "mrkdwn", "text": f"*Zone:*\n#{payload.zone_id} ({payload.confidence:.0%})"},
            {"type": "mrkdwn", "text": f"*Vehicles:*\n{vehicles_str}"},
            {"type": "mrkdwn", "text": f"*Severity:*\n`{payload.severity}`"},
        ]

        if payload.speed_kmh is not None:
            spd_text = f"{payload.speed_kmh:.1f} km/h"
            if payload.speed_loss_kmh is not None:
                spd_text += f" (Drop: -{payload.speed_loss_kmh:.1f} km/h)"
            fields.append({"type": "mrkdwn", "text": f"*Impact Speed:*\n{spd_text}"})
        elif payload.speed_px_s is not None and payload.speed_px_s > 0:
            fields.append({"type": "mrkdwn", "text": f"*Speed (pixels):*\n{payload.speed_px_s:.0f} px/s"})

        blocks = [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": title, "emoji": True},
            },
            {
                "type": "section",
                "fields": fields,
            },
        ]

        # Link button if incident URL available
        if payload.incident_url:
            blocks.append({
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Review Incident Console", "emoji": True},
                        "url": payload.incident_url,
                        "style": "danger" if not payload.is_test else "primary",
                    }
                ],
            })

        return {"blocks": blocks, "text": f"{title} on {payload.camera_name}"}

    def send(self, payload: AlertPayload) -> NotificationResult:
        if not self.is_configured():
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                error="Slack channel not configured (SLACK_WEBHOOK_URL missing or invalid)",
            )

        body = self.build_blocks(payload)
        try:
            resp = requests.post(
                self.webhook_url,
                json=body,
                headers={"Content-Type": "application/json"},
                timeout=self.timeout,
            )
            if resp.status_code == 200 and resp.text.strip().lower() == "ok":
                return NotificationResult(channel=self.channel_name, success=True, response_code=200)
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                response_code=resp.status_code,
                error=f"Slack returned HTTP {resp.status_code}: {resp.text[:150]}",
            )
        except Exception as e:
            sanitized = self.sanitize_error(e)
            logger.error(f"Slack webhook dispatch error: {sanitized}")
            return NotificationResult(channel=self.channel_name, success=False, error=sanitized)
