from typing import List, Optional, Literal, Dict, Any, Tuple
from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    file: str
    arch: str
    classes: Optional[Dict[str, str]] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    device: str
    models: Dict[str, Any]


class PipelineSettings(BaseModel):
    accident_conf: float = Field(0.40, ge=0.05, le=0.95, description="Accident detection confidence cutoff")
    vehicle_conf: float = Field(0.35, ge=0.05, le=0.95, description="Vehicle detection confidence cutoff")
    containment_threshold: float = Field(0.50, ge=0.10, le=1.00, description="Spatial containment ratio for suppression")
    iou_threshold: float = Field(0.30, ge=0.05, le=0.95, description="IoU threshold for accident matching")
    persistence_seconds: float = Field(0.50, ge=0.02, le=5.00, description="Seconds to maintain accident zone across loss")
    confirm_seconds: float = Field(0.17, ge=0.02, le=5.00, description="Seconds of sustained hits required to confirm zone")
    tentative_grace_seconds: float = Field(0.07, ge=0.02, le=5.00, description="Seconds before dropping unconfirmed tentative zone")
    use_collision_heuristic: bool = Field(True, description="Enable kinematic collision detection heuristic")
    device: Literal["auto", "cpu", "mps", "cuda"] = Field("auto", description="Compute device")
    inference_backend: Literal["pytorch", "onnx"] = Field("pytorch", description="Inference runtime backend: pytorch or onnx")
    deceleration_threshold_kmh: float = Field(35.0, ge=5.0, le=150.0, description="Deceleration drop threshold in km/h for calibrated cameras")
    deceleration_threshold_px: float = Field(120.0, ge=10.0, le=500.0, description="Deceleration drop threshold in px/s for uncalibrated cameras")
    save_output: bool = Field(False, description="Persist video output to disk")


class SettingsValidateRequest(BaseModel):
    settings: PipelineSettings


class SettingsValidateResponse(BaseModel):
    valid: bool
    settings: PipelineSettings
    message: Optional[str] = None


class SessionCreateRequest(BaseModel):
    source: Literal["upload", "sample1", "sample2", "webcam"]
    camera_id: Optional[str] = "cam_01"
    settings: Optional[PipelineSettings] = None


class SessionCreateResponse(BaseModel):
    session_id: str
    source: str
    camera_id: str = "cam_01"
    total_frames: Optional[int] = None
    fps: float
    message: str


class TrackTelemetry(BaseModel):
    track_id: int
    cls: str
    conf: float
    bbox: Tuple[float, float, float, float]
    speed_px_s: float = 0.0
    speed_kmh: Optional[float] = None
    suppressed: bool = False
    trail: List[Tuple[float, float]] = Field(default_factory=list)


class FrameSize(BaseModel):
    w: int
    h: int


class InferenceBreakdown(BaseModel):
    accident: float = 0.0
    vehicle: float = 0.0
    tracking: float = 0.0
    logic: float = 0.0
    render: float = 0.0
    total: float = 0.0


class ZoneTelemetry(BaseModel):
    zone_id: int
    status: Literal["TENTATIVE", "ACTIVE", "MAINTAINED"]
    conf: float
    bbox: Tuple[float, float, float, float]
    involved_vehicle_ids: List[int]
    speed_loss_pct: Optional[float] = None
    first_seen_frame: Optional[int] = None
    confirmed_at_ms: Optional[int] = None
    origin: Literal["detector", "collision_heuristic", "both"] = "detector"


class TelemetryEvent(BaseModel):
    type: Literal["confirmed", "cleared"]
    zone_id: int
    frame_idx: int
    timestamp_ms: int
    camera_id: str = "cam_01"
    bbox: Optional[Tuple[float, float, float, float]] = None
    details: Optional[str] = None


class TelemetryMessage(BaseModel):
    frame_idx: int
    total_frames: Optional[int] = None
    fps: float
    timestamp_ms: int
    camera_id: str = "cam_01"
    frame_size: FrameSize = Field(default_factory=lambda: FrameSize(w=1280, h=720))
    vehicles_in_frame: int
    vehicles_total_unique: int
    confirmed_accidents: int
    dropped_frames: int = 0
    inference_ms: InferenceBreakdown = Field(default_factory=InferenceBreakdown)
    tracks: List[TrackTelemetry] = Field(default_factory=list)
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
    video_url: Optional[str] = None


# --- Incident Persistence Models ---
class IncidentItem(BaseModel):
    id: str
    camera_id: str
    session_id: str
    zone_id: int
    origin: Literal["detector", "collision_heuristic", "both"]
    confirmed_at: str
    cleared_at: Optional[str] = None
    peak_conf: float
    bbox: List[float]
    involved_vehicle_ids: List[int]
    snapshot_path: Optional[str] = None
    clip_path: Optional[str] = None
    verdict: Optional[Literal["true_accident", "false_alarm", "unsure"]] = None
    verdict_note: Optional[str] = None
    verdict_at: Optional[str] = None
    settings: Dict[str, Any] = Field(default_factory=dict)
    model_info: Dict[str, Any] = Field(default_factory=dict)
    is_deleted: int = 0


class IncidentVerdictUpdate(BaseModel):
    verdict: Optional[Literal["true_accident", "false_alarm", "unsure"]]
    note: Optional[str] = None


class IncidentListResponse(BaseModel):
    items: List[IncidentItem]
    total: int
    limit: int
    offset: int


# --- Camera Models ---
class CameraCalibrationData(BaseModel):
    camera_id: str
    image_points: List[List[float]]
    ground_points: List[List[float]]
    matrix: List[List[float]]


class CameraCalibrationRequest(BaseModel):
    image_points: List[List[float]]
    ground_points: List[List[float]]


class CameraItem(BaseModel):
    id: str
    name: str
    source: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    notes: Optional[str] = None
    settings_profile: Dict[str, Any] = Field(default_factory=dict)
    ignore_region: List[List[float]] = Field(default_factory=list)
    created_at: str


class CameraUpdateRequest(BaseModel):
    name: str
    source: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    notes: Optional[str] = None
    settings_profile: Optional[Dict[str, Any]] = None
    ignore_region: Optional[List[List[float]]] = None


# --- System Status Model ---
class SessionSystemInfo(BaseModel):
    session_id: str
    camera_id: str
    source: str
    status: str
    fps: float
    dropped_frames: int
    queue_depth: int


class SystemStatusResponse(BaseModel):
    active_sessions: int
    max_concurrent_sessions: int = 4
    device: str
    sessions: List[SessionSystemInfo]
    hardware_contention_warning: Optional[str] = None


# --- A/B Compare Models ---
class CompareRunResult(BaseModel):
    profile_name: str
    settings: PipelineSettings
    total_frames: int
    confirmed_alerts_count: int
    confirmed_zones: List[Dict[str, Any]]
    frame_ranges: List[Tuple[int, int]]


class CompareResponse(BaseModel):
    source: str
    run_a: CompareRunResult
    run_b: CompareRunResult
    caveat: str = "Raw counts and frame ranges only. No precision/recall or model accuracy score is inferred."
