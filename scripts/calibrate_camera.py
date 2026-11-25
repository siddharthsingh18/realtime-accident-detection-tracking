#!/usr/bin/env python3
"""
Camera Calibration Helper Tool.
Allows clicking 4 road-plane points on a video frame and specifying real-world
measurements (in meters) to compute and persist a 3x3 homography matrix.
Supports both interactive OpenCV GUI and headless CLI flags.
"""
import os
import sys
import argparse
import logging
from typing import List, Tuple, Optional
import cv2
import numpy as np

# Ensure project root is in path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from src.calibration import HomographyCalibrator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("CalibrateCamera")


def parse_points(pts_str: str) -> List[List[float]]:
    """Parse string formatted as 'x1,y1;x2,y2;x3,y3;x4,y4' or 'x1,y1 x2,y2 ...'."""
    pts = []
    # Replace semicolons or spaces with delimiters
    cleaned = pts_str.replace(";", " ").replace("|", " ")
    for item in cleaned.split():
        parts = item.strip().split(",")
        if len(parts) == 2:
            pts.append([float(parts[0].strip()), float(parts[1].strip())])
    if len(pts) != 4:
        raise ValueError(f"Expected 4 points, parsed {len(pts)} from '{pts_str}'")
    return pts


def interactive_point_picker(frame: np.ndarray, window_name: str = "Camera Calibration") -> Optional[List[List[float]]]:
    """
    OpenCV GUI window allowing user to click 4 road-plane points in order:
    1: Far-Left / Top-Left
    2: Far-Right / Top-Right
    3: Near-Right / Bottom-Right
    4: Near-Left / Bottom-Left
    """
    clicked_points: List[List[float]] = []
    display = frame.copy()

    def mouse_callback(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            if len(clicked_points) < 4:
                clicked_points.append([float(x), float(y)])
                pt_idx = len(clicked_points)
                logger.info(f"Point {pt_idx} selected at: ({x}, {y})")

    try:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 1280, 720)
        cv2.setMouseCallback(window_name, mouse_callback)
    except cv2.error as e:
        logger.warning(f"Could not open GUI window (headless/no DISPLAY environment): {e}")
        return None

    logger.info("=" * 60)
    logger.info("INTERACTIVE POINT SELECTION:")
    logger.info("Click 4 coplanar road-plane points in clockwise order:")
    logger.info("  1: Far-Left  (Top-Left)")
    logger.info("  2: Far-Right (Top-Right)")
    logger.info("  3: Near-Right (Bottom-Right)")
    logger.info("  4: Near-Left  (Bottom-Left)")
    logger.info("Controls: [r] = Reset points, [q] = Quit, [c] = Confirm (after 4 points)")
    logger.info("=" * 60)

    while True:
        canvas = display.copy()

        # Draw guidance banner
        banner_text = f"Points: {len(clicked_points)}/4. Click 4 road-plane points (1:TL, 2:TR, 3:BR, 4:BL). [r]=Reset, [c]=Confirm"
        cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 40), (20, 20, 20), -1)
        cv2.putText(canvas, banner_text, (15, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)

        # Draw selected points
        colors = [(0, 0, 255), (0, 165, 255), (0, 255, 0), (255, 0, 0)]
        for idx, (px, py) in enumerate(clicked_points):
            color = colors[idx % len(colors)]
            cv2.circle(canvas, (int(px), int(py)), 6, color, -1)
            cv2.circle(canvas, (int(px), int(py)), 10, (255, 255, 255), 2)
            cv2.putText(
                canvas,
                f"P{idx+1} ({int(px)},{int(py)})",
                (int(px) + 12, int(py) - 8),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )

        # Draw connecting polygon if 4 points are selected
        if len(clicked_points) >= 2:
            pts_arr = np.array(clicked_points, dtype=np.int32).reshape((-1, 1, 2))
            is_closed = len(clicked_points) == 4
            cv2.polylines(canvas, [pts_arr], isClosed=is_closed, color=(0, 255, 255), thickness=2)

        cv2.imshow(window_name, canvas)
        key = cv2.waitKey(30) & 0xFF

        if key == ord('r'):
            clicked_points.clear()
            logger.info("Points reset. Click 4 points again.")
        elif key == ord('q'):
            cv2.destroyAllWindows()
            return None
        elif key == ord('c') or key == 13:  # Enter or 'c'
            if len(clicked_points) == 4:
                break
            else:
                logger.warning(f"Please click all 4 points first (currently {len(clicked_points)}/4).")
        elif len(clicked_points) == 4:
            # Auto-break on 4th point after 500ms
            cv2.imshow(window_name, canvas)
            cv2.waitKey(500)
            break

    cv2.destroyAllWindows()
    return clicked_points


def main():
    parser = argparse.ArgumentParser(description="Calibrate camera road plane to real-world metric coordinates.")
    parser.add_argument("--video", type=str, default="assets/sample_traffic.mp4", help="Path to input video")
    parser.add_argument("--camera-id", type=str, default="cam_01", help="Camera identifier (e.g. cam_01)")
    parser.add_argument("--frame-idx", type=int, default=0, help="Frame index to use for calibration")
    parser.add_argument("--output", type=str, default=None, help="Output JSON path (default: calibration/<camera_id>.json)")
    parser.add_argument("--image-points", type=str, default=None, help="4 image pixel points: 'x1,y1;x2,y2;x3,y3;x4,y4'")
    parser.add_argument("--ground-points", type=str, default=None, help="4 ground points in meters: 'gx1,gy1;gx2,gy2;gx3,gy3;gx4,gy4'")
    parser.add_argument("--width-meters", type=float, default=None, help="Real-world road width in meters across points 1 and 2")
    parser.add_argument("--length-meters", type=float, default=None, help="Real-world road length in meters along points 1 and 4")

    args = parser.parse_args()
    output_path = args.output or os.path.join("calibration", f"{args.camera_id}.json")

    # Load target frame from video
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        logger.error(f"Could not open video file: {args.video}")
        sys.exit(1)

    if args.frame_idx > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        logger.error(f"Could not read frame {args.frame_idx} from {args.video}")
        sys.exit(1)

    h, w = frame.shape[:2]
    logger.info(f"Loaded frame {args.frame_idx} from {args.video} ({w}x{h})")

    # 1. Determine Image Points
    image_points: Optional[List[List[float]]] = None
    if args.image_points:
        image_points = parse_points(args.image_points)
        logger.info(f"Using image points from CLI: {image_points}")
    else:
        image_points = interactive_point_picker(frame)

    if not image_points:
        logger.error("No image points selected. In headless environments, specify --image-points.")
        sys.exit(1)

    # 2. Determine Real-World Ground Points
    ground_points: Optional[List[List[float]]] = None
    if args.ground_points:
        ground_points = parse_points(args.ground_points)
        logger.info(f"Using ground points from CLI: {ground_points}")
    elif args.width_meters is not None and args.length_meters is not None:
        wm = float(args.width_meters)
        lm = float(args.length_meters)
        ground_points = [
            [0.0, 0.0],
            [wm, 0.0],
            [wm, lm],
            [0.0, lm],
        ]
        logger.info(f"Constructed ground rectangle: {wm}m width x {lm}m length")
    else:
        # Prompt user in terminal (do not guess real distances)
        print("\n" + "=" * 60)
        print("REAL-WORLD ROAD PLANE MEASUREMENTS")
        print("Enter measured physical distances for the 4 clicked points.")
        print("=" * 60)
        choice = input("Enter [1] for Road Width & Length (meters), or [2] for exact 4 (x,y) ground coordinates: ").strip()
        if choice == "2":
            ground_points = []
            for i in range(4):
                val = input(f"Ground coordinate (x, y in meters) for Point {i+1}: ").strip()
                gx, gy = map(float, val.split(","))
                ground_points.append([gx, gy])
        else:
            w_str = input("Real-world road width between Point 1 and Point 2 (meters, e.g. 7.0 for 2 lanes): ").strip()
            l_str = input("Real-world road length between Point 1 and Point 4 (meters, e.g. 25.0): ").strip()
            wm = float(w_str)
            lm = float(l_str)
            ground_points = [
                [0.0, 0.0],
                [wm, 0.0],
                [wm, lm],
                [0.0, lm],
            ]

    # 3. Compute and Validate Homography
    try:
        calibrator = HomographyCalibrator(
            camera_id=args.camera_id,
            image_points=image_points,
            ground_points=ground_points,
        )
    except Exception as e:
        logger.error(f"Failed to compute calibration: {e}")
        sys.exit(1)

    # 4. Save Calibration
    calibrator.save(output_path)
    logger.info(f"Successfully saved camera calibration to: {output_path}")

    # 5. Verification Printout
    print("\n" + "=" * 60)
    print(f"CALIBRATION SUMMARY FOR '{args.camera_id}'")
    print("=" * 60)
    print("3x3 Homography Matrix:")
    for row in calibrator.matrix:
        print(f"  [{row[0]:12.6f}, {row[1]:12.6f}, {row[2]:12.6f}]")

    print("\nParity verification (Image Point -> Transformed Ground Point vs True Ground Point):")
    for idx, (ipt, gpt) in enumerate(zip(image_points, ground_points)):
        tgx, tgy = calibrator.transform_point(ipt[0], ipt[1])
        err = np.hypot(tgx - gpt[0], tgy - gpt[1])
        print(f"  P{idx+1}: Image ({ipt[0]:.1f}, {ipt[1]:.1f}) -> Ground ({tgx:.3f}m, {tgy:.3f}m) | True ({gpt[0]:.3f}m, {gpt[1]:.3f}m) | Error: {err:.4f}m")

    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
