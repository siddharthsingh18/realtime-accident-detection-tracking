import os
import hmac
import hashlib
import json
import logging
from typing import Optional, Dict, Any
from dataclasses import asdict
import requests

from api.notifications.base import BaseNotifier
from api.notifications.models import AlertPayload, NotificationResult

logger = logging.getLogger("TrafficMonitor.Notifications.Webhook")


class GenericWebhookNotifier(BaseNotifier):
    """
    Dispatches alerts to a generic HTTP REST webhook endpoint via JSON POST.
    Supports HMAC-SHA256 request signing for security.
    """
    channel_name: str = "webhook"

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        secret: Optional[str] = None,
        timeout_seconds: float = 10.0,
    ):
        self.webhook_url = webhook_url or os.environ.get("GENERIC_WEBHOOK_URL", "").strip()
        self.secret = secret or os.environ.get("GENERIC_WEBHOOK_SECRET", "").strip()
        self.timeout = timeout_seconds

    def is_configured(self) -> bool:
        return bool(self.webhook_url and (self.webhook_url.startswith("http://") or self.webhook_url.startswith("https://")))

    def send(self, payload: AlertPayload) -> NotificationResult:
        if not self.is_configured():
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                error="Generic webhook channel not configured (GENERIC_WEBHOOK_URL missing)",
            )

        data_dict = asdict(payload)
        json_body = json.dumps(data_dict, sort_keys=True)
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "TrafficMonitor-IncidentNotifier/2.1",
            "X-Event-Type": "incident_alert" if not payload.is_test else "test_alert",
        }

        # If secret configured, attach HMAC signature
        if self.secret:
            sig = hmac.new(self.secret.encode("utf-8"), json_body.encode("utf-8"), hashlib.sha256).hexdigest()
            headers["X-TrafficMonitor-Signature"] = f"sha256={sig}"

        try:
            resp = requests.post(
                self.webhook_url,
                data=json_body,
                headers=headers,
                timeout=self.timeout,
            )
            # Accept any 2xx response
            if 200 <= resp.status_code < 300:
                return NotificationResult(channel=self.channel_name, success=True, response_code=resp.status_code)
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                response_code=resp.status_code,
                error=f"Remote server returned HTTP {resp.status_code}: {resp.text[:150]}",
            )
        except Exception as e:
            sanitized = self.sanitize_error(e)
            logger.error(f"Generic webhook dispatch error: {sanitized}")
            return NotificationResult(channel=self.channel_name, success=False, error=sanitized)
