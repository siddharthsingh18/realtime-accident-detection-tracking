# Pipeline Evaluation Report: `eval_20261125_181610_pytorch_imgsz640_hits6`

> [!WARNING] **SMOKE TEST WARNING**: Total evaluated clips is fewer than 10. Statistical metrics and confidence intervals are wide and intended for verification only.


- **Runtime Backend**: `PYTORCH`
- **Timestamp**: `20261125_181610` UTC
- **Total Clips**: `3` (2 crashes, 1 normal clips)
- **Normal Video Duration**: `0.00 hours` (3.0s)

## 1. Overall Classification Performance

| Metric | Value | 95% Confidence Interval (Wilson) |
| :--- | :--- | :--- |
| **Recall (Sensitivity)** | **100.0%** | [34.2%, 100.0%] |
| **Precision (PPV)** | **100.0%** | [34.2%, 100.0%] |
| **F1 Score** | **1.000** | — |
| **Overall Accuracy** | **100.0%** | [43.9%, 100.0%] |
| **False Alarms / Hour** | **0.00 / hr** | Normal footage basis |

### Confusion Matrix (Clips)

| | Predicted Crash | Predicted Normal |
| :--- | :--- | :--- |
| **Actual Crash** | **TP: 2** | **FN: 0** |
| **Actual Normal** | **FP: 0** | **TN: 1** |

## 2. Detection Delay Statistics
- **Median Response Delay**: `0.02s`
- **90th Percentile Delay (p90)**: `0.03s`
- **Onset Window Rule**: Detections earlier than labeled onset or exceeding `5.0s` late are treated as misses.

## 3. Split Comparison (Dev vs Test)

| Split | Clips | TP | FP | FN | TN | Recall | Precision | F1 Score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dev (Tuning Split)** | 3 | 2 | 0 | 0 | 1 | 100.0% | 100.0% | 1.000 |

## 4. Performance Breakdown by Condition Tag

| Condition | Clips | TP | FP | FN | TN | Recall | Precision | FA / Hour | Median Delay |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cctv` | 3 | 2 | 0 | 0 | 1 | 100.0% | 100.0% | 0.0/hr | 0.02s |
| `day` | 3 | 2 | 0 | 0 | 1 | 100.0% | 100.0% | 0.0/hr | 0.02s |
| `dense` | 1 | 1 | 0 | 0 | 0 | 100.0% | 100.0% | 0.0/hr | 0.00s |

## 5. Limitations & Caveats

- **Small Clip Counts**: Small sample sizes produce wide 95% confidence intervals. Metrics reflect only evaluated test data.
- **Operational Holdout**: Test split metrics must never be used to tune thresholds or heuristics.
- **Synthetic or Offline Caveat**: Real-world camera jitter, dirty lenses, or uncalibrated geometry can shift precision.
