#!/usr/bin/env python3
"""
Metrics calculation module for Accident Detection Evaluation Harness.

Computes:
1. Clip-level Confusion Matrix: TP, FP, FN, TN.
2. Precision, Recall, F1 with 95% Wilson score confidence intervals.
3. False alarm rate per hour of normal footage.
4. Detection delay statistics (median, p90) with strict onset bounds.
   Rule: A detection before labeled onset or > max_delay_sec (default 5.0s) late
   is counted as a miss (FN for crash, or early unassociated alarm).
5. Segmentation by condition tags (day, night, rain, dense, dashcam, cctv).
6. Precision-Recall threshold curve on dev split.
7. Backend comparison (PyTorch vs ONNX agreement).
"""

import math
from typing import List, Dict, Any, Tuple, Optional


def wilson_confidence_interval(k: int, n: int, confidence: float = 0.95) -> Tuple[float, float]:
    """
    Computes Wilson score interval for binomial proportion k/n.
    Accurate for small sample sizes and extreme proportions.
    """
    if n <= 0:
        return 0.0, 0.0

    z = 1.95996  # 95% confidence standard normal quantile
    p_hat = float(k) / float(n)

    denominator = 1.0 + (z ** 2) / n
    center_adj = p_hat + (z ** 2) / (2.0 * n)
    spread = z * math.sqrt((p_hat * (1.0 - p_hat) / n) + ((z ** 2) / (4.0 * (n ** 2))))

    lower = max(0.0, (center_adj - spread) / denominator)
    upper = min(1.0, (center_adj + spread) / denominator)

    return round(lower, 4), round(upper, 4)


def evaluate_clip_result(
    label: str,
    fired: bool,
    first_alert_sec: Optional[float],
    onset_sec: Optional[float],
    max_delay_sec: float = 5.0,
) -> Tuple[str, Optional[float], str]:
    """
    Determines classification outcome for a single clip:
    Returns (outcome_type, delay_sec, reason):
    - outcome_type in {'TP', 'FP', 'FN', 'TN'}
    - delay_sec: first_alert_sec - onset_sec (for crash clips where alert fired)
    - reason: explanation of rule application
    """
    label = label.lower().strip()

    if label == "normal":
        if fired:
            return "FP", None, "False alarm: alert fired on normal clip without accident."
        else:
            return "TN", None, "True negative: no alert fired on normal clip."

    elif label == "crash":
        if not fired or first_alert_sec is None:
            return "FN", None, "Missed crash: pipeline produced zero confirmed alerts."

        if onset_sec is None:
            # Fallback if onset missing, treat any alert as hit
            return "TP", None, "Hit: alert fired (onset unspecified)."

        delay = first_alert_sec - onset_sec

        # Early alert penalty: Alert before accident onset cannot be credited to the crash
        if delay < 0.0:
            return "FN", delay, f"Miss (Early alert): alert at {first_alert_sec:.2f}s preceded onset at {onset_sec:.2f}s."

        # Late alert penalty: Alert arrived more than max_delay_sec after crash onset
        if delay > max_delay_sec:
            return "FN", delay, f"Miss (Late alert): delay of {delay:.2f}s exceeded {max_delay_sec:.1f}s threshold."

        return "TP", delay, f"True positive: hit at {first_alert_sec:.2f}s ({delay:.2f}s after onset)."

    raise ValueError(f"Unknown label '{label}'. Must be 'crash' or 'normal'.")


