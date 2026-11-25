from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


@dataclass
class AlertPayload:
    """Standardized incident alert payload dispatched across notification channels."""
    incident_id: str
    camera_id: str
    camera_name: str
    timestamp_iso: str
    zone_id: int
    confidence: float
    vehicles_involved: List[int]
    speed_kmh: Optional[float] = None
    speed_loss_kmh: Optional[float] = None
    speed_px_s: Optional[float] = None
    severity: str = "HIGH"  # CRITICAL, HIGH, MEDIUM, LOW
    incident_url: str = ""
    snapshot_path: Optional[str] = None
    is_test: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class NotificationResult:
    """Result of an individual channel dispatch attempt."""
    channel: str
    success: bool
    attempts: int = 1
    error: Optional[str] = None
    response_code: Optional[int] = None
