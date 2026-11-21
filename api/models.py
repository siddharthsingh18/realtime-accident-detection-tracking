from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    file: str
    arch: str
    classes: List[str]


class VehicleModelInfo(BaseModel):
    file: str
    arch: str
    classes: List[str]


class HealthResponse(BaseModel):
    status: str = "ok"
    device: str
    models: Dict[str, Any]


class PipelineSettings(BaseModel):
    accident_conf: float = Field(0.40, ge=0.05, le=0.95, description="Accident detection confidence cutoff")
    vehicle_conf: float = Field(0.35, ge=0.05, le=0.95, description="Vehicle detection confidence cutoff")
    containment_threshold: float = Field(0.50, ge=0.10, le=1.00, description="Spatial containment ratio for suppression")
    persistence_seconds: float = Field(0.50, ge=0.02, le=5.00, description="Seconds to maintain accident zone across loss")
    confirm_seconds: float = Field(0.17, ge=0.02, le=5.00, description="Seconds of sustained hits required to confirm zone")
    tentative_grace_seconds: float = Field(0.07, ge=0.02, le=5.00, description="Seconds before dropping unconfirmed tentative zone")
    use_collision_heuristic: bool = Field(True, description="Enable kinematic collision detection heuristic")
    device: Literal["auto", "cpu", "mps", "cuda"] = Field("auto", description="Compute device")


class SettingsValidateRequest(BaseModel):
    settings: PipelineSettings


class SettingsValidateResponse(BaseModel):
    valid: bool
    settings: PipelineSettings
    message: Optional[str] = None


class SessionCreateRequest(BaseModel):
    source: Literal["upload", "sample1", "sample2", "webcam"]
    settings: Optional[PipelineSettings] = None


class SessionCreateResponse(BaseModel):
    session_id: str
    source: str
    total_frames: Optional[int] = None
    fps: float
    message: str


class ZoneTelemetry(BaseModel):
    zone_id: int
    status: Literal["TENTATIVE", "ACTIVE", "MAINTAINED"]
    conf: float
    bbox: List[float]
    involved_vehicle_ids: List[int]


class TelemetryEvent(BaseModel):
    type: Literal["confirmed", "cleared"]
    zone_id: int
    frame_idx: int
    timestamp_ms: int


class TelemetryMessage(BaseModel):
    frame_idx: int
    total_frames: Optional[int] = None
    fps: float
    timestamp_ms: int
    vehicles_in_frame: int
    vehicles_total_unique: int
    confirmed_accidents: int
    dropped_frames: int = 0
    zones: List[ZoneTelemetry]
    events: List[TelemetryEvent]
    finished: bool = False


class DemoItem(BaseModel):
    name: str
    title: str
    description: str
    resolution: str
    fps: float
    duration_seconds: float
    size_bytes: int
    playable: bool
    url: str

