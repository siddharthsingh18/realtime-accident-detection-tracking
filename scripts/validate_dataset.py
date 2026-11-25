#!/usr/bin/env python3
"""
Dataset Validator for Accident Detection Evaluation Harness.

Validates:
1. Presence of eval/clips/, eval/labels.csv, and eval/splits.csv.
2. Labels format: filename, label (crash|normal), crash_onset_sec (float for crash, blank for normal), condition tags.
3. Splits format: filename, split (dev|test).
4. No clip appears in both splits.
5. Every clip referenced in CSV exists on disk in eval/clips/.
6. Every clip on disk is labeled and assigned to a split.
"""

import os
import sys
import csv
import argparse
from typing import List, Dict, Set, Tuple

VALID_LABELS = {"crash", "normal"}
VALID_SPLITS = {"dev", "test"}
VALID_TAGS = {"day", "night", "rain", "dense", "dashcam", "cctv", "distant"}


def validate_dataset(eval_dir: str = "eval") -> Tuple[bool, List[str], int]:
    errors: List[str] = []
    warnings: List[str] = []

    clips_dir = os.path.join(eval_dir, "clips")
    labels_file = os.path.join(eval_dir, "labels.csv")
    splits_file = os.path.join(eval_dir, "splits.csv")

    if not os.path.exists(clips_dir):
        errors.append(f"Clips directory missing: '{clips_dir}'")
    if not os.path.exists(labels_file):
        errors.append(f"Labels file missing: '{labels_file}'")
    if not os.path.exists(splits_file):
        errors.append(f"Splits file missing: '{splits_file}'")

    if errors:
        return False, errors, 0

    # 1. Parse disk clips
    disk_clips: Set[str] = set()
    if os.path.exists(clips_dir):
        disk_clips = {
            f for f in os.listdir(clips_dir)
            if not f.startswith(".") and os.path.isfile(os.path.join(clips_dir, f))
        }

    # 2. Parse and validate labels.csv
    labels_data: Dict[str, Dict[str, str]] = {}
    with open(labels_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required_cols = {"filename", "label", "crash_onset_sec", "condition_tags"}
        if not required_cols.issubset(set(reader.fieldnames or [])):
            errors.append(
                f"labels.csv header mismatch. Expected columns: {sorted(list(required_cols))}, "
                f"got: {reader.fieldnames}"
            )
            return False, errors, len(disk_clips)

        for row_idx, row in enumerate(reader, start=2):
            fname = row.get("filename", "").strip()
            if not fname:
                errors.append(f"labels.csv row {row_idx}: 'filename' cannot be empty.")
                continue

            if fname in labels_data:
                errors.append(f"labels.csv: Duplicate entry for filename '{fname}' on row {row_idx}.")

            lbl = row.get("label", "").strip().lower()
            if lbl not in VALID_LABELS:
                errors.append(
                    f"labels.csv row {row_idx} ({fname}): Invalid label '{lbl}'. Must be 'crash' or 'normal'."
                )

            onset_raw = row.get("crash_onset_sec", "").strip()
            if lbl == "crash":
                if not onset_raw:
                    errors.append(
                        f"labels.csv row {row_idx} ({fname}): 'crash' clip must specify a numeric 'crash_onset_sec'."
                    )
                else:
                    try:
                        onset_val = float(onset_raw)
                        if onset_val < 0.0:
                            errors.append(
                                f"labels.csv row {row_idx} ({fname}): crash_onset_sec must be non-negative, got {onset_val}."
                            )
                    except ValueError:
                        errors.append(
                            f"labels.csv row {row_idx} ({fname}): Invalid crash_onset_sec '{onset_raw}'. Must be float."
                        )
            elif lbl == "normal":
                if onset_raw:
                    errors.append(
                        f"labels.csv row {row_idx} ({fname}): 'normal' clip must have empty crash_onset_sec, got '{onset_raw}'."
                    )

            # Validate tags
            tags_raw = row.get("condition_tags", "").strip()
            if tags_raw:
                # Support comma, pipe, or space delimited tags
                tags = [t.strip().lower() for t in tags_raw.replace("|", ",").replace(";", ",").split(",") if t.strip()]
                for t in tags:
                    if t not in VALID_TAGS:
                        errors.append(
                            f"labels.csv row {row_idx} ({fname}): Unknown condition tag '{t}'. Allowed: {sorted(list(VALID_TAGS))}."
                        )

            labels_data[fname] = row

    # 3. Parse and validate splits.csv
    splits_data: Dict[str, str] = {}
    with open(splits_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        required_cols = {"filename", "split"}
        if not required_cols.issubset(set(reader.fieldnames or [])):
            errors.append(
                f"splits.csv header mismatch. Expected columns: {sorted(list(required_cols))}, "
                f"got: {reader.fieldnames}"
            )
            return False, errors, len(disk_clips)

        for row_idx, row in enumerate(reader, start=2):
            fname = row.get("filename", "").strip()
            if not fname:
                errors.append(f"splits.csv row {row_idx}: 'filename' cannot be empty.")
                continue

            if fname in splits_data:
                errors.append(
                    f"splits.csv: Duplicate assignment for filename '{fname}' on row {row_idx}. A clip cannot appear in multiple splits."
                )

            split = row.get("split", "").strip().lower()
            if split not in VALID_SPLITS:
                errors.append(
                    f"splits.csv row {row_idx} ({fname}): Invalid split '{split}'. Must be 'dev' or 'test'."
                )

            splits_data[fname] = split

    # 4. Cross-check disk clips against labels and splits
    labeled_files = set(labels_data.keys())
    split_files = set(splits_data.keys())

    # Clips missing on disk
    for f in labeled_files:
        clip_path = os.path.join(clips_dir, f)
        if not os.path.exists(clip_path):
            errors.append(f"Clip '{f}' declared in labels.csv is missing on disk at '{clip_path}'.")

    # Files in labels but not in splits
    missing_split = labeled_files - split_files
    for f in sorted(missing_split):
        errors.append(f"Clip '{f}' in labels.csv is missing a split assignment in splits.csv.")

    # Files in splits but not in labels
    missing_label = split_files - labeled_files
    for f in sorted(missing_label):
        errors.append(f"Clip '{f}' in splits.csv is missing metadata in labels.csv.")

    # Files on disk without labels
    unlabeled_on_disk = disk_clips - labeled_files
    for f in sorted(unlabeled_on_disk):
        errors.append(f"Disk clip '{f}' in '{clips_dir}' has no entry in labels.csv.")

    return len(errors) == 0, errors, len(disk_clips)


def main():
    parser = argparse.ArgumentParser(description="Validate evaluation dataset layout and labels.")
    parser.add_argument("--eval-dir", default="eval", help="Path to eval directory (default: eval)")
    args = parser.parse_args()

    print(f"=== Validating Evaluation Dataset at: {args.eval_dir} ===")
    valid, errors, clip_count = validate_dataset(args.eval_dir)

    if not valid:
        print("\n❌ DATASET VALIDATION FAILED:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)

    if clip_count == 0:
        print(f"\n⚠️ SCAFFOLD READY, BUT 'eval/clips/' IS EMPTY ({clip_count} clips found).")
        print("Please place .mp4 clips into 'eval/clips/' and add entries in:")
        print("  - eval/labels.csv (filename, label [crash|normal], crash_onset_sec, condition_tags)")
        print("  - eval/splits.csv (filename, split [dev|test])")
        sys.exit(2)

    print(f"\n✓ Dataset validation passed successfully! ({clip_count} clips validated across dev/test splits)")
    sys.exit(0)


if __name__ == "__main__":
    main()
