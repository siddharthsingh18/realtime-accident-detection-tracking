from abc import ABC, abstractmethod
import logging
from api.notifications.models import AlertPayload, NotificationResult

logger = logging.getLogger("TrafficMonitor.Notifications")


class BaseNotifier(ABC):
    """Abstract interface for all notification channel transports."""
    channel_name: str = "base"

    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if required credentials/endpoints are set."""
        pass

    @abstractmethod
    def send(self, payload: AlertPayload) -> NotificationResult:
        """Sends alert payload over this channel. Must catch all network/service exceptions."""
        pass

    def sanitize_error(self, err: Exception) -> str:
        """Sanitizes error string so secret tokens and credentials are never logged or stored."""
        err_msg = str(err)
        # Prevent any potential tokens or URLs from appearing in raw exception strings
        for secret_hint in ("token", "key", "password", "secret", "webhook"):
            if secret_hint in err_msg.lower() and len(err_msg) > 100:
                return f"{type(err).__name__}: [sensitive details suppressed]"
        return f"{type(err).__name__}: {err_msg[:200]}"
