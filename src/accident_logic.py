import math
import logging
from typing import List, Dict, Any, Optional, Tuple, Set, Callable
from collections import deque
from dataclasses import dataclass, field
from src.kinematics import (
    compute_pair_kinematics,
    evaluate_kinematic_gate,
)

logger = logging.getLogger("TrafficMonitor.Logic")

# Named threshold constants for kinematic collision gating (defaults marked as untuned)
DEFAULT_MIN_OVERLAP_FRAMES: int = 3           # (Untuned) Minimum consecutive frames two boxes must overlap
DEFAULT_IOU_COLLISION_THRESHOLD: float = 0.25 # (Untuned) Bounding box IoU cutoff for collision overlap
DEFAULT_CONTAINMENT_COLLISION_THRESHOLD: float = 0.40 # (Untuned) Containment ratio cutoff
DEFAULT_DECELERATION_THRESHOLD: float = 120.0 # (Untuned) Speed drop in px/sec over window to flag sudden deceleration
DEFAULT_DECELERATION_KMH_THRESHOLD: float = 35.0 # Deceleration drop in km/h for calibrated cameras
DEFAULT_MIN_RELATIVE_SPEED: float = 80.0      # (Untuned) Relative speed in px/sec for converging impact
DEFAULT_MIN_RELATIVE_SPEED_KMH: float = 25.0  # Relative speed in km/h for converging impact
DEFAULT_PARALLEL_HEADING_COS: float = 0.90    # (Untuned) Cosine threshold (~25 deg) for parallel motion
DEFAULT_PARALLEL_SPEED_DIFF_RATIO: float = 0.30 # (Untuned) Speed difference ratio for queue / lane merge filter


def resolve_fps(raw_fps: Any) -> float:
    """
    Validate FPS reading from video source.
    If <= 0, None, NaN, or Inf, falls back to 30.0 with a warning.
    """
    if raw_fps is None:
        logger.warning("Video FPS is None. Falling back to 30.0 FPS.")
        return 30.0
    try:
        val = float(raw_fps)
        if val <= 0.0 or math.isnan(val) or math.isinf(val):
            logger.warning(f"Invalid video FPS ({raw_fps}). Falling back to 30.0 FPS.")
            return 30.0
        return val
    except (ValueError, TypeError):
        logger.warning(f"Could not parse video FPS ({raw_fps}). Falling back to 30.0 FPS.")
        return 30.0


def seconds_to_frames(seconds: float, fps: float) -> int:
    """
    Convert duration in seconds to integer frame count: max(1, round(fps * seconds)).
    """
    return max(1, round(fps * seconds))


def calculate_iou(box1: List[float], box2: List[float]) -> float:
    """
    Calculate the Intersection over Union (IoU) of two bounding boxes.
    Boxes are in format [x1, y1, x2, y2].
    """
    x1_inter = max(box1[0], box2[0])
    y1_inter = max(box1[1], box2[1])
    x2_inter = min(box1[2], box2[2])
    y2_inter = min(box1[3], box2[3])

    inter_width = max(0.0, x2_inter - x1_inter)
    inter_height = max(0.0, y2_inter - y1_inter)
    inter_area = inter_width * inter_height

    if inter_area <= 0.0:
        return 0.0

    area1 = max(0.0, box1[2] - box1[0]) * max(0.0, box1[3] - box1[1])
    area2 = max(0.0, box2[2] - box2[0]) * max(0.0, box2[3] - box2[1])

    union_area = area1 + area2 - inter_area
    if union_area <= 0.0:
        return 0.0

    return inter_area / union_area


def calculate_containment(inner_box: List[float], outer_box: List[float]) -> float:
    """
    Calculate the containment ratio: Area(inner_box ∩ outer_box) / Area(inner_box).
    Determines how much of the vehicle box is engulfed within the accident region.
    """
    x1_inter = max(inner_box[0], outer_box[0])
    y1_inter = max(inner_box[1], outer_box[1])
    x2_inter = min(inner_box[2], outer_box[2])
    y2_inter = min(inner_box[3], outer_box[3])

    inter_width = max(0.0, x2_inter - x1_inter)
    inter_height = max(0.0, y2_inter - y1_inter)
    inter_area = inter_width * inter_height

    if inter_area <= 0.0:
        return 0.0

    inner_area = max(0.0, inner_box[2] - inner_box[0]) * max(0.0, inner_box[3] - inner_box[1])
    if inner_area <= 0.0:
        return 0.0

    return inter_area / inner_area


