import os
import time
import queue
import logging
import threading
from typing import Optional, List, Dict, Set

from api.notifications.models import AlertPayload
from api.notifications.base import BaseNotifier
from api.notifications.telegram import TelegramNotifier
from api.notifications.slack import SlackNotifier
from api.notifications.webhook import GenericWebhookNotifier
from api.notifications.email_smtp import EmailSMTPNotifier
from api import db

logger = logging.getLogger("TrafficMonitor.Notifications.Dispatcher")

DEFAULT_COOLDOWN_SECONDS: float = 60.0


class NotificationDispatcher:
    """
    Asynchronous, non-blocking notification queue and delivery service.
    - Decoupled daemon worker thread ensures inference latency is never impacted.
    - Exponential backoff retry logic (up to 3 attempts).
    - Per-incident deduplication and per-camera rate-limiting cooldown.
    - Persists delivery state transitions into database table 'notification_logs'.
    """

    def __init__(self, cooldown_seconds: Optional[float] = None):
        env_cooldown = os.environ.get("NOTIFICATION_COOLDOWN_SECONDS")
        if env_cooldown and env_cooldown.isdigit():
            self.cooldown_seconds = float(env_cooldown)
        else:
            self.cooldown_seconds = cooldown_seconds or DEFAULT_COOLDOWN_SECONDS

        self.queue: queue.Queue = queue.Queue(maxsize=1000)
        self.seen_incidents: Set[str] = set()
        self.last_camera_alert: Dict[str, float] = {}
        self.lock = threading.Lock()

        # Instantiate available channels
        self.channels: Dict[str, BaseNotifier] = {
            "telegram": TelegramNotifier(),
            "slack": SlackNotifier(),
            "webhook": GenericWebhookNotifier(),
            "email": EmailSMTPNotifier(),
        }

        # Start daemon background worker thread
        self._running = True
        self.worker_thread = threading.Thread(
            target=self._worker_loop,
            daemon=True,
            name="NotificationDispatchWorker",
        )
        self.worker_thread.start()
        logger.info(
            f"NotificationDispatcher initialized (cooldown={self.cooldown_seconds:.0f}s, channels={list(self.channels.keys())})."
        )

    def reload_config(self):
        """Reload channel credentials from environment variables."""
        with self.lock:
            self.channels["telegram"] = TelegramNotifier()
            self.channels["slack"] = SlackNotifier()
            self.channels["webhook"] = GenericWebhookNotifier()
            self.channels["email"] = EmailSMTPNotifier()
            env_cooldown = os.environ.get("NOTIFICATION_COOLDOWN_SECONDS")
            if env_cooldown and env_cooldown.isdigit():
                self.cooldown_seconds = float(env_cooldown)

    def dispatch_async(
        self,
        payload: AlertPayload,
        specific_channels: Optional[List[str]] = None,
    ) -> bool:
        """
        Enqueues an alert for background delivery without blocking the inference thread.
        Returns True if enqueued, False if suppressed by deduplication or camera cooldown.
        """
        with self.lock:
            # Deduplication: single alert per incident ID (unless it's a test trigger)
            if not payload.is_test and payload.incident_id in self.seen_incidents:
                logger.debug(f"Incident {payload.incident_id} already dispatched; deduplicating.")
                return False

            # Rate-limiting / cooldown per camera
            if not payload.is_test:
                now = time.time()
                last_time = self.last_camera_alert.get(payload.camera_id, 0.0)
                elapsed = now - last_time
                if elapsed < self.cooldown_seconds:
                    remaining = int(self.cooldown_seconds - elapsed)
                    logger.info(
                        f"Alert for camera '{payload.camera_id}' suppressed by cooldown ({remaining}s remaining)."
                    )
                    db.log_notification(
                        incident_id=payload.incident_id,
                        camera_id=payload.camera_id,
                        channel="all",
                        status="suppressed",
                        attempts=0,
                        last_error=f"Suppressed by cooldown ({remaining}s remaining)",
                    )
                    return False

                self.last_camera_alert[payload.camera_id] = now
                self.seen_incidents.add(payload.incident_id)

        try:
            self.queue.put_nowait((payload, specific_channels))
            return True
        except queue.Full:
            logger.error(f"Notification queue is full! Alert {payload.incident_id} dropped.")
            return False

    def _worker_loop(self):
        while self._running:
            try:
                item = self.queue.get(timeout=1.0)
                if item is None:
                    break
                payload, specific_channels = item
                self._process_dispatch(payload, specific_channels)
                self.queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Unexpected error in notification worker loop: {e}")

    def _process_dispatch(
        self,
        payload: AlertPayload,
        specific_channels: Optional[List[str]] = None,
    ):
        target_channel_names = specific_channels if specific_channels else list(self.channels.keys())

        for ch_name in target_channel_names:
            notifier = self.channels.get(ch_name)
            if not notifier:
                continue

            if not notifier.is_configured():
                if payload.is_test:
                    db.log_notification(
                        incident_id=payload.incident_id,
                        camera_id=payload.camera_id,
                        channel=ch_name,
                        status="failed",
                        attempts=1,
                        last_error=f"Channel '{ch_name}' is not configured (missing environment variables)",
                    )
                continue

            # Attempt delivery with exponential backoff (up to 3 attempts)
            max_attempts = 3
            success = False
            last_error = None

            for attempt in range(1, max_attempts + 1):
                db.log_notification(
                    incident_id=payload.incident_id,
                    camera_id=payload.camera_id,
                    channel=ch_name,
                    status="retrying" if attempt > 1 else "sending",
                    attempts=attempt,
                    last_error=last_error,
                )

                try:
                    res = notifier.send(payload)
                    if res.success:
                        db.log_notification(
                            incident_id=payload.incident_id,
                            camera_id=payload.camera_id,
                            channel=ch_name,
                            status="sent",
                            attempts=attempt,
                            last_error=None,
                        )
                        success = True
                        logger.info(
                            f"Notification successfully delivered via {ch_name} for incident {payload.incident_id} (attempt {attempt})."
                        )
                        break
                    else:
                        last_error = res.error or "Delivery rejected by remote server"
                except Exception as e:
                    last_error = notifier.sanitize_error(e)

                # Exponential backoff between attempts: 1.0s, 2.0s
                if attempt < max_attempts:
                    backoff = 1.0 * (2 ** (attempt - 1))
                    time.sleep(backoff)

            if not success:
                db.log_notification(
                    incident_id=payload.incident_id,
                    camera_id=payload.camera_id,
                    channel=ch_name,
                    status="failed",
                    attempts=max_attempts,
                    last_error=last_error,
                )
                logger.warning(
                    f"Notification permanently failed on {ch_name} for incident {payload.incident_id} after {max_attempts} attempts: {last_error}"
                )


_dispatcher_instance: Optional[NotificationDispatcher] = None
_dispatcher_lock = threading.Lock()


def get_dispatcher() -> NotificationDispatcher:
    global _dispatcher_instance
    with _dispatcher_lock:
        if _dispatcher_instance is None:
            _dispatcher_instance = NotificationDispatcher()
        return _dispatcher_instance
