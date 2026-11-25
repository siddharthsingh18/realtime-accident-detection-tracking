import pytest
from scripts.metrics import (
    wilson_confidence_interval,
    evaluate_clip_result,
    compute_metrics,
    compute_condition_breakdown,
    compute_pr_curve,
    compare_backends,
)


def test_wilson_confidence_interval():
    # Edge case: zero trials
    assert wilson_confidence_interval(0, 0) == (0.0, 0.0)

    # 10 successes out of 10 trials -> center close to 1.0, lower bound strictly > 0
    lower, upper = wilson_confidence_interval(10, 10)
    assert 0.65 < lower < 1.0
    assert upper == 1.0

    # 0 successes out of 10 trials -> lower bound 0, upper bound strictly < 0.35
    lower, upper = wilson_confidence_interval(0, 10)
    assert lower == 0.0
    assert 0.0 < upper < 0.35

    # 5 out of 10 -> symmetric around 0.5
    lower, upper = wilson_confidence_interval(5, 10)
    assert lower < 0.5 < upper
    assert round(0.5 - lower, 2) == round(upper - 0.5, 2)


def test_evaluate_clip_result_normal():
    # Normal clip with no alert -> TN
    outcome, delay, reason = evaluate_clip_result(
        label="normal", fired=False, first_alert_sec=None, onset_sec=None
    )
    assert outcome == "TN"
    assert delay is None

    # Normal clip with alert fired -> FP
    outcome, delay, reason = evaluate_clip_result(
        label="normal", fired=True, first_alert_sec=3.2, onset_sec=None
    )
    assert outcome == "FP"
    assert delay is None


def test_evaluate_clip_result_crash_valid_hit():
    # Crash onset at 2.0s, alert at 3.5s (delay = 1.5s <= 5.0s max delay) -> TP
    outcome, delay, reason = evaluate_clip_result(
        label="crash", fired=True, first_alert_sec=3.5, onset_sec=2.0, max_delay_sec=5.0
    )
    assert outcome == "TP"
    assert delay == pytest.approx(1.5, abs=0.01)
    assert "True positive" in reason


def test_evaluate_clip_result_crash_miss_no_alert():
    # Crash onset at 2.0s, but no alert fired -> FN
    outcome, delay, reason = evaluate_clip_result(
        label="crash", fired=False, first_alert_sec=None, onset_sec=2.0, max_delay_sec=5.0
    )
    assert outcome == "FN"
    assert delay is None
    assert "Missed crash" in reason


def test_evaluate_clip_result_crash_early_alert_penalty():
    # Crash onset at 5.0s, but alert fired early at 3.0s -> Penalized as FN (cannot credit alert before crash)
    outcome, delay, reason = evaluate_clip_result(
        label="crash", fired=True, first_alert_sec=3.0, onset_sec=5.0, max_delay_sec=5.0
    )
    assert outcome == "FN"
    assert delay == pytest.approx(-2.0, abs=0.01)
    assert "Early alert" in reason


def test_evaluate_clip_result_crash_late_alert_penalty():
    # Crash onset at 2.0s, alert fired at 8.0s (delay = 6.0s > 5.0s max delay) -> Penalized as FN
    outcome, delay, reason = evaluate_clip_result(
        label="crash", fired=True, first_alert_sec=8.0, onset_sec=2.0, max_delay_sec=5.0
    )
    assert outcome == "FN"
    assert delay == pytest.approx(6.0, abs=0.01)
    assert "Late alert" in reason


