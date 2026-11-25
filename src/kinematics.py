"""
Ground-Plane Kinematics & Time-to-Collision (TTC) Module.
Provides pure, calibrated kinematic calculations for vehicle pairs on the road surface:
- Smoothed ground-plane velocity (m/s) and acceleration (m/s^2).
- Distance and closing speed along the inter-vehicle displacement line.
- Time-to-Collision (TTC = distance / closing_speed) when closing speed > epsilon.
- Peak deceleration and relative speed drops around candidate impact windows.
- Stationary queue detection to filter out congested stop-and-go false alarms.

Units:
- Distances in meters (m).
- Velocities and speeds in meters per second (m/s).
- Accelerations and decelerations in meters per second squared (m/s^2).
- Time-to-Collision in seconds (s).
"""

import math
from typing import List, Tuple, Dict, Any, Optional
from dataclasses import dataclass, asdict


@dataclass
class VehicleKinematicProfile:
    """Smoothed kinematic state for an individual tracked vehicle."""
    track_id: int
    is_calibrated: bool
    position_m: Optional[Tuple[float, float]] = None
    velocity_mps: Optional[Tuple[float, float]] = None
    speed_mps: Optional[float] = None
    acceleration_mps2: Optional[float] = None
    peak_deceleration_mps2: float = 0.0
    is_nearly_stationary: bool = False


@dataclass
class PairKinematicEvidence:
    """Kinematic relationship and collision evidence between a pair of vehicles."""
    pair_key: Tuple[int, int]
    is_calibrated: bool
    distance_m: Optional[float] = None
    closing_speed_mps: Optional[float] = None  # Positive = approaching, Negative = separating
    ttc_s: Optional[float] = None             # Positive finite float, or float('inf')
    v1_peak_decel_mps2: float = 0.0
    v2_peak_decel_mps2: float = 0.0
    max_peak_decel_mps2: float = 0.0
    relative_speed_before_mps: Optional[float] = None
    relative_speed_after_mps: Optional[float] = None
    relative_speed_drop_mps: Optional[float] = None
    is_queued_traffic: bool = False
    passed_gate: bool = True
    confidence_boost: float = 0.0
    summary_reason: str = "Uncalibrated camera; kinematics bypassed"

    def to_dict(self) -> Dict[str, Any]:
        res = asdict(self)
        res["pair_key"] = list(self.pair_key)
        if self.ttc_s == float("inf"):
            res["ttc_s"] = None  # JSON friendly representation
            res["ttc_s_display"] = "inf"
        elif self.ttc_s is not None:
            res["ttc_s_display"] = f"{self.ttc_s:.2f}s"
        else:
            res["ttc_s_display"] = "N/A"
        return res


def smooth_ground_positions(
    ground_pts: List[Tuple[float, float]],
    window_size: int = 3,
) -> List[Tuple[float, float]]:
    """
    Apply a simple moving average filter to ground coordinates to mitigate
    bounding-box road contact jitter.
    """
    if not ground_pts:
        return []
    if len(ground_pts) < window_size:
        return list(ground_pts)

    smoothed: List[Tuple[float, float]] = []
    half = window_size // 2
    n = len(ground_pts)

    for i in range(n):
        start_idx = max(0, i - half)
        end_idx = min(n, i + half + 1)
        sub = ground_pts[start_idx:end_idx]
        mean_x = sum(p[0] for p in sub) / len(sub)
        mean_y = sum(p[1] for p in sub) / len(sub)
        smoothed.append((mean_x, mean_y))

    return smoothed


def compute_vehicle_kinematics(
    vehicle: Any,
    fps: float,
    stationary_speed_mps: float = 1.2,
    lookback_window_s: float = 1.0,
) -> VehicleKinematicProfile:
    """
    Computes smoothed ground-plane speed (m/s), acceleration (m/s^2), and peak deceleration
    from a vehicle's ground_history deque.
    If ground_history has fewer than 2 points, returns an uncalibrated/unavailable profile.
    """
    track_id = getattr(vehicle, "track_id", -1)
    ground_history = getattr(vehicle, "ground_history", None)

    if not ground_history or len(ground_history) < 2 or fps <= 0:
        return VehicleKinematicProfile(
            track_id=track_id,
            is_calibrated=False,
        )

    dt = 1.0 / fps
    raw_pts = list(ground_history)
    n = len(raw_pts)

    # Current velocity over recent window (mitigating 1-frame jitter without boundary bias)
    k = min(3, n - 1)
    dx = raw_pts[-1][0] - raw_pts[-1 - k][0]
    dy = raw_pts[-1][1] - raw_pts[-1 - k][1]
    vx = dx / (k * dt)
    vy = dy / (k * dt)
    curr_speed = math.hypot(vx, vy)

    # Acceleration and peak deceleration over lookback window
    max_frames = max(2, int(round(fps * lookback_window_s)))
    window_pts = raw_pts[-max_frames:]
    speeds: List[float] = []

    for i in range(1, len(window_pts)):
        k_step = min(2, i)
        seg_dx = window_pts[i][0] - window_pts[i - k_step][0]
        seg_dy = window_pts[i][1] - window_pts[i - k_step][1]
        seg_speed = math.hypot(seg_dx, seg_dy) / (k_step * dt)
        speeds.append(seg_speed)

    curr_accel = 0.0
    peak_decel = 0.0

    if len(speeds) >= 2:
        curr_accel = (speeds[-1] - speeds[-2]) / dt
        # Peak deceleration across the lookback window:
        # A drop in speed from earlier to later gives positive deceleration.
        for i in range(len(speeds) - 1):
            decel_val = (speeds[i] - speeds[i + 1]) / dt
            if decel_val > peak_decel:
                peak_decel = decel_val
    elif len(speeds) == 1:
        curr_accel = 0.0

    # Stationary check: vehicle remained below stationary threshold throughout window
    is_stationary = all(s <= stationary_speed_mps for s in speeds) if speeds else (curr_speed <= stationary_speed_mps)

    return VehicleKinematicProfile(
        track_id=track_id,
        is_calibrated=True,
        position_m=raw_pts[-1],
        velocity_mps=(vx, vy),
        speed_mps=curr_speed,
        acceleration_mps2=curr_accel,
        peak_deceleration_mps2=max(0.0, peak_decel),
        is_nearly_stationary=is_stationary,
    )


