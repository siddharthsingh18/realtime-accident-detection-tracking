#!/usr/bin/env python3
"""
Verify accuracy parity between PyTorch and ONNX backends.
Runs both pipelines on sample clips and calculates detection agreement:
- Mean IoU between PyTorch and ONNX bounding boxes
- Precision / Recall alignment
- Confirmed incident zone match
"""

import os
import sys
import argparse
import numpy as np
import cv2

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.processor import FrameProcessor
from api.models import PipelineSettings
from src.accident_logic import calculate_iou


def verify_parity(video_path: str = "assets/sample_traffic.mp4", max_frames: int = 150):
    print(f"=== Running Accuracy Parity Test on: {video_path} (First {max_frames} frames) ===")

    cap_pt = cv2.VideoCapture(video_path)
    cap_onnx = cv2.VideoCapture(video_path)

    fps = cap_pt.get(cv2.CAP_PROP_FPS) or 30.0

    proc_pt = FrameProcessor(
        settings=PipelineSettings(inference_backend="pytorch"),
        fps=fps,
        camera_id="cam_parity_pt",
    )
    proc_onnx = FrameProcessor(
        settings=PipelineSettings(inference_backend="onnx"),
        fps=fps,
        camera_id="cam_parity_onnx",
    )

    frame_idx = 0
    ious = []
    pt_total_vehicles = 0
    onnx_total_vehicles = 0
    matched_vehicles = 0

    pt_confirmed_zones = []
    onnx_confirmed_zones = []

    while frame_idx < max_frames:
        ret1, f1 = cap_pt.read()
        ret2, f2 = cap_onnx.read()
        if not ret1 or not ret2 or f1 is None or f2 is None:
            break

        _, tel_pt, _ = proc_pt.process(f1, frame_idx=frame_idx)
        _, tel_onnx, _ = proc_onnx.process(f2, frame_idx=frame_idx)

        boxes_pt = [t.bbox for t in tel_pt.tracks]
        boxes_onnx = [t.bbox for t in tel_onnx.tracks]

        pt_total_vehicles += len(boxes_pt)
        onnx_total_vehicles += len(boxes_onnx)

        # Match boxes by max IoU
        for b_pt in boxes_pt:
            best_iou = 0.0
            for b_on in boxes_onnx:
                iou = calculate_iou(list(b_pt), list(b_on))
                if iou > best_iou:
                    best_iou = iou
            if best_iou > 0.5:
                matched_vehicles += 1
                ious.append(best_iou)

        if tel_pt.confirmed_accidents > 0:
            pt_confirmed_zones.append(frame_idx)
        if tel_onnx.confirmed_accidents > 0:
            onnx_confirmed_zones.append(frame_idx)

        frame_idx += 1

    cap_pt.release()
    cap_onnx.release()

    mean_iou = float(np.mean(ious)) if ious else 0.0
    match_rate = (matched_vehicles / max(1, pt_total_vehicles)) * 100.0

    print(f"\n--- Parity Verification Summary ---")
    print(f"Total Frames Evaluated:       {frame_idx}")
    print(f"PyTorch Vehicle Detections:   {pt_total_vehicles}")
    print(f"ONNX Vehicle Detections:      {onnx_total_vehicles}")
    print(f"Matched Detections (IoU>0.5): {matched_vehicles} ({match_rate:.2f}%)")
    print(f"Mean IoU on Matched Boxes:    {mean_iou:.4f}")
    print(f"PyTorch Confirmed Accident Frames: {len(pt_confirmed_zones)}")
    print(f"ONNX Confirmed Accident Frames:    {len(onnx_confirmed_zones)}")

    assert mean_iou >= 0.85, f"Mean IoU {mean_iou} is lower than 0.85 tolerance"
    print("\n✓ Accuracy Parity PASSED: PyTorch and ONNX match within tolerance.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", default="assets/sample_traffic.mp4")
    parser.add_argument("--frames", type=int, default=150)
    args = parser.parse_args()
    verify_parity(args.video, args.frames)