def compute_metrics(
    clips: List[Dict[str, Any]],
    max_delay_sec: float = 5.0,
) -> Dict[str, Any]:
    """
    Computes comprehensive clip-level evaluation metrics.
    Each clip dict must contain:
    - filename: str
    - label: 'crash' | 'normal'
    - fired: bool
    - first_alert_sec: Optional[float]
    - crash_onset_sec: Optional[float]
    - duration_sec: float
    - condition_tags: List[str]
    """
    tp = fp = fn = tn = 0
    delays: List[float] = []
    normal_duration_sec = 0.0
    total_duration_sec = 0.0

    annotated_clips = []

    for c in clips:
        dur = float(c.get("duration_sec", 0.0))
        total_duration_sec += dur
        lbl = c.get("label", "").lower()
        if lbl == "normal":
            normal_duration_sec += dur

        outcome, delay, reason = evaluate_clip_result(
            label=lbl,
            fired=bool(c.get("fired", False)),
            first_alert_sec=c.get("first_alert_sec"),
            onset_sec=c.get("crash_onset_sec"),
            max_delay_sec=max_delay_sec,
        )

        if outcome == "TP":
            tp += 1
            if delay is not None:
                delays.append(delay)
        elif outcome == "FP":
            fp += 1
        elif outcome == "FN":
            fn += 1
        elif outcome == "TN":
            tn += 1

        c_copy = dict(c)
        c_copy["eval_outcome"] = outcome
        c_copy["detection_delay_sec"] = delay
        c_copy["eval_reason"] = reason
        annotated_clips.append(c_copy)

    total_clips = tp + fp + fn + tn
    total_crashes = tp + fn
    total_normals = fp + tn

    recall = (tp / total_crashes) if total_crashes > 0 else 0.0
    precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    accuracy = ((tp + tn) / total_clips) if total_clips > 0 else 0.0

    # 95% Wilson confidence intervals
    recall_ci = wilson_confidence_interval(tp, total_crashes)
    precision_ci = wilson_confidence_interval(tp, tp + fp)
    accuracy_ci = wilson_confidence_interval(tp + tn, total_clips)

    # False alarms per hour of normal footage
    normal_hours = normal_duration_sec / 3600.0
    fa_per_hour = (fp / normal_hours) if normal_hours > 0 else 0.0

    # Delay statistics
    delays_sorted = sorted(delays)
    median_delay = None
    p90_delay = None
    if delays_sorted:
        mid = len(delays_sorted) // 2
        median_delay = round(
            delays_sorted[mid] if len(delays_sorted) % 2 != 0 else (delays_sorted[mid - 1] + delays_sorted[mid]) / 2.0,
            2,
        )
        p90_idx = min(int(math.ceil(len(delays_sorted) * 0.90)) - 1, len(delays_sorted) - 1)
        p90_delay = round(delays_sorted[p90_idx], 2)

    return {
        "summary": {
            "total_clips": total_clips,
            "total_crashes": total_crashes,
            "total_normals": total_normals,
            "total_duration_sec": round(total_duration_sec, 2),
            "normal_duration_sec": round(normal_duration_sec, 2),
            "normal_duration_hours": round(normal_hours, 3),
        },
        "counts": {
            "TP": tp,
            "FP": fp,
            "FN": fn,
            "TN": tn,
        },
        "rates": {
            "precision": round(precision, 4),
            "precision_ci_95": precision_ci,
            "recall": round(recall, 4),
            "recall_ci_95": recall_ci,
            "f1_score": round(f1, 4),
            "accuracy": round(accuracy, 4),
            "accuracy_ci_95": accuracy_ci,
            "false_alarms_per_hour": round(fa_per_hour, 2),
        },
        "delay": {
            "sample_count": len(delays),
            "median_sec": median_delay,
            "p90_sec": p90_delay,
            "min_sec": round(min(delays), 2) if delays else None,
            "max_sec": round(max(delays), 2) if delays else None,
            "max_delay_threshold_sec": max_delay_sec,
        },
        "annotated_clips": annotated_clips,
    }


