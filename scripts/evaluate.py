#!/usr/bin/env python3
"""
Accident Detection Pipeline Evaluation Runner.

Headless evaluation runner:
- Evaluates clips in eval/clips/ against ground truth in eval/labels.csv & eval/splits.csv.
- Default configuration snapshot saved per run.
- Supports --backend pytorch|onnx.
- Records per clip: alert fired, first alert time, alert count, max confidence, processing duration.
- Extracts failure snapshots (FP false alarms and FN misses) to eval/results/<run_id>/failures/.
- Computes metrics, Wilson confidence intervals, delay stats, and condition breakdowns.
- Performs threshold sweep strictly on dev split.
- Generates reproducible report.md and report.json.
"""

import os
import sys
import time
import json
import yaml
import csv
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np

# Ensure workspace root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.processor import FrameProcessor
from api.models import PipelineSettings
from src import resolve_fps
from scripts.validate_dataset import validate_dataset
from scripts.metrics import (
    compute_metrics,
    compute_condition_breakdown,
    compute_pr_curve,
    compare_backends,
)


def load_dataset_metadata(eval_dir: str = "eval") -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    labels_path = os.path.join(eval_dir, "labels.csv")
    splits_path = os.path.join(eval_dir, "splits.csv")

    labels_map = {}
    with open(labels_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            fname = r["filename"].strip()
            onset_raw = r.get("crash_onset_sec", "").strip()
            onset = float(onset_raw) if onset_raw else None
            labels_map[fname] = {
                "label": r.get("label", "").strip().lower(),
                "crash_onset_sec": onset,
                "condition_tags": [t.strip().lower() for t in r.get("condition_tags", "").replace("|", ",").replace(";", ",").split(",") if t.strip()],
            }

    splits_map = {}
    with open(splits_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            splits_map[r["filename"].strip()] = r.get("split", "dev").strip().lower()

    return labels_map, splits_map


def evaluate_single_clip(
    clip_path: str,
    settings: PipelineSettings,
    max_frames: int = 0,
) -> Dict[str, Any]:
    """
    Executes the standard FrameProcessor headlessly over a single video clip.
    Captures first alert time, alert count, max confidence, and rolling frame samples for failure analysis.
    """
    cap = cv2.VideoCapture(clip_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {clip_path}")

    raw_fps = cap.get(cv2.CAP_PROP_FPS)
    fps = resolve_fps(raw_fps)
    total_frames_clip = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    clip_duration_sec = total_frames_clip / fps if fps > 0 else 0.0

    processor = FrameProcessor(
        settings=settings,
        fps=fps,
        total_frames=total_frames_clip,
        camera_id="cam_eval",
    )

    frame_idx = 0
    t_start = time.time()

    fired = False
    first_alert_sec = None
    confirmed_zone_ids = set()
    max_accident_conf = 0.0

    # Frame cache for failure snapshots (frame_idx -> frame)
    sampled_frames: Dict[int, np.ndarray] = {}
    first_alert_frame_idx: Optional[int] = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            if max_frames > 0 and frame_idx >= max_frames:
                break

            # Process frame through standard pipeline
            _, telemetry, annotated_frame = processor.process(
                frame=frame,
                frame_idx=frame_idx,
                timestamp_ms=int(frame_idx / fps * 1000),
                current_fps=fps,
            )

            # Check peak confidence observed across zones or raw detections
            for z in telemetry.zones:
                if z.conf > max_accident_conf:
                    max_accident_conf = float(z.conf)

            # Check events for confirmed accident alerts
            for ev in telemetry.events:
                if ev.type == "confirmed":
                    fired = True
                    confirmed_zone_ids.add(ev.zone_id)
                    if first_alert_sec is None:
                        first_alert_sec = round(frame_idx / fps, 3)
                        first_alert_frame_idx = frame_idx

            # Sample frames every ~0.5s or store key frames for failure analysis
            if frame_idx % max(1, int(fps * 0.5)) == 0 or (first_alert_frame_idx and abs(frame_idx - first_alert_frame_idx) <= int(fps)):
                sampled_frames[frame_idx] = annotated_frame.copy()

            frame_idx += 1

    finally:
        cap.release()

    t_elapsed = time.time() - t_start
    effective_fps = frame_idx / t_elapsed if t_elapsed > 0 else 0.0

    return {
        "total_frames_processed": frame_idx,
        "clip_duration_sec": round(clip_duration_sec, 2),
        "fps_video": round(fps, 2),
        "fired": fired,
        "first_alert_sec": first_alert_sec,
        "first_alert_frame_idx": first_alert_frame_idx,
        "alert_count": len(confirmed_zone_ids),
        "max_conf": round(max_accident_conf, 4),
        "processing_time_sec": round(t_elapsed, 3),
        "processing_fps": round(effective_fps, 1),
        "sampled_frames": sampled_frames,
    }


def save_failure_snapshot(
    output_dir: str,
    clip_name: str,
    outcome: str,
    frame_idx: int,
    sec: float,
    frame: np.ndarray,
):
    os.makedirs(output_dir, exist_ok=True)
    clean_name = os.path.splitext(clip_name)[0]
    fname = f"{clean_name}_{outcome.lower()}_f{frame_idx}_{sec:.1f}s.jpg"
    out_path = os.path.join(output_dir, fname)
    cv2.imwrite(out_path, frame)
    return fname


def run_evaluation(
    eval_dir: str = "eval",
    backend: str = "pytorch",
    split_filter: str = "all",
    max_frames: int = 0,
    gate_mode: str = "off",
    imgsz: int = 640,
    sahi: bool = False,
    with_reid: bool = False,
    conf_threshold: Optional[float] = None,
    confirm_hits: Optional[int] = None,
    results_root: str = "eval/results",
) -> Dict[str, Any]:
    valid, errors, clip_count = validate_dataset(eval_dir)
    if not valid:
        print("❌ Dataset validation failed:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    if clip_count == 0:
        print(f"⚠️ 'eval/clips/' is empty ({clip_count} clips found).")
        print("Please place test .mp4 clips into eval/clips/ and define rows in eval/labels.csv and eval/splits.csv.")
        sys.exit(2)

    if clip_count < 20:
        print(f"\n⚠️ WARNING: 'eval/clips/' has {clip_count} clips (< 20 clips). Results will be only a rough signal.")

    labels_map, splits_map = load_dataset_metadata(eval_dir)
    clips_dir = os.path.join(eval_dir, "clips")

    # Run ID and directory
    now_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    tags = [f"imgsz{imgsz}"]
    if sahi:
        tags.append("sahi")
    if with_reid:
        tags.append("reid")
    if gate_mode != "off":
        tags.append(f"gate_{gate_mode}")
    if conf_threshold is not None:
        tags.append(f"conf{int(conf_threshold*100)}")
    if confirm_hits is not None:
        tags.append(f"hits{confirm_hits}")

    tag_suffix = "_" + "_".join(tags) if tags else ""
    run_id = f"eval_{now_ts}_{backend.lower()}{tag_suffix}"
    run_dir = os.path.join(results_root, run_id)
    failures_dir = os.path.join(run_dir, "failures")
    os.makedirs(failures_dir, exist_ok=True)

    # Initialize default settings with overrides
    settings = PipelineSettings(
        inference_backend=backend,
        imgsz=imgsz,
        with_reid=with_reid,
    )
    if sahi:
        settings.sahi.enabled = True
    if conf_threshold is not None:
        settings.accident_conf = conf_threshold
    if confirm_hits is not None:
        settings.confirm_seconds = confirm_hits / 30.0

    if gate_mode == "off":
        settings.kinematic_gate.enabled = False
    else:
        settings.kinematic_gate.enabled = True
        settings.kinematic_gate.mode = gate_mode

    # Save config snapshot
    config_snapshot_path = os.path.join(run_dir, "config_snapshot.yaml")
    with open(config_snapshot_path, "w", encoding="utf-8") as f:
        yaml.dump(settings.model_dump(), f, default_flow_style=False)

    print(f"\n=======================================================")
    print(f"  ACCIDENT DETECTION EVALUATION RUNNER: {run_id}")
    print(f"  Backend: {backend.upper()} | Clips Found: {clip_count} | Split: {split_filter}")
    print(f"=======================================================")

    clip_results: List[Dict[str, Any]] = []
    failure_images: List[Dict[str, Any]] = []

    sorted_files = sorted(labels_map.keys())
    for idx, fname in enumerate(sorted_files, start=1):
        meta = labels_map[fname]
        split = splits_map.get(fname, "dev")
        if split_filter != "all" and split != split_filter:
            continue

        clip_path = os.path.join(clips_dir, fname)
        print(f"[{idx}/{len(sorted_files)}] Evaluating '{fname}' ({split.upper()}) [Label: {meta['label'].upper()}]...", end=" ", flush=True)

        res = evaluate_single_clip(clip_path, settings=settings, max_frames=max_frames)
        print(f"Done in {res['processing_time_sec']:.2f}s ({res['processing_fps']} FPS) | Fired: {res['fired']} (Max Conf: {res['max_conf']})")

        clip_record = {
            "filename": fname,
            "split": split,
            "label": meta["label"],
            "crash_onset_sec": meta["crash_onset_sec"],
            "condition_tags": meta["condition_tags"],
            "duration_sec": res["clip_duration_sec"],
            "fired": res["fired"],
            "first_alert_sec": res["first_alert_sec"],
            "first_alert_frame_idx": res["first_alert_frame_idx"],
            "alert_count": res["alert_count"],
            "max_conf": res["max_conf"],
            "processing_time_sec": res["processing_time_sec"],
            "processing_fps": res["processing_fps"],
        }
        clip_results.append((clip_record, res["sampled_frames"]))

    # Save raw clips.csv
    clips_csv_path = os.path.join(run_dir, "clips.csv")
    with open(clips_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "filename", "split", "label", "crash_onset_sec", "condition_tags",
            "duration_sec", "fired", "first_alert_sec", "alert_count", "max_conf",
            "processing_time_sec", "processing_fps"
        ])
        for cr, _ in clip_results:
            writer.writerow([
                cr["filename"], cr["split"], cr["label"],
                cr["crash_onset_sec"] if cr["crash_onset_sec"] is not None else "",
                "|".join(cr["condition_tags"]), cr["duration_sec"],
                cr["fired"], cr["first_alert_sec"] if cr["first_alert_sec"] is not None else "",
                cr["alert_count"], cr["max_conf"], cr["processing_time_sec"], cr["processing_fps"]
            ])

    # Compute metrics across splits
    all_clips = [cr for cr, _ in clip_results]
    dev_clips = [cr for cr in all_clips if cr["split"] == "dev"]
    test_clips = [cr for cr in all_clips if cr["split"] == "test"]

    metrics_all = compute_metrics(all_clips)
    metrics_dev = compute_metrics(dev_clips) if dev_clips else None
    metrics_test = compute_metrics(test_clips) if test_clips else None

    # Condition breakdown
    condition_breakdown = compute_condition_breakdown(metrics_all["annotated_clips"])

    # PR curve on DEV split only
    pr_curve_dev = compute_pr_curve(dev_clips) if dev_clips else []

    # Failure Analysis: extract snapshots for FP and FN
    for idx, (cr, sampled_frames) in enumerate(clip_results):
        ann = metrics_all["annotated_clips"][idx]
        outcome = ann["eval_outcome"]
        fname = cr["filename"]

        if outcome in ("FP", "FN"):
            # Choose best snapshot
            saved_img_name = None
            if outcome == "FP" and cr["first_alert_frame_idx"] is not None:
                frame_to_save = sampled_frames.get(cr["first_alert_frame_idx"])
                if frame_to_save is not None:
                    saved_img_name = save_failure_snapshot(
                        failures_dir, fname, "FP", cr["first_alert_frame_idx"],
                        cr["first_alert_sec"] or 0.0, frame_to_save
                    )
            elif outcome == "FN":
                # Find frame closest to onset
                onset = cr["crash_onset_sec"] or 0.0
                closest_f = min(sampled_frames.keys(), key=lambda f: abs(f / max(1.0, cr.get("fps_video", 30.0)) - onset)) if sampled_frames else None
                if closest_f is not None:
                    saved_img_name = save_failure_snapshot(
                        failures_dir, fname, "FN", closest_f, onset, sampled_frames[closest_f]
                    )

            if saved_img_name:
                failure_images.append({
                    "filename": fname,
                    "image": saved_img_name,
                    "outcome": outcome,
                    "reason": ann["eval_reason"],
                    "split": cr["split"],
                    "max_conf": cr["max_conf"],
                })

    # Build report.json
    report_json_data = {
        "run_id": run_id,
        "timestamp_utc": now_ts,
        "backend": backend,
        "is_smoke_test": len(all_clips) < 10,
        "config": settings.model_dump(),
        "summary_all": metrics_all,
        "summary_dev": metrics_dev,
        "summary_test": metrics_test,
        "condition_breakdown": condition_breakdown,
        "pr_curve_dev": pr_curve_dev,
        "failure_count": len(failure_images),
        "failures": failure_images,
        "limitations": [
            f"Dataset sample count ({len(all_clips)} clips) provides wide confidence intervals." if len(all_clips) < 50 else "Adequate sample size.",
            "Tuning parameters must strictly take place on 'dev' split only; 'test' split is uncalibrated holdout.",
            "Clips with early alert (before labeled onset) or >5s late are penalized as misses to protect operator response.",
        ],
    }

    report_json_path = os.path.join(run_dir, "report.json")
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report_json_data, f, indent=2)

    # Build report.md
    report_md_content = build_markdown_report(report_json_data)
    report_md_path = os.path.join(run_dir, "report.md")
    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write(report_md_content)

    # Update latest symlink/pointer
    latest_pointer = os.path.join(results_root, "latest.json")
    with open(latest_pointer, "w", encoding="utf-8") as f:
        json.dump({"latest_run_id": run_id, "run_dir": run_dir, "timestamp": now_ts}, f, indent=2)

    print(f"\n✓ Evaluation completed successfully!")
    print(f"Results saved to: {run_dir}")
    print(f"  - Raw clips: {clips_csv_path}")
    print(f"  - JSON Report: {report_json_path}")
    print(f"  - Markdown Report: {report_md_path}")
    print(f"  - Failures: {len(failure_images)} snapshots in {failures_dir}")

    return report_json_data


def build_markdown_report(data: Dict[str, Any]) -> str:
    all_sum = data["summary_all"]
    counts = all_sum["counts"]
    rates = all_sum["rates"]
    delay = all_sum["delay"]
    dev_sum = data.get("summary_dev")
    test_sum = data.get("summary_test")

    smoke_warn = ""
    if data["is_smoke_test"]:
        smoke_warn = "> [!WARNING] **SMOKE TEST WARNING**: Total evaluated clips is fewer than 10. Statistical metrics and confidence intervals are wide and intended for verification only.\n\n"

    lines = [
        f"# Pipeline Evaluation Report: `{data['run_id']}`\n",
        smoke_warn,
        f"- **Runtime Backend**: `{data['backend'].upper()}`",
        f"- **Timestamp**: `{data['timestamp_utc']}` UTC",
        f"- **Total Clips**: `{all_sum['summary']['total_clips']}` ({all_sum['summary']['total_crashes']} crashes, {all_sum['summary']['total_normals']} normal clips)",
        f"- **Normal Video Duration**: `{all_sum['summary']['normal_duration_hours']:.2f} hours` ({all_sum['summary']['normal_duration_sec']:.1f}s)",
        "",
        "## 1. Overall Classification Performance",
        "",
        "| Metric | Value | 95% Confidence Interval (Wilson) |",
        "| :--- | :--- | :--- |",
        f"| **Recall (Sensitivity)** | **{rates['recall'] * 100:.1f}%** | [{rates['recall_ci_95'][0] * 100:.1f}%, {rates['recall_ci_95'][1] * 100:.1f}%] |",
        f"| **Precision (PPV)** | **{rates['precision'] * 100:.1f}%** | [{rates['precision_ci_95'][0] * 100:.1f}%, {rates['precision_ci_95'][1] * 100:.1f}%] |",
        f"| **F1 Score** | **{rates['f1_score']:.3f}** | — |",
        f"| **Overall Accuracy** | **{rates['accuracy'] * 100:.1f}%** | [{rates['accuracy_ci_95'][0] * 100:.1f}%, {rates['accuracy_ci_95'][1] * 100:.1f}%] |",
        f"| **False Alarms / Hour** | **{rates['false_alarms_per_hour']:.2f} / hr** | Normal footage basis |",
        "",
        "### Confusion Matrix (Clips)",
        "",
        "| | Predicted Crash | Predicted Normal |",
        "| :--- | :--- | :--- |",
        f"| **Actual Crash** | **TP: {counts['TP']}** | **FN: {counts['FN']}** |",
        f"| **Actual Normal** | **FP: {counts['FP']}** | **TN: {counts['TN']}** |",
        "",
        "## 2. Detection Delay Statistics",
        f"- **Median Response Delay**: `{delay['median_sec']}s`" if delay['median_sec'] is not None else "- **Median Response Delay**: N/A",
        f"- **90th Percentile Delay (p90)**: `{delay['p90_sec']}s`" if delay['p90_sec'] is not None else "- **90th Percentile Delay (p90)**: N/A",
        f"- **Onset Window Rule**: Detections earlier than labeled onset or exceeding `{delay['max_delay_threshold_sec']:.1f}s` late are treated as misses.",
        "",
        "## 3. Split Comparison (Dev vs Test)",
        "",
        "| Split | Clips | TP | FP | FN | TN | Recall | Precision | F1 Score |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    if dev_sum:
        c = dev_sum["counts"]
        r = dev_sum["rates"]
        lines.append(f"| **Dev (Tuning Split)** | {dev_sum['summary']['total_clips']} | {c['TP']} | {c['FP']} | {c['FN']} | {c['TN']} | {r['recall']*100:.1f}% | {r['precision']*100:.1f}% | {r['f1_score']:.3f} |")
    if test_sum:
        c = test_sum["counts"]
        r = test_sum["rates"]
        lines.append(f"| **Test (Holdout Split)** | {test_sum['summary']['total_clips']} | {c['TP']} | {c['FP']} | {c['FN']} | {c['TN']} | {r['recall']*100:.1f}% | {r['precision']*100:.1f}% | {r['f1_score']:.3f} |")

    lines.extend([
        "",
        "## 4. Performance Breakdown by Condition Tag",
        "",
        "| Condition | Clips | TP | FP | FN | TN | Recall | Precision | FA / Hour | Median Delay |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ])

    for cond, cd in data["condition_breakdown"].items():
        del_str = f"{cd['median_delay_sec']:.2f}s" if cd['median_delay_sec'] is not None else "—"
        lines.append(
            f"| `{cond}` | {cd['clip_count']} | {cd['TP']} | {cd['FP']} | {cd['FN']} | {cd['TN']} | "
            f"{cd['recall']*100:.1f}% | {cd['precision']*100:.1f}% | {cd['false_alarms_per_hour']:.1f}/hr | {del_str} |"
        )

    lines.extend([
        "",
        "## 5. Limitations & Caveats",
        "",
        "- **Small Clip Counts**: Small sample sizes produce wide 95% confidence intervals. Metrics reflect only evaluated test data.",
        "- **Operational Holdout**: Test split metrics must never be used to tune thresholds or heuristics.",
        "- **Synthetic or Offline Caveat**: Real-world camera jitter, dirty lenses, or uncalibrated geometry can shift precision.",
        "",
    ])

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Accident Detection Pipeline Evaluation Runner.")
    parser.add_argument("--eval-dir", default="eval", help="Path to evaluation dataset directory")
    parser.add_argument("--backend", default="pytorch", choices=["pytorch", "onnx"], help="Inference backend runtime")
    parser.add_argument("--gate-mode", default="off", choices=["off", "boost", "require"], help="Kinematic gate mode: off (baseline default), boost, or require")
    parser.add_argument("--imgsz", type=int, default=640, choices=[640, 960, 1280], help="Inference resolution image size")
    parser.add_argument("--sahi", action="store_true", help="Enable Sliced Aided Hyper Inference (SAHI)")
    parser.add_argument("--with-reid", action="store_true", help="Enable BoT-SORT ReID appearance embeddings")
    parser.add_argument("--conf-threshold", type=float, default=None, help="Accident confidence threshold override")
    parser.add_argument("--confirm-hits", type=int, default=None, help="Confirm hits frame count override")
    parser.add_argument("--split", default="all", choices=["all", "dev", "test"], help="Dataset split to evaluate")
    parser.add_argument("--max-frames", type=int, default=0, help="Max frames per clip (0 for complete clip)")
    args = parser.parse_args()

    run_evaluation(
        eval_dir=args.eval_dir,
        backend=args.backend,
        split_filter=args.split,
        max_frames=args.max_frames,
        gate_mode=args.gate_mode,
        imgsz=args.imgsz,
        sahi=args.sahi,
        with_reid=args.with_reid,
        conf_threshold=args.conf_threshold,
        confirm_hits=args.confirm_hits,
    )


if __name__ == "__main__":
    main()
