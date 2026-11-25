#!/usr/bin/env python3
"""
Benchmark utility for Accident Detection & Vehicle Tracking pipeline.
Measures:
- Vehicle model inference ms (average & p95)
- Accident model inference ms (average & p95)
- Total inference ms (average & p95)
- End-to-end FPS
- Peak memory usage in MB
"""

import os
import sys
import time
import json
import argparse
import platform
import resource
from typing import List
import cv2
import numpy as np

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.processor import FrameProcessor
from api.models import PipelineSettings


def get_peak_memory_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if platform.system() == "Darwin":
        # macOS returns ru_maxrss in bytes
        return round(usage / (1024 * 1024), 2)
    else:
        # Linux returns ru_maxrss in kilobytes
        return round(usage / 1024, 2)


def run_benchmark(
    video_path: str,
    output_path: str,
    max_frames: int = 0,
    warmup_frames: int = 5,
    backend_name: str = "pytorch",
):
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found at: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    print(f"--- Benchmarking Video: {video_path} ---")
    print(f"Total Video Frames: {total_video_frames}, FPS: {fps}, Backend: {backend_name}")

    processor = FrameProcessor(
        settings=PipelineSettings(),
        fps=fps,
        total_frames=total_video_frames,
        camera_id="cam_benchmark",
        session_id="benchmark_session",
    )

    vehicle_times: List[float] = []
    accident_times: List[float] = []
    total_infer_times: List[float] = []
    e2e_frame_times: List[float] = []

    frame_idx = 0
    t_start_total = time.time()

    while True:
        ret, frame = cap.read()
        if not ret or frame is None:
            break

        if max_frames > 0 and frame_idx >= max_frames:
            break

        t_frame_start = time.time()
        _, telemetry, _ = processor.process(frame, frame_idx=frame_idx)
        t_frame_end = time.time()

        # Discard warmup frames from metrics to avoid initialization spike
        if frame_idx >= warmup_frames:
            v_ms = telemetry.inference_ms.vehicle
            a_ms = telemetry.inference_ms.accident
            tot_ms = telemetry.inference_ms.total
            vehicle_times.append(v_ms)
            accident_times.append(a_ms)
            total_infer_times.append(tot_ms)
            e2e_frame_times.append((t_frame_end - t_frame_start) * 1000)

        frame_idx += 1
        if frame_idx % 50 == 0:
            print(f"Processed {frame_idx}/{total_video_frames} frames...")

    cap.release()
    total_duration = time.time() - t_start_total

    measured_count = len(vehicle_times)
    if measured_count == 0:
        print("Error: No frames measured.")
        return

    v_avg = float(np.mean(vehicle_times))
    v_p95 = float(np.percentile(vehicle_times, 95))

    a_avg = float(np.mean(accident_times))
    a_p95 = float(np.percentile(accident_times, 95))

    tot_avg = float(np.mean(total_infer_times))
    tot_p95 = float(np.percentile(total_infer_times, 95))

    e2e_fps = round(measured_count / (sum(e2e_frame_times) / 1000.0), 2) if e2e_frame_times else 0.0
    peak_mem_mb = get_peak_memory_mb()

    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "video": video_path,
        "total_frames_processed": frame_idx,
        "measured_frames": measured_count,
        "warmup_frames": warmup_frames,
        "backend": backend_name,
        "device": processor.settings.device,
        "vehicle_model_ms": {
            "avg": round(v_avg, 2),
            "p95": round(v_p95, 2),
        },
        "accident_model_ms": {
            "avg": round(a_avg, 2),
            "p95": round(a_p95, 2),
        },
        "total_inference_ms": {
            "avg": round(tot_avg, 2),
            "p95": round(tot_p95, 2),
        },
        "end_to_end_fps": e2e_fps,
        "peak_memory_mb": peak_mem_mb,
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"\n--- Benchmark Results ({backend_name}) ---")
    print(f"Vehicle Model:   avg = {v_avg:.2f} ms | p95 = {v_p95:.2f} ms")
    print(f"Accident Model:  avg = {a_avg:.2f} ms | p95 = {a_p95:.2f} ms")
    print(f"Total Pipeline:  avg = {tot_avg:.2f} ms | p95 = {tot_p95:.2f} ms")
    print(f"End-to-End FPS:  {e2e_fps} FPS")
    print(f"Peak Memory:     {peak_mem_mb} MB")
    print(f"Saved results to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Run pipeline performance benchmark")
    parser.add_argument("--video", default="assets/sample_traffic.mp4", help="Video path")
    parser.add_argument("--output", default="docs/benchmarks/baseline.json", help="Output JSON path")
    parser.add_argument("--frames", type=int, default=0, help="Max frames to process (0 = all)")
    parser.add_argument("--warmup", type=int, default=5, help="Warmup frames to discard")
    parser.add_argument("--backend", default="pytorch", help="Backend name")
    args = parser.parse_args()

    run_benchmark(
        video_path=args.video,
        output_path=args.output,
        max_frames=args.frames,
        warmup_frames=args.warmup,
        backend_name=args.backend,
    )


if __name__ == "__main__":
    main()