@dataclass
class AccidentZone:
    """
    Represents an ongoing detected or maintained accident region.
    States: TENTATIVE -> ACTIVE -> MAINTAINED -> removed.
    """
    zone_id: int
    bbox: List[float]  # [x1, y1, x2, y2]
    conf: float
    lost_frames: int = 0
    consecutive_hits: int = 1
    status: str = "TENTATIVE"  # "TENTATIVE", "ACTIVE", or "MAINTAINED"
    hit_window: deque = field(default_factory=lambda: deque([True], maxlen=8))
    involved_vehicle_ids: List[int] = field(default_factory=list)
    ever_involved_vehicle_ids: Set[int] = field(default_factory=set)
    collision_pair: Optional[Tuple[int, int]] = None
    has_fired_on_confirm: bool = False
    kinematics: Optional[Dict[str, Any]] = None
    static_filter: Optional[Dict[str, Any]] = None

    def smooth_bbox(self, new_bbox: List[float], alpha: float = 0.70):
        """
        Exponential moving average smoothing for bounding box coordinates.
        Default alpha=0.70 matches the persistence manager's default smoothing_alpha.
        """
        self.bbox = [
            alpha * n + (1.0 - alpha) * o for n, o in zip(new_bbox, self.bbox)
        ]


class AccidentPersistenceManager:
    """
    Confirmation State Machine & Persistence Manager for Accident Zones:
    - States: TENTATIVE -> ACTIVE -> MAINTAINED -> removed.
    - New zones begin in TENTATIVE state.
    - Promoted to ACTIVE when sum(hit_window) >= confirm_hits within confirm_window.
    - Dropped TENTATIVE zones are deleted if lost for > tentative_grace frames.
    - Dropped ACTIVE zones transition to MAINTAINED for up to persistence_frames.
    - Fires on_confirm callback exactly once when a zone first becomes ACTIVE.
    """

    def __init__(
        self,
        persistence_frames: int = 15,
        iou_match_threshold: float = 0.30,
        smoothing_alpha: float = 0.70,
        confirm_hits: int = 5,
        confirm_window: int = 8,
        tentative_grace: int = 2,
        on_confirm: Optional[Callable[[AccidentZone], None]] = None,
    ):
        self.persistence_frames = persistence_frames
        self.iou_match_threshold = iou_match_threshold
        self.smoothing_alpha = smoothing_alpha
        self.confirm_hits = confirm_hits
        self.confirm_window = confirm_window
        self.tentative_grace = tentative_grace
        self.on_confirm = on_confirm

        self.next_zone_id: int = 1
        self.active_zones: Dict[int, AccidentZone] = {}

    def confirmed_zones(self) -> List[AccidentZone]:
        """
        Returns only confirmed zones in ACTIVE or MAINTAINED state.
        TENTATIVE zones are excluded.
        """
        return [z for z in self.active_zones.values() if z.status in ("ACTIVE", "MAINTAINED")]

    def all_zones(self) -> List[AccidentZone]:
        """Returns all tracking zones including TENTATIVE."""
        return list(self.active_zones.values())

    def update(self, raw_detections: List[Dict[str, Any]]) -> List[AccidentZone]:
        """
        Update accident zones with raw detections from the current frame.
        Returns confirmed zones (ACTIVE / MAINTAINED).
        """
        matched_zone_ids: Set[int] = set()
        matched_det_indices: Set[int] = set()

        # 1. Match existing zones to current detections
        for zid, zone in self.active_zones.items():
            best_det_idx = -1
            best_iou = 0.0

            # Priority A: Match by collision vehicle_ids pair
            if zone.collision_pair is not None:
                for idx, det in enumerate(raw_detections):
                    if idx in matched_det_indices:
                        continue
                    if "vehicle_ids" in det and det["vehicle_ids"]:
                        cand_pair = tuple(sorted(det["vehicle_ids"]))
                        if cand_pair == zone.collision_pair:
                            best_det_idx = idx
                            break

            # Priority B: Spatial IoU matching if not matched by pair
            if best_det_idx < 0:
                for idx, det in enumerate(raw_detections):
                    if idx in matched_det_indices:
                        continue
                    iou = calculate_iou(zone.bbox, det["bbox"])
                    if iou > best_iou and iou >= self.iou_match_threshold:
                        best_iou = iou
                        best_det_idx = idx

            # Process matched detection
            if best_det_idx >= 0:
                matched_det = raw_detections[best_det_idx]
                zone.smooth_bbox(matched_det["bbox"], alpha=self.smoothing_alpha)
                zone.conf = matched_det["conf"]
                zone.lost_frames = 0
                zone.consecutive_hits += 1
                zone.hit_window.append(True)

                if "vehicle_ids" in matched_det and matched_det["vehicle_ids"]:
                    zone.collision_pair = tuple(sorted(matched_det["vehicle_ids"]))
                if "kinematics" in matched_det and matched_det["kinematics"]:
                    zone.kinematics = matched_det["kinematics"]
                if "static_filter" in matched_det and matched_det["static_filter"]:
                    zone.static_filter = matched_det["static_filter"]

                # State Transitions on Hit:
                if zone.status == "TENTATIVE":
                    if sum(zone.hit_window) >= self.confirm_hits:
                        zone.status = "ACTIVE"
                        if self.on_confirm and not zone.has_fired_on_confirm:
                            try:
                                self.on_confirm(zone)
                            except Exception as e:
                                logger.error(f"Error in on_confirm callback for zone #{zone.zone_id}: {e}")
                            zone.has_fired_on_confirm = True
                elif zone.status == "MAINTAINED":
                    zone.status = "ACTIVE"

                matched_zone_ids.add(zid)
                matched_det_indices.add(best_det_idx)

        # 2. Handle unmatched existing zones (missed in this frame)
        stale_zone_ids: List[int] = []
        for zid, zone in self.active_zones.items():
            if zid not in matched_zone_ids:
                zone.consecutive_hits = 0
                zone.lost_frames += 1
                zone.hit_window.append(False)

                if zone.status == "TENTATIVE":
                    # Tentative zone dropped beyond grace period -> delete immediately
                    if zone.lost_frames > self.tentative_grace:
                        stale_zone_ids.append(zid)
                elif zone.status == "ACTIVE":
                    # Active zone missed -> transition to MAINTAINED
                    zone.status = "MAINTAINED"
                    if zone.lost_frames > self.persistence_frames:
                        stale_zone_ids.append(zid)
                elif zone.status == "MAINTAINED":
                    # Maintained zone persists up to persistence_frames
                    if zone.lost_frames > self.persistence_frames:
                        stale_zone_ids.append(zid)

        for zid in stale_zone_ids:
            logger.info(f"Accident zone #{zid} removed after {self.active_zones[zid].lost_frames} lost frames.")
            del self.active_zones[zid]

        # 3. Create new zones for unmatched detections (start TENTATIVE)
        for idx, det in enumerate(raw_detections):
            if idx not in matched_det_indices:
                col_pair = (
                    tuple(sorted(det["vehicle_ids"]))
                    if "vehicle_ids" in det and det["vehicle_ids"]
                    else None
                )
                hw = deque([True], maxlen=self.confirm_window)
                
                # Check if confirm_hits <= 1 allows immediate activation
                is_immediate = (self.confirm_hits <= 1)
                initial_status = "ACTIVE" if is_immediate else "TENTATIVE"
                fired = False

                new_zone = AccidentZone(
                    zone_id=self.next_zone_id,
                    bbox=list(det["bbox"]),
                    conf=det["conf"],
                    lost_frames=0,
                    consecutive_hits=1,
                    status=initial_status,
                    hit_window=hw,
                    collision_pair=col_pair,
                    has_fired_on_confirm=fired,
                    kinematics=det.get("kinematics"),
                    static_filter=det.get("static_filter"),
                )

                if is_immediate and self.on_confirm:
                    try:
                        self.on_confirm(new_zone)
                    except Exception as e:
                        logger.error(f"Error in on_confirm callback for zone #{new_zone.zone_id}: {e}")
                    new_zone.has_fired_on_confirm = True

                self.active_zones[self.next_zone_id] = new_zone
                logger.info(
                    f"New accident zone #{self.next_zone_id} detected (conf={det['conf']:.2f}, status={initial_status})."
                )
                self.next_zone_id += 1

        return self.confirmed_zones()

    def reset(self):
        """Clear all active accident zones."""
        self.active_zones.clear()
        self.next_zone_id = 1


