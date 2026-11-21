#!/usr/bin/env python3
"""
Accident Detection & Vehicle Tracking System.

Main CLI pipeline integrating:
- Custom-trained YOLO model for accident detection (YOLOv8s architecture)
- Pretrained YOLO11n for vehicle detection
- BoT-SORT multi-object tracking with unique persistent IDs
- Multi-frame confirmation state machine (TENTATIVE -> ACTIVE -> MAINTAINED -> removed)
- Gated kinematic vehicle-collision detection (deceleration/convergence, anti-queue filter)
- Time-based persistence and confirmation windows
- Visual suppression of normal labels inside confirmed accident regions
- Real-time emergency alert display and annotated video production
"""

import os
import sys
import time
import argparse
import logging
import cv2
import yaml
from tqdm import tqdm

from src import (
    DualDetector,
    VehicleTracker,
    AccidentPersistenceManager,
    VehicleCollisionDetector,
    suppress_vehicles_in_accidents,
    detect_vehicle_collisions,
    resolve_fps,
    seconds_to_frames,
    Visualizer,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("TrafficMonitor")


def load_config(config_path: str = "config.yaml") -> dict:
    """Load settings from YAML configuration file."""
    if not os.path.exists(config_path):
        logger.warning(f"Config file '{config_path}' not found. Using internal defaults.")
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Road Accident Detection & Vehicle Tracking System (YOLO + BoT-SORT)"
    )
    parser.add_argument(
        "--source",
        type=str,
        default="0",
        help="Path to input video file, image, or webcam index (default: '0')",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="outputs/output.mp4",
        help="Path for saving annotated output video (default: 'outputs/output.mp4')",
    )
    parser.add_argument(
        "--config",
        type=str,
        default="config.yaml",
        help="Path to YAML configuration file (default: 'config.yaml')",
    )
    parser.add_argument(
        "--accident-model",
        type=str,
        default=None,
        help="Override path to custom accident model weights",
    )
    parser.add_argument(
        "--vehicle-model",
        type=str,
        default=None,
        help="Override path to YOLO11n vehicle model weights",
    )
    parser.add_argument(
        "--conf-accident",
        type=float,
        default=None,
        help="Override accident detection confidence threshold",
    )
    parser.add_argument(
        "--conf-vehicle",
        type=float,
        default=None,
        help="Override vehicle detection confidence threshold",
    )
    parser.add_argument(
        "--persistence-seconds",
        type=float,
        default=None,
        help="Seconds to hold accident box across temporary loss (e.g. 0.50s)",
    )
    parser.add_argument(
        "--confirm-seconds",
        type=float,
        default=None,
        help="Seconds of detection required for confirmation (e.g. 0.17s)",
    )
    parser.add_argument(
        "--tentative-grace-seconds",
        type=float,
        default=None,
        help="Seconds before dropping unconfirmed tentative zone (e.g. 0.07s)",
    )
    parser.add_argument(
        "--persistence-frames",
        type=int,
        default=None,
        help="Fallback frame count to hold accident box (backward compatibility)",
    )
    parser.add_argument(
        "--confirm-hits",
        type=int,
        default=None,
        help="Fallback hit count required to confirm an accident zone",
    )
    parser.add_argument(
        "--confirm-window",
        type=int,
        default=None,
        help="Evaluation window size in frames for confirmation hits",
    )
    parser.add_argument(
        "--tentative-grace",
        type=int,
        default=None,
        help="Fallback frame grace period before dropping tentative zone",
    )
    parser.add_argument(
        "--use-collision-heuristic",
        dest="use_collision_heuristic",
        action="store_true",
        default=None,
        help="Enable kinematic vehicle-vehicle collision heuristic",
    )
    parser.add_argument(
        "--no-collision-heuristic",
        dest="use_collision_heuristic",
        action="store_false",
        help="Disable kinematic vehicle-vehicle collision heuristic",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Inference device: 'cuda', 'cpu', or 'auto'",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Display live annotated video preview window",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Disable saving the output video to disk",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    cfg = load_config(args.config)

    device_cfg = args.device or cfg.get("device", "auto")
    device = None if device_cfg == "auto" else device_cfg

    m_cfg = cfg.get("models", {})
    acc_cfg = m_cfg.get("accident", {})
    veh_cfg = m_cfg.get("vehicle", {})

    accident_weights = args.accident_model or acc_cfg.get("weights", "models/accident_yolo11s.pt")
    vehicle_weights = args.vehicle_model or veh_cfg.get("weights", "models/yolo11n.pt")
    accident_conf = args.conf_accident if args.conf_accident is not None else acc_cfg.get("conf_threshold", 0.40)
    vehicle_conf = args.conf_vehicle if args.conf_vehicle is not None else veh_cfg.get("conf_threshold", 0.35)
    accident_iou = acc_cfg.get("iou_threshold", 0.45)
    vehicle_iou = veh_cfg.get("iou_threshold", 0.50)
    vehicle_classes = veh_cfg.get("classes", [1, 2, 3, 5, 7])

    t_cfg = cfg.get("tracker", {})
    tracker_type = t_cfg.get("type", "botsort.yaml")
    max_history = t_cfg.get("max_history", 30)

    l_cfg = cfg.get("logic", {})
    containment_threshold = l_cfg.get("containment_threshold", 0.50)
    iou_match_threshold = l_cfg.get("iou_match_threshold", 0.30)
    smoothing_alpha = l_cfg.get("smoothing_alpha", 0.70)
    suppress_labels = l_cfg.get("suppress_vehicle_labels", True)

    use_collision_heuristic = (
        args.use_collision_heuristic
        if args.use_collision_heuristic is not None
        else l_cfg.get("use_collision_heuristic", True)
    )

    v_cfg = cfg.get("visualization", {})
    visualizer = Visualizer(
        show_tracking_ids=v_cfg.get("show_tracking_ids", True),
        show_confidence=v_cfg.get("show_confidence", True),
        show_alert_banner=v_cfg.get("show_alert_banner", True),
        show_hud_stats=v_cfg.get("show_hud_stats", True),
        suppress_vehicle_labels=suppress_labels,
        line_thickness=v_cfg.get("line_thickness", 2),
    )

    # Open video source (auto-resolving relative paths inside assets/ if needed)
    if args.source.isdigit():
        source = int(args.source)
    else:
        source = args.source
        if not os.path.exists(source):
            asset_candidate = os.path.join("assets", os.path.basename(source))
            if os.path.exists(asset_candidate):
                logger.info(f"Resolved video source '{args.source}' to '{asset_candidate}'")
                source = asset_candidate

    cap = cv2.VideoCapture(source)
    if not cap.isOpened() and (args.source == "0" or args.source == 0):
        sample_path = os.path.join("assets", "sample_traffic.mp4")
        if os.path.exists(sample_path):
            logger.warning(
                f"Webcam index 0 could not be opened. Automatically falling back to sample video: '{sample_path}'"
            )
            source = sample_path
            cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        logger.error(f"Failed to open video source: {args.source}")
        sys.exit(1)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Validate and resolve FPS
    raw_fps = cap.get(cv2.CAP_PROP_FPS)
    fps = resolve_fps(raw_fps)

    # Resolve time-based timeouts to frame counts
    persistence_seconds = (
        args.persistence_seconds
        if args.persistence_seconds is not None
        else l_cfg.get("persistence_seconds", 0.50)
    )
    persistence_frames = (
        args.persistence_frames
        if args.persistence_frames is not None
        else (
            seconds_to_frames(persistence_seconds, fps)
            if persistence_seconds is not None
            else l_cfg.get("persistence_frames", 15)
        )
    )

    confirm_seconds = (
        args.confirm_seconds
        if args.confirm_seconds is not None
        else l_cfg.get("confirm_seconds", 0.17)
    )
    confirm_hits = (
        args.confirm_hits
        if args.confirm_hits is not None
        else (
            seconds_to_frames(confirm_seconds, fps)
            if confirm_seconds is not None
            else l_cfg.get("confirm_hits", 5)
        )
    )

    tentative_grace_seconds = (
        args.tentative_grace_seconds
        if args.tentative_grace_seconds is not None
        else l_cfg.get("tentative_grace_seconds", 0.07)
    )
    tentative_grace = (
        args.tentative_grace
        if args.tentative_grace is not None
        else (
            seconds_to_frames(tentative_grace_seconds, fps)
            if tentative_grace_seconds is not None
            else l_cfg.get("tentative_grace", 2)
        )
    )

    confirm_window = (
        args.confirm_window
        if args.confirm_window is not None
        else l_cfg.get("confirm_window", max(confirm_hits + 3, 8))
    )

    logger.info("=" * 60)
    logger.info("Initializing Road Accident Detection & Vehicle Tracking System")
    logger.info(f"Accident Model: {accident_weights}")
    logger.info(f"Vehicle Model:  {vehicle_weights}")
    logger.info(f"Tracker:        BoT-SORT ({tracker_type})")
    logger.info(
        f"Timeouts @ {fps:.1f} FPS: persistence={persistence_frames}f ({persistence_seconds:.2f}s), "
        f"confirm_hits={confirm_hits}f ({confirm_seconds:.2f}s), tentative_grace={tentative_grace}f ({tentative_grace_seconds:.2f}s), "
        f"confirm_window={confirm_window}f, collision_heuristic={use_collision_heuristic}"
    )
    logger.info("=" * 60)

    # Initialize Dual Detector
    detector = DualDetector(
        accident_weights=accident_weights,
        vehicle_weights=vehicle_weights,
        accident_conf=accident_conf,
        vehicle_conf=vehicle_conf,
        accident_iou=accident_iou,
        vehicle_iou=vehicle_iou,
        vehicle_classes=vehicle_classes,
        device=device,
    )

    # Initialize Tracker using the loaded vehicle model
    tracker = VehicleTracker(
        vehicle_model=detector.vehicle_model,
        tracker_type=tracker_type,
        conf=vehicle_conf,
        iou=vehicle_iou,
        classes=vehicle_classes,
        device=detector.device,
        max_history=max_history,
    )

    # Distinct confirmed zones tracking
    distinct_confirmed_zones = {}
    alerts_fired_count = 0
    alert_active_prev = False

    def on_zone_confirmed(zone):
        nonlocal alerts_fired_count
        logger.info(f"🔔 [ON_CONFIRM] Accident zone #{zone.zone_id} confirmed ACTIVE at conf={zone.conf:.2f}!")

    # Initialize Accident Persistence Manager with confirmation state machine
    persistence_mgr = AccidentPersistenceManager(
        persistence_frames=persistence_frames,
        iou_match_threshold=iou_match_threshold,
        smoothing_alpha=smoothing_alpha,
        confirm_hits=confirm_hits,
        confirm_window=confirm_window,
        tentative_grace=tentative_grace,
        on_confirm=on_zone_confirmed,
    )

    # Initialize Kinematic Collision Detector
    collision_detector = VehicleCollisionDetector(fps=fps)

    # Initialize VideoWriter if saving output
    writer = None
    if not args.no_save and args.output:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(args.output, fourcc, fps, (width, height))
        logger.info(f"Saving output video to: {args.output}")

    logger.info(f"Source: {source} | Resolution: {width}x{height} | Target FPS: {fps:.2f}")

    frame_idx = 0
    start_time = time.time()
    accident_events_total = 0
    unique_tracked_ids = set()

    pbar = tqdm(total=total_frames if total_frames > 0 else None, desc="Processing Frames", unit="frame")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            t0 = time.time()

            # 1. Track Vehicles with Pretrained YOLO11n + BoT-SORT
            tracked_vehicles = tracker.update(frame)
            for v in tracked_vehicles:
                unique_tracked_ids.add(v.track_id)

            # 2. Detect Accidents with Custom YOLO Detector
            raw_accidents = detector.detect_accidents(frame)

            # 3. Detect Vehicle-Vehicle Collisions from tracking (if enabled)
            if use_collision_heuristic:
                collisions = collision_detector.detect(tracked_vehicles, fps=fps)
            else:
                collisions = []
            all_accident_candidates = raw_accidents + collisions

            # 4. State Machine Update -> returns ONLY confirmed zones (ACTIVE / MAINTAINED)
            confirmed_accidents = persistence_mgr.update(all_accident_candidates)

            # Bookkeeping distinct confirmed zones and frame ranges
            for cz in confirmed_accidents:
                if cz.zone_id not in distinct_confirmed_zones:
                    distinct_confirmed_zones[cz.zone_id] = {
                        "first_frame": frame_idx,
                        "last_frame": frame_idx,
                        "count": 1,
                    }
                else:
                    distinct_confirmed_zones[cz.zone_id]["last_frame"] = frame_idx
                    distinct_confirmed_zones[cz.zone_id]["count"] += 1

            # Count alert state transitions (when alert banner turns ON)
            is_alerting = len(confirmed_accidents) > 0
            if is_alerting and not alert_active_prev:
                alerts_fired_count += 1
            alert_active_prev = is_alerting

            # 5. Containment Matching & Suppression of normal labels inside confirmed accident zones
            if confirmed_accidents:
                accident_events_total += len(confirmed_accidents)
                tracked_vehicles, confirmed_accidents = suppress_vehicles_in_accidents(
                    vehicles=tracked_vehicles,
                    accident_zones=confirmed_accidents,
                    containment_threshold=containment_threshold,
                    iou_threshold=iou_match_threshold,
                )

            dt = time.time() - t0
            proc_fps = 1.0 / dt if dt > 0 else fps

            # 6. Render Annotations, Alerts, and HUD (using confirmed zones only)
            annotated_frame = visualizer.render(
                frame=frame,
                vehicles=tracked_vehicles,
                accident_zones=confirmed_accidents,
                fps=proc_fps,
                frame_idx=frame_idx,
            )

            if writer:
                writer.write(annotated_frame)

            if args.show:
                cv2.imshow("Accident Detection & Vehicle Tracking System", annotated_frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    logger.info("User requested stop via 'q'. Exiting...")
                    break

            frame_idx += 1
            pbar.update(1)

    except KeyboardInterrupt:
        logger.info("Interrupted by user. Cleaning up...")
    finally:
        pbar.close()
        cap.release()
        if writer:
            writer.release()
        if args.show:
            cv2.destroyAllWindows()

    elapsed = time.time() - start_time
    avg_fps = frame_idx / elapsed if elapsed > 0 else 0.0

    logger.info("=" * 60)
    logger.info("Processing Summary:")
    logger.info(f"Total Frames Processed:   {frame_idx}")
    logger.info(f"Total Elapsed Time:        {elapsed:.2f} s")
    logger.info(f"Average Inference Speed:   {avg_fps:.2f} FPS")
    logger.info(f"Unique Vehicles Tracked:   {len(unique_tracked_ids)}")
    logger.info(f"Alert State Activations:   {alerts_fired_count}")
    logger.info(f"Active Confirmed Frames:   {accident_events_total}")
    logger.info(f"Distinct Confirmed Zones:  {len(distinct_confirmed_zones)}")
    for zid, zinfo in distinct_confirmed_zones.items():
        logger.info(f"  - Zone #{zid}: frames {zinfo['first_frame']} to {zinfo['last_frame']} ({zinfo['count']} frames)")
    if writer:
        logger.info(f"Annotated Video Output:    {args.output}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