def compute_pair_kinematics(
    v1: Any,
    v2: Any,
    fps: float,
    lookback_window_s: float = 1.0,
    stationary_speed_mps: float = 1.2,
    closing_speed_epsilon: float = 0.1,
) -> PairKinematicEvidence:
    """
    Computes pair kinematics:
    - Distance between vehicles on ground plane (m).
    - Closing speed along the connecting line (m/s).
    - Time-to-Collision (TTC = distance / closing_speed).
    - Peak decelerations for both vehicles (m/s^2).
    - Relative speed before vs after contact (m/s).
    - Queued traffic flag if both vehicles were nearly stationary across the lookback window.
    """
    t1 = getattr(v1, "track_id", 1)
    t2 = getattr(v2, "track_id", 2)
    pair_key = (min(t1, t2), max(t1, t2))

    k1 = compute_vehicle_kinematics(v1, fps, stationary_speed_mps, lookback_window_s)
    k2 = compute_vehicle_kinematics(v2, fps, stationary_speed_mps, lookback_window_s)

    if not k1.is_calibrated or not k2.is_calibrated:
        return PairKinematicEvidence(
            pair_key=pair_key,
            is_calibrated=False,
            summary_reason="At least one vehicle lacks ground-plane calibration",
        )

    p1 = k1.position_m
    p2 = k2.position_m
    v1_vec = k1.velocity_mps
    v2_vec = k2.velocity_mps

    if p1 is None or p2 is None or v1_vec is None or v2_vec is None:
        return PairKinematicEvidence(
            pair_key=pair_key,
            is_calibrated=False,
            summary_reason="Missing spatial ground vectors",
        )

    # 1. Distance between vehicle ground contact points
    rx = p2[0] - p1[0]
    ry = p2[1] - p1[1]
    dist_m = math.hypot(rx, ry)

    # 2. Closing speed along displacement line
    # Unit vector pointing from v1 to v2:
    if dist_m > 1e-4:
        u_x = rx / dist_m
        u_y = ry / dist_m
    else:
        u_x, u_y = 0.0, 0.0

    # Rate of distance decrease: d/dt(dist) = (v2 - v1) · u_hat
    # Closing speed is positive when approaching: -d/dt(dist) = (v1 - v2) · u_hat
    closing_speed_mps = (v1_vec[0] - v2_vec[0]) * u_x + (v1_vec[1] - v2_vec[1]) * u_y

    # 3. Time-to-Collision (TTC)
    if closing_speed_mps > closing_speed_epsilon:
        ttc_s = max(0.0, dist_m / closing_speed_mps)
    else:
        ttc_s = float("inf")

    # 4. Relative speed before vs after contact
    # Examine past ground history
    dt = 1.0 / max(1.0, fps)
    pts1 = list(getattr(v1, "ground_history", []))
    pts2 = list(getattr(v2, "ground_history", []))
    window_frames = max(3, int(round(fps * lookback_window_s)))

    min_len = min(len(pts1), len(pts2))
    effective_window = min(min_len, window_frames)

    rel_speed_before = None
    rel_speed_after = math.hypot(v1_vec[0] - v2_vec[0], v1_vec[1] - v2_vec[1])
    rel_speed_drop = 0.0

    if effective_window >= 4:
        # Before contact: initial segment of the lookback window
        start_idx = max(0, min_len - effective_window)
        mid_idx = start_idx + 1

        dx1_b = (pts1[mid_idx][0] - pts1[start_idx][0]) / dt
        dy1_b = (pts1[mid_idx][1] - pts1[start_idx][1]) / dt
        dx2_b = (pts2[mid_idx][0] - pts2[start_idx][0]) / dt
        dy2_b = (pts2[mid_idx][1] - pts2[start_idx][1]) / dt

        rel_vx_b = dx1_b - dx2_b
        rel_vy_b = dy1_b - dy2_b
        rel_speed_before = math.hypot(rel_vx_b, rel_vy_b)
        rel_speed_drop = max(0.0, rel_speed_before - rel_speed_after)
    else:
        rel_speed_before = rel_speed_after
        rel_speed_drop = 0.0

    # 5. Queued traffic suppression check
    is_queued = bool(k1.is_nearly_stationary and k2.is_nearly_stationary)

    max_decel = max(k1.peak_deceleration_mps2, k2.peak_deceleration_mps2)

    return PairKinematicEvidence(
        pair_key=pair_key,
        is_calibrated=True,
        distance_m=dist_m,
        closing_speed_mps=closing_speed_mps,
        ttc_s=ttc_s,
        v1_peak_decel_mps2=k1.peak_deceleration_mps2,
        v2_peak_decel_mps2=k2.peak_deceleration_mps2,
        max_peak_decel_mps2=max_decel,
        relative_speed_before_mps=rel_speed_before,
        relative_speed_after_mps=rel_speed_after,
        relative_speed_drop_mps=rel_speed_drop,
        is_queued_traffic=is_queued,
        summary_reason="Calibrated kinematics computed successfully",
    )