def suppress_vehicles_in_accidents(
    vehicles: List[Any],
    accident_zones: List[AccidentZone],
    containment_threshold: float = 0.50,
    iou_threshold: float = 0.30,
) -> Tuple[List[Any], List[AccidentZone]]:
    """
    Suppresses normal vehicle labels inside confirmed accident regions.
    - Only confirmed zones should be passed here.
    - Prunes zone.involved_vehicle_ids each frame to vehicles currently meeting the condition.
    - Records historical involvement in zone.ever_involved_vehicle_ids.
    - Suppressed vehicles remain tracked objects and count towards HUD totals (visual suppression only).
    """
    # Reset current-frame involved vehicles list for each zone
    for zone in accident_zones:
        zone.involved_vehicle_ids.clear()

    for vehicle in vehicles:
        vehicle.is_suppressed = False
        vehicle.accident_id = None

        for zone in accident_zones:
            containment = calculate_containment(vehicle.bbox, zone.bbox)
            iou = calculate_iou(vehicle.bbox, zone.bbox)

            if containment >= containment_threshold or iou >= iou_threshold:
                vehicle.is_suppressed = True
                vehicle.accident_id = zone.zone_id
                if vehicle.track_id not in zone.involved_vehicle_ids:
                    zone.involved_vehicle_ids.append(vehicle.track_id)
                zone.ever_involved_vehicle_ids.add(vehicle.track_id)
                break

    return vehicles, accident_zones


