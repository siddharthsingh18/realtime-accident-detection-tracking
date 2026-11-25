import os
import logging
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np
import torch
from ultralytics import YOLO

logger = logging.getLogger("TrafficMonitor.Detector")

# Default COCO classes for vehicles: 1: bicycle, 2: car, 3: motorcycle, 5: bus, 7: truck
DEFAULT_VEHICLE_CLASSES = [1, 2, 3, 5, 7]


class DualDetector:
    """
    Manages dual YOLO models:
    - Custom-trained YOLO11s for road accident detection.
    - Pretrained YOLO11n for vehicle detection.
    """

    def __init__(
        self,
        accident_weights: str = "models/accident_yolo11s.pt",
        vehicle_weights: str = "yolo11n.pt",
        accident_conf: float = 0.40,
        vehicle_conf: float = 0.35,
        accident_iou: float = 0.45,
        vehicle_iou: float = 0.50,
        vehicle_classes: Optional[List[int]] = None,
        device: Optional[str] = None,
        backend: str = "pytorch",
        imgsz: int = 640,
        sahi_enabled: bool = False,
        sahi_slice_size: int = 640,
        sahi_overlap_ratio: float = 0.20,
        sahi_merge_iou: float = 0.50,
        sahi_interval: int = 3,
    ):
        self.device = self._resolve_device(device)
        self.backend = (backend or "pytorch").lower()
        self.imgsz = imgsz
        self.sahi_enabled = sahi_enabled
        self.sahi_slice_size = sahi_slice_size
        self.sahi_overlap_ratio = sahi_overlap_ratio
        self.sahi_merge_iou = sahi_merge_iou
        self.sahi_interval = max(1, sahi_interval)
        self.accident_conf = accident_conf
        self.vehicle_conf = vehicle_conf
        self.accident_iou = accident_iou
        self.vehicle_iou = vehicle_iou
        self.vehicle_classes = vehicle_classes or DEFAULT_VEHICLE_CLASSES

        if self.backend == "onnx":
            if accident_weights.endswith(".pt"):
                cand = accident_weights[:-3] + ".onnx"
                if os.path.exists(cand):
                    accident_weights = cand
            if vehicle_weights.endswith(".pt"):
                cand = vehicle_weights[:-3] + ".onnx"
                if os.path.exists(cand):
                    vehicle_weights = cand

        # Load Accident Model
        self.accident_weights = self._resolve_weights(
            accident_weights,
            fallback="models/accident_yolo11s.pt",
            description="accident",
        )
        logger.info(f"Loading accident detector from '{self.accident_weights}' on {self.device}...")
        self.accident_model = YOLO(self.accident_weights)

        # Detect whether the loaded model contains explicit accident/crash classes
        self.accident_class_ids = [
            cid for cid, cname in self.accident_model.names.items()
            if any(k in str(cname).lower() for k in ["accident", "crash", "collision", "incident", "damage", "wreck"])
        ]
        self.has_accident_class = len(self.accident_class_ids) > 0
        if not self.has_accident_class:
            logger.warning(
                f"Model '{self.accident_weights}' does not contain dedicated 'accident' or 'crash' classes. "
                "Base vehicle classes will NOT be mislabeled as accidents. "
                "Please use a custom-trained accident weights file (e.g. 'models/accident_yolo11s.pt')."
            )
        else:
            acc_names = [self.accident_model.names[cid] for cid in self.accident_class_ids]
            logger.info(f"Accident detector active with accident class IDs: {self.accident_class_ids} ({acc_names})")

        # Load Vehicle Model (YOLO11n)
        self.vehicle_weights = self._resolve_weights(
            vehicle_weights,
            fallback="yolo11n.pt",
            description="vehicle",
        )
        logger.info(f"Loading vehicle detector from '{self.vehicle_weights}' on {self.device}...")
        self.vehicle_model = YOLO(self.vehicle_weights)

    def _resolve_device(self, requested_device: Optional[str]) -> str:
        if requested_device:
            if requested_device == "cuda" and not torch.cuda.is_available():
                logger.warning("CUDA requested but not available. Falling back to CPU.")
                return "cpu"
            return requested_device
        return "cuda" if torch.cuda.is_available() else "cpu"

    def _resolve_weights(self, path: str, fallback: str, description: str) -> str:
        """Resolves weights path, checking direct path, models/ subdirectory, or fallback."""
        if os.path.exists(path):
            return path
        # Check inside models/ directory
        candidate = os.path.join("models", os.path.basename(path))
        if os.path.exists(candidate):
            return candidate

        logger.warning(
            f"{description.capitalize()} model weights not found at '{path}'. Falling back to '{fallback}'."
        )
        return fallback

    def _parse_accident_boxes(self, results, x_offset: float = 0.0, y_offset: float = 0.0) -> List[Dict[str, Any]]:
        detections = []
        if not results or len(results) == 0:
            return detections

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return detections

        for box in boxes:
            xyxy = box.xyxy[0].cpu().numpy().tolist()
            conf = float(box.conf[0].cpu().numpy())
            cls_id = int(box.cls[0].cpu().numpy())
            cls_name = self.accident_model.names.get(cls_id, "")

            # Filter: only accept genuine accident / crash class predictions
            if cls_id in self.accident_class_ids or any(
                k in str(cls_name).lower() for k in ["accident", "crash", "collision", "incident"]
            ):
                detections.append({
                    "bbox": [float(xyxy[0] + x_offset), float(xyxy[1] + y_offset), float(xyxy[2] + x_offset), float(xyxy[3] + y_offset)],
                    "conf": conf,
                    "class_id": cls_id,
                    "class_name": cls_name if "accident" in cls_name.lower() else "accident",
                })

        return detections

    def detect_accidents(self, frame: np.ndarray, frame_idx: int = 0) -> List[Dict[str, Any]]:
        """
        Run inference using the custom YOLO accident detector.
        Supports standard whole-frame inference (with configurable imgsz) and
        optional SAHI sliced inference.
        """
        if not self.has_accident_class:
            return []

        # SAHI Sliced Inference path
        if self.sahi_enabled and (frame_idx % self.sahi_interval == 0):
            return self._detect_accidents_sahi(frame)

        # Standard whole-frame inference path
        results = self.accident_model.predict(
            source=frame,
            conf=self.accident_conf,
            iou=self.accident_iou,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
        )
        return self._parse_accident_boxes(results)

    def _detect_accidents_sahi(self, frame: np.ndarray) -> List[Dict[str, Any]]:
        H, W = frame.shape[:2]
        slice_sz = min(self.sahi_slice_size, min(H, W))
        step = max(64, int(slice_sz * (1.0 - self.sahi_overlap_ratio)))

        candidate_dets: List[Dict[str, Any]] = []

        # 1. Base full-frame pass
        full_res = self.accident_model.predict(
            source=frame,
            conf=self.accident_conf,
            iou=self.accident_iou,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
        )
        candidate_dets.extend(self._parse_accident_boxes(full_res))

        # 2. Grid slices
        y = 0
        while y < H:
            y_end = min(y + slice_sz, H)
            y_start = max(0, y_end - slice_sz)
            x = 0
            while x < W:
                x_end = min(x + slice_sz, W)
                x_start = max(0, x_end - slice_sz)
                tile = frame[y_start:y_end, x_start:x_end]

                res = self.accident_model.predict(
                    source=tile,
                    conf=self.accident_conf,
                    iou=self.accident_iou,
                    imgsz=slice_sz,
                    device=self.device,
                    verbose=False,
                )
                slice_dets = self._parse_accident_boxes(res, x_offset=float(x_start), y_offset=float(y_start))
                candidate_dets.extend(slice_dets)

                if x_end >= W:
                    break
                x += step
            if y_end >= H:
                break
            y += step

        if not candidate_dets:
            return []

        # 3. Merge slice overlapping detections with NMS
        boxes_xywh = []
        scores = []
        for d in candidate_dets:
            b = d["bbox"]
            boxes_xywh.append([int(b[0]), int(b[1]), int(b[2] - b[0]), int(b[3] - b[1])])
            scores.append(float(d["conf"]))

        indices = cv2.dnn.NMSBoxes(boxes_xywh, scores, score_threshold=0.0, nms_threshold=self.sahi_merge_iou)
        if len(indices) == 0:
            return []

        keep_indices = set(indices.flatten() if hasattr(indices, "flatten") else [indices[0]])
        return [candidate_dets[i] for i in keep_indices]
