"""
Road Accident Detection & Vehicle Tracking System.
Combines custom-trained accident detection and pretrained vehicle detection
with BoT-SORT multi-object tracking, spatial containment filtering, and accident persistence logic.
"""

__version__ = "2.1.0"

from .detector import DualDetector
from .tracker import VehicleTracker, TrackedVehicle
from .accident_logic import (
    AccidentZone,
    AccidentPersistenceManager,
    calculate_iou,
    calculate_containment,
    suppress_vehicles_in_accidents,
    detect_vehicle_collisions,
    VehicleCollisionDetector,
    resolve_fps,
    seconds_to_frames,
)
from .visualizer import Visualizer
from .calibration import HomographyCalibrator, load_camera_calibration
from .kinematics import (
    VehicleKinematicProfile,
    PairKinematicEvidence,
    CandidateMotionProfile,
    compute_vehicle_kinematics,
    compute_pair_kinematics,
    evaluate_kinematic_gate,
    evaluate_candidate_motion,
)

__all__ = [
    "DualDetector",
    "VehicleTracker",
    "TrackedVehicle",
    "AccidentZone",
    "AccidentPersistenceManager",
    "calculate_iou",
    "calculate_containment",
    "suppress_vehicles_in_accidents",
    "detect_vehicle_collisions",
    "VehicleCollisionDetector",
    "resolve_fps",
    "seconds_to_frames",
    "Visualizer",
    "HomographyCalibrator",
    "load_camera_calibration",
    "VehicleKinematicProfile",
    "PairKinematicEvidence",
    "CandidateMotionProfile",
    "compute_vehicle_kinematics",
    "compute_pair_kinematics",
    "evaluate_kinematic_gate",
    "evaluate_candidate_motion",
]