def evaluate_kinematic_gate(
    evidence: PairKinematicEvidence,
    enabled: bool = False,
    mode: str = "require",
    min_ttc_before_contact_s: float = 2.0,
    min_decel_mps2: float = 4.0,
    min_relative_speed_drop_mps: float = 3.0,
) -> Tuple[bool, float, str]:
    """
    Evaluates whether a candidate pair passes the kinematic gate:
    - If enabled is False: always returns (True, 0.0, "Gate disabled (baseline)").
    - If not calibrated: returns (True, 0.0, "Uncalibrated camera; gate bypassed").
    - If queued traffic: suppressed in "require" mode.
    - If mode == "require":
        Requires AT LEAST ONE strong kinematic indicator:
        (1) TTC <= min_ttc_before_contact_s (converging fast), OR
        (2) Peak deceleration >= min_decel_mps2 (hard braking / impact jerk), OR
        (3) Relative speed drop >= min_relative_speed_drop_mps (kinetic energy dissipated).
        If none met, rejects candidate.
    - If mode == "boost":
        Always returns True (never blocks), but applies an additive confidence boost
        if strong kinematic evidence exists.

    Returns:
    (passes_gate, confidence_boost, reason)
    """
    if not enabled:
        return True, 0.0, "Kinematic gate disabled (baseline mode)"

    if not evidence.is_calibrated:
        return True, 0.0, "Camera uncalibrated; kinematic gate bypassed"

    # Queued traffic suppression rule
    if evidence.is_queued_traffic:
        if mode == "require":
            return False, 0.0, "Suppressed by kinematic gate: both vehicles stationary (queued traffic)"
        else:
            return True, -0.10, "Stationary traffic queue; confidence penalized"

    has_ttc_cue = (
        evidence.ttc_s is not None
        and evidence.ttc_s <= min_ttc_before_contact_s
        and (evidence.closing_speed_mps or 0.0) > 0.0
    )
    has_decel_cue = evidence.max_peak_decel_mps2 >= min_decel_mps2
    has_speed_drop_cue = (
        evidence.relative_speed_drop_mps is not None
        and evidence.relative_speed_drop_mps >= min_relative_speed_drop_mps
    )

    has_any_cue = has_ttc_cue or has_decel_cue or has_speed_drop_cue

    if mode == "require":
        if has_any_cue:
            cues = []
            if has_ttc_cue:
                cues.append(f"TTC={evidence.ttc_s:.2f}s <= {min_ttc_before_contact_s}s")
            if has_decel_cue:
                cues.append(f"Decel={evidence.max_peak_decel_mps2:.1f} >= {min_decel_mps2}m/s²")
            if has_speed_drop_cue:
                cues.append(f"SpeedDrop={evidence.relative_speed_drop_mps:.1f} >= {min_relative_speed_drop_mps}m/s")
            return True, 0.05, f"Verified by kinematic gate ({', '.join(cues)})"
        else:
            return False, 0.0, (
                f"Suppressed by kinematic gate: insufficient kinematic evidence "
                f"(TTC={evidence.ttc_s if evidence.ttc_s != float('inf') else 'inf'}, "
                f"PeakDecel={evidence.max_peak_decel_mps2:.1f}m/s², "
                f"Drop={evidence.relative_speed_drop_mps:.1f}m/s)"
            )
    elif mode == "boost":
        if has_any_cue:
            return True, 0.15, "Kinematic evidence verified; confidence boosted"
        else:
            return True, 0.0, "No kinematic boost applied (neutral)"

    return True, 0.0, "Unknown mode; gate defaulted to pass"