def compute_condition_breakdown(
    annotated_clips: List[Dict[str, Any]],
    max_delay_sec: float = 5.0,
) -> Dict[str, Dict[str, Any]]:
    """
    Computes breakdown metrics per condition tag (e.g. day, night, rain, dense).
    """
    tag_groups: Dict[str, List[Dict[str, Any]]] = {}

    for c in annotated_clips:
        tags = c.get("condition_tags", [])
        if isinstance(tags, str):
            tags = [t.strip().lower() for t in tags.replace("|", ",").replace(";", ",").split(",") if t.strip()]

        if not tags:
            tag_groups.setdefault("untagged", []).append(c)
        else:
            for t in tags:
                tag_groups.setdefault(t, []).append(c)

    results = {}
    for tag, group in sorted(tag_groups.items()):
        metrics = compute_metrics(group, max_delay_sec=max_delay_sec)
        results[tag] = {
            "clip_count": len(group),
            "crashes": metrics["summary"]["total_crashes"],
            "normals": metrics["summary"]["total_normals"],
            "TP": metrics["counts"]["TP"],
            "FP": metrics["counts"]["FP"],
            "FN": metrics["counts"]["FN"],
            "TN": metrics["counts"]["TN"],
            "precision": metrics["rates"]["precision"],
            "recall": metrics["rates"]["recall"],
            "f1_score": metrics["rates"]["f1_score"],
            "false_alarms_per_hour": metrics["rates"]["false_alarms_per_hour"],
            "median_delay_sec": metrics["delay"]["median_sec"],
        }

    return results


def compute_pr_curve(
    dev_clips: List[Dict[str, Any]],
    thresholds: Optional[List[float]] = None,
    max_delay_sec: float = 5.0,
) -> List[Dict[str, Any]]:
    """
    Performs precision-recall threshold sweep strictly on dev split clips.
    Uses 'max_conf' recorded during clip processing to simulate decision threshold cutoffs.
    """
    if thresholds is None:
        thresholds = [0.10, 0.20, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90]

    pr_points = []
    for th in thresholds:
        simulated_clips = []
        for c in dev_clips:
            clip_copy = dict(c)
            # Clip is considered to fire alert at threshold th if max_conf >= th
            max_c = float(c.get("max_conf", 0.0))
            simulated_clips.append({
                **clip_copy,
                "fired": max_c >= th,
                "first_alert_sec": c.get("first_alert_sec") if max_c >= th else None,
            })

        m = compute_metrics(simulated_clips, max_delay_sec=max_delay_sec)
        pr_points.append({
            "threshold": round(th, 2),
            "precision": m["rates"]["precision"],
            "recall": m["rates"]["recall"],
            "f1": m["rates"]["f1_score"],
            "TP": m["counts"]["TP"],
            "FP": m["counts"]["FP"],
            "FN": m["counts"]["FN"],
            "TN": m["counts"]["TN"],
            "fa_per_hour": m["rates"]["false_alarms_per_hour"],
        })

    return pr_points


def compare_backends(
    pt_clips: List[Dict[str, Any]],
    onnx_clips: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Compares clip-level classification agreement between PyTorch and ONNX backends.
    """
    pt_map = {c["filename"]: c for c in pt_clips}
    onnx_map = {c["filename"]: c for c in onnx_clips}

    common_files = sorted(set(pt_map.keys()) & set(onnx_map.keys()))
    if not common_files:
        return {"agreement_rate": 0.0, "total_compared": 0, "disagreements": []}

    agreed = 0
    disagreements = []

    for f in common_files:
        pt_fired = bool(pt_map[f].get("fired", False))
        onnx_fired = bool(onnx_map[f].get("fired", False))

        pt_conf = round(float(pt_map[f].get("max_conf", 0.0)), 3)
        onnx_conf = round(float(onnx_map[f].get("max_conf", 0.0)), 3)

        if pt_fired == onnx_fired:
            agreed += 1
        else:
            disagreements.append({
                "filename": f,
                "ground_truth": pt_map[f].get("label", "unknown"),
                "pytorch_fired": pt_fired,
                "pytorch_max_conf": pt_conf,
                "onnx_fired": onnx_fired,
                "onnx_max_conf": onnx_conf,
            })

    rate = round(agreed / len(common_files), 4)
    return {
        "total_compared": len(common_files),
        "agreed_clips": agreed,
        "agreement_rate": rate,
        "disagreements": disagreements,
    }
