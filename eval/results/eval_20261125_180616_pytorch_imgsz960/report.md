# Pipeline Evaluation Report: `eval_20261125_180616_pytorch_imgsz960`

> [!WARNING] **SMOKE TEST WARNING**: Total evaluated clips is fewer than 10. Statistical metrics and confidence intervals are wide and intended for verification only.


- **Runtime Backend**: `PYTORCH`
- **Timestamp**: `20261125_180616` UTC
- **Total Clips**: `3` (2 crashes, 1 normal clips)
- **Normal Video Duration**: `0.00 hours` (3.0s)

## 1. Overall Classification Performance

| Metric | Value | 95% Confidence Interval (Wilson) |
| :--- | :--- | :--- |
| **Recall (Sensitivity)** | **50.0%** | [9.4%, 90.5%] |
| **Precision (PPV)** | **50.0%** | [9.4%, 90.5%] |
| **F1 Score** | **0.500** | — |
| **Overall Accuracy** | **33.3%** | [6.2%, 79.2%] |
| **False Alarms / Hour** | **1200.00 / hr** | Normal footage basis |

### Confusion Matrix (Clips)

| | Predicted Crash | Predicted Normal |
| :--- | :--- | :--- |
| **Actual Crash** | **TP: 1** | **FN: 1** |
| **Actual Normal** | **FP: 1** | **TN: 0** |

## 2. Detection Delay Statistics
- **Median Response Delay**: `0.0s`
- **90th Percentile Delay (p90)**: `0.0s`
- **Onset Window Rule**: Detections earlier than labeled onset or exceeding `5.0s` late are treated as misses.

## 3. Split Comparison (Dev vs Test)

| Split | Clips | TP | FP | FN | TN | Recall | Precision | F1 Score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dev (Tuning Split)** | 3 | 1 | 1 | 1 | 0 | 50.0% | 50.0% | 0.500 |

## 4. Performance Breakdown by Condition Tag

| Condition | Clips | TP | FP | FN | TN | Recall | Precision | FA / Hour | Median Delay |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cctv` | 3 | 1 | 1 | 1 | 0 | 50.0% | 50.0% | 1200.0/hr | 0.00s |
| `day` | 3 | 1 | 1 | 1 | 0 | 50.0% | 50.0% | 1200.0/hr | 0.00s |
| `dense` | 1 | 1 | 0 | 0 | 0 | 100.0% | 100.0% | 0.0/hr | 0.00s |

## 5. Limitations & Caveats

- **Small Clip Counts**: Small sample sizes produce wide 95% confidence intervals. Metrics reflect only evaluated test data.
- **Operational Holdout**: Test split metrics must never be used to tune thresholds or heuristics.
- **Synthetic or Offline Caveat**: Real-world camera jitter, dirty lenses, or uncalibrated geometry can shift precision.
