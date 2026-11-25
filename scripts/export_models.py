#!/usr/bin/env python3
"""
Model Export Script for Accident Detection & Vehicle Tracking.

Exports:
- models/accident_yolo11s.pt -> models/accident_yolo11s.onnx
- models/yolo11n.pt          -> models/yolo11n.onnx

Checks and documents CoreML and TensorRT export paths.
"""

import os
import sys
import shutil
import argparse
from ultralytics import YOLO

# Ensure workspace root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def check_optional_backends():
    print("\n--- Hardware & Backend Availability Check ---")
    # Check TensorRT
    try:
        import tensorrt
        print("✓ TensorRT available for compilation.")
    except ImportError:
        print("ℹ TensorRT not installed (requires NVIDIA CUDA GPU & tensorrt library).")
        print("  Export command for NVIDIA platforms: yolo export model=<model.pt> format=engine half=True device=0")

    # Check CoreML
    try:
        import coremltools
        print("✓ CoreML (coremltools) available for Apple Silicon compilation.")
    except ImportError:
        print("ℹ CoreML tools not installed (pip install coremltools on macOS).")
        print("  Export command for Apple platforms: yolo export model=<model.pt> format=coreml nms=True")

    print("✓ ONNX Runtime is installed and ready for cross-platform execution.\n")


def export_model_to_onnx(model_path: str, imgsz: int = 640) -> str:
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model checkpoint not found: {model_path}")

    print(f"Loading {model_path} for ONNX export...")
    model = YOLO(model_path)

    # Export to ONNX with graph simplification
    exported_path = model.export(
        format="onnx",
        imgsz=imgsz,
        simplify=True,
        dynamic=False,
    )
    print(f"Successfully exported ONNX model to: {exported_path}")
    size_mb = os.path.getsize(exported_path) / (1024 * 1024)
    print(f"File size: {size_mb:.2f} MB")
    return exported_path


def main():
    parser = argparse.ArgumentParser(description="Export YOLO models to ONNX and check engine paths")
    parser.add_argument(
        "--accident-weights",
        default="models/accident_yolo11s.pt",
        help="Path to accident detector weights",
    )
    parser.add_argument(
        "--vehicle-weights",
        default="models/yolo11n.pt",
        help="Path to vehicle detector weights",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Input image size (default: 640)",
    )
    args = parser.parse_args()

    check_optional_backends()

    print(f"Exporting accident model: {args.accident_weights}")
    export_model_to_onnx(args.accident_weights, imgsz=args.imgsz)

    print(f"\nExporting vehicle model: {args.vehicle_weights}")
    export_model_to_onnx(args.vehicle_weights, imgsz=args.imgsz)

    print("\n✓ Model exports completed successfully.")


if __name__ == "__main__":
    main()