class VehicleCollisionDetector:
    """
    Stateful kinematic vehicle-vehicle collision detector.
    Gated by multi-frame overlap and kinematic cues to prevent false alarms
    in dense parallel queues and normal lane merges.
    """

    def __init__(
        self,
        min_overlap_frames: int = DEFAULT_MIN_OVERLAP_FRAMES,
        iou_collision_threshold: float = DEFAULT_IOU_COLLISION_THRESHOLD,
        containment_collision_threshold: float = DEFAULT_CONTAINMENT_COLLISION_THRESHOLD,
        deceleration_threshold: float = DEFAULT_DECELERATION_THRESHOLD,
        deceleration_threshold_kmh: float = DEFAULT_DECELERATION_KMH_THRESHOLD,
        min_relative_speed: float = DEFAULT_MIN_RELATIVE_SPEED,
        min_relative_speed_kmh: float = DEFAULT_MIN_RELATIVE_SPEED_KMH,
        parallel_heading_cos: float = DEFAULT_PARALLEL_HEADING_COS,
        parallel_speed_diff_ratio: float = DEFAULT_PARALLEL_SPEED_DIFF_RATIO,
        fps: float = 30.0,
        calibrator: Optional[Any] = None,
        kinematic_gate_enabled: bool = False,
        kinematic_gate_mode: str = "require",
        min_ttc_before_contact_s: float = 2.0,
        min_decel_mps2: float = 4.0,
        min_relative_speed_drop_mps: float = 3.0,
        lookback_window_s: float = 1.0,
        stationary_speed_mps: float = 1.2,
    ):
        self.min_overlap_frames = min_overlap_frames
        self.iou_collision_threshold = iou_collision_threshold
        self.containment_collision_threshold = containment_collision_threshold
        self.deceleration_threshold = deceleration_threshold
        self.deceleration_threshold_kmh = deceleration_threshold_kmh
        self.min_relative_speed = min_relative_speed
        self.min_relative_speed_kmh = min_relative_speed_kmh
        self.parallel_heading_cos = parallel_heading_cos
        self.parallel_speed_diff_ratio = parallel_speed_diff_ratio
        self.fps = fps
        self.calibrator = calibrator
        self.kinematic_gate_enabled = kinematic_gate_enabled
        self.kinematic_gate_mode = kinematic_gate_mode
        self.min_ttc_before_contact_s = min_ttc_before_contact_s
        self.min_decel_mps2 = min_decel_mps2
        self.min_relative_speed_drop_mps = min_relative_speed_drop_mps
        self.lookback_window_s = lookback_window_s
        self.stationary_speed_mps = stationary_speed_mps

        # Track consecutive overlapping frames: pair_key (id1, id2) -> int
        self.overlap_counts: Dict[Tuple[int, int], int] = {}

    def reset(self):
        """Reset overlap tracking history."""
        self.overlap_counts.clear()

    def _compute_kinematics(self, vehicle: Any, fps: float) -> Tuple[float, float, Tuple[float, float], float]:
        """
        Computes (current_speed, prev_speed, unit_heading, speed_drop).
        If the vehicle has calibrated metric speed (km/h), speeds and drops are in km/h.
        Otherwise falls back to pixel/sec values from centroid history.
        """
        # Metric road-plane calculation if calibrated
        if self.calibrator is not None and getattr(vehicle, "speed_kmh", None) is not None:
            speed_curr = float(vehicle.speed_kmh)
            shist = getattr(vehicle, "speed_history_kmh", None)
            if shist and len(shist) >= 2:
                speed_prev = float(list(shist)[-2])
            else:
                speed_prev = speed_curr
            speed_drop = max(0.0, speed_prev - speed_curr)

            # Ground-plane heading from ground history if available
            ghistory = getattr(vehicle, "ground_history", None)
            if ghistory and len(ghistory) >= 2:
                g_pts = list(ghistory)
                dgx = g_pts[-1][0] - g_pts[-2][0]
                dgy = g_pts[-1][1] - g_pts[-2][1]
                g_dist = math.hypot(dgx, dgy)
                unit_heading = (dgx / g_dist, dgy / g_dist) if g_dist > 1e-4 else (0.0, 0.0)
            else:
                unit_heading = (0.0, 0.0)

            return speed_curr, speed_prev, unit_heading, speed_drop

        # Uncalibrated fallback: centroid history in pixels/s
        history = getattr(vehicle, "history", None)
        if not history or len(history) < 2:
            return 0.0, 0.0, (0.0, 0.0), 0.0

        n = len(history)
        pts = list(history)

        # Current velocity over last 2 points
        dx_curr = pts[-1][0] - pts[-2][0]
        dy_curr = pts[-1][1] - pts[-2][1]
        vx_curr = dx_curr * fps
        vy_curr = dy_curr * fps
        speed_curr = math.hypot(vx_curr, vy_curr)

        unit_heading = (vx_curr / speed_curr, vy_curr / speed_curr) if speed_curr > 1e-3 else (0.0, 0.0)

        # Previous velocity over points [-3, -2] if available
        if n >= 3:
            dx_prev = pts[-2][0] - pts[-3][0]
            dy_prev = pts[-2][1] - pts[-3][1]
            vx_prev = dx_prev * fps
            vy_prev = dy_prev * fps
            speed_prev = math.hypot(vx_prev, vy_prev)
        else:
            speed_prev = speed_curr

        speed_drop = max(0.0, speed_prev - speed_curr)
        return speed_curr, speed_prev, unit_heading, speed_drop

    def detect(
        self,
        tracked_vehicles: List[Any],
        fps: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Detects vehicle-vehicle collisions requiring ALL of:
        (a) Overlap above thresholds for at least min_overlap_frames consecutive frames.
        (b) Kinematic cue: sharp deceleration of one vehicle OR converging vectors with significant relative speed.
        (c) Exclusion of parallel vehicles moving at similar speed (queue / lane merge).
        """
        current_fps = fps if fps is not None and fps > 0 else self.fps
        collision_detections = []
        num_v = len(tracked_vehicles)
        seen_overlapping_pairs: Set[Tuple[int, int]] = set()

        for i in range(num_v):
            for j in range(i + 1, num_v):
                v1 = tracked_vehicles[i]
                v2 = tracked_vehicles[j]

                # Bounding box spatial overlap
                iou = calculate_iou(v1.bbox, v2.bbox)
                c1 = calculate_containment(v1.bbox, v2.bbox)
                c2 = calculate_containment(v2.bbox, v1.bbox)
                max_cont = max(c1, c2)

                is_overlapping = (
                    iou >= self.iou_collision_threshold or
                    max_cont >= self.containment_collision_threshold
                )

                pair_key = (min(v1.track_id, v2.track_id), max(v1.track_id, v2.track_id))

                if not is_overlapping:
                    continue

                seen_overlapping_pairs.add(pair_key)
                self.overlap_counts[pair_key] = self.overlap_counts.get(pair_key, 0) + 1

                # Condition (a): Minimum consecutive overlap frames
                if self.overlap_counts[pair_key] < self.min_overlap_frames:
                    continue

                # Compute kinematics
                s1, s1_prev, h1, drop1 = self._compute_kinematics(v1, current_fps)
                s2, s2_prev, h2, drop2 = self._compute_kinematics(v2, current_fps)

                # Relative velocity vector
                history1 = getattr(v1, "history", None)
                history2 = getattr(v2, "history", None)
                p1 = history1[-1] if history1 else v1.centroid
                p2 = history2[-1] if history2 else v2.centroid

                v1_vec = (h1[0] * s1, h1[1] * s1)
                v2_vec = (h2[0] * s2, h2[1] * s2)
                v_rel = (v1_vec[0] - v2_vec[0], v1_vec[1] - v2_vec[1])
                rel_speed = math.hypot(v_rel[0], v_rel[1])

                # Condition (c): Check parallel heading with similar speed (queue / merge)
                cos_heading = h1[0] * h2[0] + h1[1] * h2[1]
                max_speed = max(s1, s2, 1e-3)
                speed_diff_ratio = abs(s1 - s2) / max_speed

                is_parallel = cos_heading >= self.parallel_heading_cos
                is_similar_speed = speed_diff_ratio <= self.parallel_speed_diff_ratio

                # Condition (b): Kinematic cues
                is_calibrated = (
                    self.calibrator is not None
                    and getattr(v1, "speed_kmh", None) is not None
                    and getattr(v2, "speed_kmh", None) is not None
                )

                if is_calibrated:
                    has_deceleration = (
                        drop1 >= self.deceleration_threshold_kmh
                        or drop2 >= self.deceleration_threshold_kmh
                    )
                    min_rel = self.min_relative_speed_kmh
                else:
                    has_deceleration = (
                        drop1 >= self.deceleration_threshold
                        or drop2 >= self.deceleration_threshold
                    )
                    min_rel = self.min_relative_speed

                # Distance vector and closing rate
                r_vec = (p2[0] - p1[0], p2[1] - p1[1])
                dist = math.hypot(r_vec[0], r_vec[1])
                # Approaching if displacement dot relative velocity < 0
                is_converging = False
                if dist > 1e-3 and rel_speed >= min_rel:
                    closing_rate = (r_vec[0] * (v2_vec[0] - v1_vec[0]) + r_vec[1] * (v2_vec[1] - v1_vec[1])) / dist
                    if closing_rate < -min_rel * 0.5 or cos_heading < 0.0:
                        is_converging = True

                # Parallel queue filter: if parallel with similar speed and NO sharp deceleration -> exclude
                if is_parallel and is_similar_speed and not has_deceleration:
                    continue

                # Require kinematic cue: sharp deceleration OR converging vectors
                if not (has_deceleration or is_converging):
                    continue

                # Ground-plane Time-to-Collision (TTC) & Deceleration Gating
                kin_evidence = compute_pair_kinematics(
                    v1=v1,
                    v2=v2,
                    fps=current_fps,
                    lookback_window_s=self.lookback_window_s,
                    stationary_speed_mps=self.stationary_speed_mps,
                )
                passes_gate, conf_boost, gate_reason = evaluate_kinematic_gate(
                    evidence=kin_evidence,
                    enabled=self.kinematic_gate_enabled,
                    mode=self.kinematic_gate_mode,
                    min_ttc_before_contact_s=self.min_ttc_before_contact_s,
                    min_decel_mps2=self.min_decel_mps2,
                    min_relative_speed_drop_mps=self.min_relative_speed_drop_mps,
                )
                if not passes_gate:
                    logger.info(f"Collision candidate pair {pair_key} {gate_reason}")
                    continue

                # Enclosing union bounding box
                col_box = [
                    min(v1.bbox[0], v2.bbox[0]),
                    min(v1.bbox[1], v2.bbox[1]),
                    max(v1.bbox[2], v2.bbox[2]),
                    max(v1.bbox[3], v2.bbox[3]),
                ]
                base_conf = max(iou * 1.5, max_cont * 1.2, 0.60)
                conf = min(0.98, max(0.10, base_conf + conf_boost))

                collision_detections.append({
                    "bbox": col_box,
                    "conf": float(conf),
                    "class_id": -1,
                    "class_name": "collision",
                    "vehicle_ids": [v1.track_id, v2.track_id],
                    "kinematics": kin_evidence.to_dict() if kin_evidence.is_calibrated else None,
                })

        # Clear pairs that are no longer overlapping
        pairs_to_remove = [k for k in self.overlap_counts if k not in seen_overlapping_pairs]
        for k in pairs_to_remove:
            del self.overlap_counts[k]

        return collision_detections


# Module-level default collision detector instance
_default_collision_detector = VehicleCollisionDetector()


def detect_vehicle_collisions(
    tracked_vehicles: List[Any],
    iou_collision_threshold: float = DEFAULT_IOU_COLLISION_THRESHOLD,
    containment_collision_threshold: float = DEFAULT_CONTAINMENT_COLLISION_THRESHOLD,
    min_overlap_frames: int = DEFAULT_MIN_OVERLAP_FRAMES,
    deceleration_threshold: float = DEFAULT_DECELERATION_THRESHOLD,
    deceleration_threshold_kmh: float = DEFAULT_DECELERATION_KMH_THRESHOLD,
    min_relative_speed: float = DEFAULT_MIN_RELATIVE_SPEED,
    min_relative_speed_kmh: float = DEFAULT_MIN_RELATIVE_SPEED_KMH,
    parallel_heading_cos: float = DEFAULT_PARALLEL_HEADING_COS,
    parallel_speed_diff_ratio: float = DEFAULT_PARALLEL_SPEED_DIFF_RATIO,
    fps: float = 30.0,
    detector: Optional[VehicleCollisionDetector] = None,
    calibrator: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Detects potential vehicle-vehicle collision events directly from multi-object tracking.
    Functional wrapper delegating to VehicleCollisionDetector.
    """
    inst = detector or _default_collision_detector
    inst.iou_collision_threshold = iou_collision_threshold
    inst.containment_collision_threshold = containment_collision_threshold
    inst.min_overlap_frames = min_overlap_frames
    inst.deceleration_threshold = deceleration_threshold
    inst.deceleration_threshold_kmh = deceleration_threshold_kmh
    inst.min_relative_speed = min_relative_speed
    inst.min_relative_speed_kmh = min_relative_speed_kmh
    inst.parallel_heading_cos = parallel_heading_cos
    inst.parallel_speed_diff_ratio = parallel_speed_diff_ratio
    inst.calibrator = calibrator
    return inst.detect(tracked_vehicles, fps=fps)