def test_compute_metrics_and_false_alarm_rate():
    # Hand-built dataset with known ground truth:
    # 2 Crashes: 1 Hit (TP), 1 Miss (FN)
    # 2 Normals: 1 Clean (TN), 1 False Alarm (FP)
    # Total Normal duration = 1800s (0.5 hours)
    clips = [
        # Crash 1: Hit (delay 1.0s)
        {"filename": "c1.mp4", "label": "crash", "fired": True, "first_alert_sec": 3.0, "crash_onset_sec": 2.0, "duration_sec": 10.0, "condition_tags": ["day"]},
        # Crash 2: Miss (no alert)
        {"filename": "c2.mp4", "label": "crash", "fired": False, "first_alert_sec": None, "crash_onset_sec": 1.5, "duration_sec": 10.0, "condition_tags": ["rain"]},
        # Normal 1: Clean
        {"filename": "n1.mp4", "label": "normal", "fired": False, "first_alert_sec": None, "crash_onset_sec": None, "duration_sec": 900.0, "condition_tags": ["day"]},
        # Normal 2: False Alarm
        {"filename": "n2.mp4", "label": "normal", "fired": True, "first_alert_sec": 12.0, "crash_onset_sec": None, "duration_sec": 900.0, "condition_tags": ["night"]},
    ]

    metrics = compute_metrics(clips, max_delay_sec=5.0)

    # 1. Counts
    assert metrics["counts"]["TP"] == 1
    assert metrics["counts"]["FP"] == 1
    assert metrics["counts"]["FN"] == 1
    assert metrics["counts"]["TN"] == 1

    # 2. Rates
    # Precision = 1 / (1 + 1) = 0.50
    assert metrics["rates"]["precision"] == 0.50
    # Recall = 1 / (1 + 1) = 0.50
    assert metrics["rates"]["recall"] == 0.50
    # F1 = 0.50
    assert metrics["rates"]["f1_score"] == 0.50
    # Accuracy = 2 / 4 = 0.50
    assert metrics["rates"]["accuracy"] == 0.50

    # 3. False Alarm Rate per Hour
    # Normal duration = 900 + 900 = 1800s = 0.5 hours.
    # 1 FP in 0.5 hours = 2.0 false alarms / hour
    assert metrics["summary"]["normal_duration_hours"] == 0.50
    assert metrics["rates"]["false_alarms_per_hour"] == 2.0

    # 4. Delays
    assert metrics["delay"]["sample_count"] == 1
    assert metrics["delay"]["median_sec"] == 1.0


def test_condition_breakdown():
    clips = [
        {"filename": "c1.mp4", "label": "crash", "fired": True, "first_alert_sec": 2.5, "crash_onset_sec": 1.5, "duration_sec": 10.0, "condition_tags": ["night", "rain"]},
        {"filename": "n1.mp4", "label": "normal", "fired": False, "first_alert_sec": None, "crash_onset_sec": None, "duration_sec": 30.0, "condition_tags": ["night"]},
    ]
    annotated = compute_metrics(clips)["annotated_clips"]
    breakdown = compute_condition_breakdown(annotated)

    assert "night" in breakdown
    assert breakdown["night"]["clip_count"] == 2
    assert breakdown["night"]["TP"] == 1
    assert breakdown["night"]["TN"] == 1

    assert "rain" in breakdown
    assert breakdown["rain"]["clip_count"] == 1
    assert breakdown["rain"]["TP"] == 1


def test_pr_curve_dev_sweep():
    dev_clips = [
        {"filename": "c1.mp4", "label": "crash", "max_conf": 0.85, "first_alert_sec": 2.0, "crash_onset_sec": 1.0, "duration_sec": 10.0},
        {"filename": "c2.mp4", "label": "crash", "max_conf": 0.45, "first_alert_sec": 3.0, "crash_onset_sec": 1.0, "duration_sec": 10.0},
        {"filename": "n1.mp4", "label": "normal", "max_conf": 0.50, "first_alert_sec": 4.0, "crash_onset_sec": None, "duration_sec": 10.0},
    ]

    curve = compute_pr_curve(dev_clips, thresholds=[0.40, 0.60, 0.90])
    assert len(curve) == 3

    # At th=0.40: both crashes fire (TP=2), normal fires (FP=1) -> Recall=1.0, Precision=2/3 (~0.67)
    th40 = next(pt for pt in curve if pt["threshold"] == 0.40)
    assert th40["TP"] == 2
    assert th40["FP"] == 1
    assert th40["recall"] == 1.0

    # At th=0.60: only c1 fires (TP=1, FN=1), normal does not fire (FP=0, TN=1) -> Recall=0.5, Precision=1.0
    th60 = next(pt for pt in curve if pt["threshold"] == 0.60)
    assert th60["TP"] == 1
    assert th60["FP"] == 0
    assert th60["recall"] == 0.5
    assert th60["precision"] == 1.0


def test_compare_backends():
    pt = [
        {"filename": "clip1.mp4", "fired": True, "max_conf": 0.88, "label": "crash"},
        {"filename": "clip2.mp4", "fired": False, "max_conf": 0.12, "label": "normal"},
    ]
    onnx = [
        {"filename": "clip1.mp4", "fired": True, "max_conf": 0.86, "label": "crash"},
        {"filename": "clip2.mp4", "fired": False, "max_conf": 0.15, "label": "normal"},
    ]
    comp = compare_backends(pt, onnx)
    assert comp["agreement_rate"] == 1.0
    assert len(comp["disagreements"]) == 0
