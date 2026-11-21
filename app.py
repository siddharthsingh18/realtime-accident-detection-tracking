"""
Streamlit Web Dashboard for Real-Time Road Accident Detection & Vehicle Tracking.

Features:
- Prominent Input Section directly on main page (Upload, Webcam, Sample Videos, Pre-rendered Demos).
- Live AI inference with confirmation state machine (TENTATIVE -> ACTIVE -> MAINTAINED -> removed).
- Gated kinematic vehicle-collision heuristic (deceleration/convergence, anti-queue filter).
- Real-time KPI metrics dashboard (Active Accidents, Vehicles, FPS, Frame Progress).
- Video download options and full parameter tuning via sidebar.
"""

import os
import sys
import time
import tempfile
import cv2
import yaml
import numpy as np
import streamlit as st

# Add workspace to path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from src import (
    DualDetector,
    VehicleTracker,
    AccidentPersistenceManager,
    VehicleCollisionDetector,
    suppress_vehicles_in_accidents,
    resolve_fps,
    seconds_to_frames,
    Visualizer,
)

# Page configuration
st.set_page_config(
    page_title="AI Road Accident Detection & Tracking",
    page_icon="🚨",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for styling
st.markdown(
    """
    <style>
    .main-title {
        font-size: 2.2rem;
        font-weight: 700;
        margin-bottom: 0.2rem;
        color: #FFFFFF;
    }
    .sub-title {
        font-size: 1.05rem;
        color: #A0AEC0;
        margin-bottom: 1.5rem;
    }
    .input-box {
        background-color: #1E293B;
        border-radius: 10px;
        padding: 20px;
        border: 2px solid #3B82F6;
        margin-bottom: 1.5rem;
    }
    .alert-banner-danger {
        background: linear-gradient(90deg, #dc2626 0%, #991b1b 100%);
        color: white;
        padding: 14px 20px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 1.15rem;
        text-align: center;
        letter-spacing: 1px;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
        margin-bottom: 1rem;
    }
    .alert-banner-safe {
        background: linear-gradient(90deg, #059669 0%, #047857 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 1.05rem;
        text-align: center;
        letter-spacing: 0.5px;
        margin-bottom: 1rem;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data
def load_config(config_path: str = "config.yaml") -> dict:
    if not os.path.exists(config_path):
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@st.cache_resource
def load_detector(
    accident_weights: str,
    vehicle_weights: str,
    accident_conf: float,
    vehicle_conf: float,
    accident_iou: float,
    vehicle_iou: float,
    device: str,
):
    dev = None if device == "auto" else device
    return DualDetector(
        accident_weights=accident_weights,
        vehicle_weights=vehicle_weights,
        accident_conf=accident_conf,
        vehicle_conf=vehicle_conf,
        accident_iou=accident_iou,
        vehicle_iou=vehicle_iou,
        device=dev,
    )


def run_live_inference(
    video_source,
    source_name,
    accident_conf,
    vehicle_conf,
    containment_thresh,
    persistence_seconds,
    confirm_seconds,
    tentative_grace_seconds,
    use_collision_heuristic,
    device_opt,
):
    st.markdown(f"**Target Input:** `{source_name}`")

    # Start / Stop buttons
    col_ctrl1, col_ctrl2, _ = st.columns([1, 1, 3])
    with col_ctrl1:
        start_btn = st.button("▶️ Start Live AI Detection", type="primary", use_container_width=True)
    with col_ctrl2:
        stop_btn = st.button("⏹️ Stop Detection", use_container_width=True)

    if "running" not in st.session_state:
        st.session_state.running = False

    if start_btn:
        st.session_state.running = True
    if stop_btn:
        st.session_state.running = False

    alert_placeholder = st.empty()
    m_col1, m_col2, m_col3, m_col4 = st.columns(4)
    kpi_accidents = m_col1.empty()
    kpi_vehicles = m_col2.empty()
    kpi_fps = m_col3.empty()
    kpi_progress = m_col4.empty()

    video_placeholder = st.empty()

    if st.session_state.running:
        cap = cv2.VideoCapture(video_source)
        if not cap.isOpened():
            st.error(f"Could not open video input source: {video_source}")
            st.session_state.running = False
            return

        raw_fps = cap.get(cv2.CAP_PROP_FPS)
        fps = resolve_fps(raw_fps)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        persistence_frames = seconds_to_frames(persistence_seconds, fps)
        confirm_hits = seconds_to_frames(confirm_seconds, fps)
        tentative_grace = seconds_to_frames(tentative_grace_seconds, fps)
        confirm_window = max(confirm_hits + 3, 8)

        with st.spinner("Initializing Dual YOLO Models & Confirmation State Machine..."):
            detector = load_detector(
                accident_weights="models/accident_yolo11s.pt",
                vehicle_weights="models/yolo11n.pt",
                accident_conf=accident_conf,
                vehicle_conf=vehicle_conf,
                accident_iou=0.45,
                vehicle_iou=0.50,
                device=device_opt,
            )

            tracker = VehicleTracker(
                vehicle_model=detector.vehicle_model,
                tracker_type="botsort.yaml",
                conf=vehicle_conf,
                iou=0.50,
                device=detector.device,
                max_history=30,
            )

            persistence_mgr = AccidentPersistenceManager(
                persistence_frames=persistence_frames,
                iou_match_threshold=0.30,
                smoothing_alpha=0.70,
                confirm_hits=confirm_hits,
                confirm_window=confirm_window,
                tentative_grace=tentative_grace,
            )

            collision_detector = VehicleCollisionDetector(fps=fps)

            visualizer = Visualizer(
                show_tracking_ids=True,
                show_confidence=True,
                show_alert_banner=True,
                show_hud_stats=True,
                suppress_vehicle_labels=True,
                line_thickness=2,
            )

        frame_idx = 0
        unique_ids = set()
        start_time = time.time()

        try:
            while cap.isOpened() and st.session_state.running:
                ret, frame = cap.read()
                if not ret:
                    break

                t0 = time.time()

                # 1. Track Vehicles with BoT-SORT
                tracked_vehicles = tracker.update(frame)
                for v in tracked_vehicles:
                    unique_ids.add(v.track_id)

                # 2. Detect Accidents with Custom YOLO Detector
                raw_accidents = detector.detect_accidents(frame)

                # 3. Detect Inter-Vehicle Collisions (gated kinematics)
                if use_collision_heuristic:
                    collisions = collision_detector.detect(tracked_vehicles, fps=fps)
                else:
                    collisions = []
                all_candidates = raw_accidents + collisions

                # 4. Confirmation State Machine (returns ACTIVE and MAINTAINED zones only)
                confirmed_accidents = persistence_mgr.update(all_candidates)

                # 5. Visual suppression on confirmed zones
                if confirmed_accidents:
                    tracked_vehicles, confirmed_accidents = suppress_vehicles_in_accidents(
                        vehicles=tracked_vehicles,
                        accident_zones=confirmed_accidents,
                        containment_threshold=containment_thresh,
                        iou_threshold=0.30,
                    )

                dt = time.time() - t0
                proc_fps = 1.0 / dt if dt > 0 else fps

                # Render OpenCV annotations
                annotated_frame = visualizer.render(
                    frame=frame,
                    vehicles=tracked_vehicles,
                    accident_zones=confirmed_accidents,
                    fps=proc_fps,
                    frame_idx=frame_idx,
                )

                # Update Alert Banner
                if len(confirmed_accidents) > 0:
                    alert_placeholder.markdown(
                        f'<div class="alert-banner-danger">🚨 EMERGENCY ALERT: CONFIRMED ACCIDENT DETECTED ({len(confirmed_accidents)} ZONE)</div>',
                        unsafe_allow_html=True,
                    )
                else:
                    alert_placeholder.markdown(
                        '<div class="alert-banner-safe">✅ TRAFFIC STATUS: NORMAL FLOW (NO INCIDENTS)</div>',
                        unsafe_allow_html=True,
                    )

                # Update KPIs (suppressed vehicles remain counted in tracked_vehicles)
                kpi_accidents.metric("🚨 Confirmed Accidents", f"{len(confirmed_accidents)}")
                kpi_vehicles.metric("🚗 Tracked Vehicles", f"{len(tracked_vehicles)} ({len(unique_ids)} Total)")
                kpi_fps.metric("⚡ Inference FPS", f"{proc_fps:.1f}")
                if total_frames > 0:
                    kpi_progress.metric("⏱️ Frame Progress", f"{frame_idx + 1} / {total_frames}")
                else:
                    kpi_progress.metric("⏱️ Frame", f"{frame_idx + 1}")

                # Convert to RGB for Streamlit display
                rgb_frame = cv2.cvtColor(annotated_frame, cv2.COLOR_BGR2RGB)
                video_placeholder.image(rgb_frame, channels="RGB", use_container_width=True)

                frame_idx += 1

        finally:
            cap.release()
            st.session_state.running = False
            total_time = time.time() - start_time
            st.success(
                f"✅ Processing completed: {frame_idx} frames in {total_time:.1f}s ({frame_idx / total_time:.1f} FPS avg). Total unique vehicles: {len(unique_ids)}"
            )


def main():
    cfg = load_config()

    # Header section
    if os.path.exists("assets/banner.png"):
        st.image("assets/banner.png", use_container_width=True)

    st.markdown('<div class="main-title">🚨 Real-Time Road Accident Detection & Vehicle Tracking</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-title">Hardened Dual-Model Architecture with <b>Confirmation State Machine</b> and <b>Kinematic Collision Gating</b>.</div>',
        unsafe_allow_html=True,
    )

    # Sidebar settings
    st.sidebar.header("🎯 Model & Tuning Settings")
    accident_conf = st.sidebar.slider("Accident Confidence Threshold", 0.10, 0.95, 0.40, 0.05)
    vehicle_conf = st.sidebar.slider("Vehicle Confidence Threshold", 0.10, 0.95, 0.35, 0.05)
    containment_thresh = st.sidebar.slider("Spatial Containment Ratio", 0.20, 0.90, 0.50, 0.05)

    st.sidebar.markdown("---")
    st.sidebar.subheader("⏱️ Time-Based Confirmation & Memory")
    confirm_seconds = st.sidebar.slider("Confirmation Time Window (s)", 0.05, 0.50, 0.17, 0.02, help="Detection must be sustained to confirm ACTIVE")
    persistence_seconds = st.sidebar.slider("Persistence Memory Timeout (s)", 0.10, 2.00, 0.50, 0.05, help="Time to hold box across temporary loss")
    tentative_grace_seconds = st.sidebar.slider("Tentative Grace Timeout (s)", 0.03, 0.30, 0.07, 0.01, help="Grace period before dropping unconfirmed zone")

    st.sidebar.markdown("---")
    use_collision_heuristic = st.sidebar.checkbox("Enable Kinematic Collision Heuristic", value=True)
    device_opt = st.sidebar.selectbox("Compute Device", options=["auto", "cpu", "mps", "cuda"], index=0)

    # =========================================================================
    # PROMINENT MAIN PAGE INPUT SECTION
    # =========================================================================
    st.markdown("### 📥 Select Video Input Source")

    tab_upload, tab_webcam, tab_scen1, tab_scen2, tab_prerender = st.tabs([
        "📁 Upload Your Video",
        "📹 Live Webcam",
        "⚡ Sample Video 1 (Collision Dynamics)",
        "⚡ Sample Video 2 (Multi-Car Incident)",
        "📺 View Pre-Rendered Demos",
    ])

    # 1. Upload Video Tab
    with tab_upload:
        st.markdown("#### 📂 Upload a Video File for AI Analysis")
        uploaded_file = st.file_uploader(
            "Choose a video file (.mp4, .avi, .mov, .mkv)",
            type=["mp4", "avi", "mov", "mkv"],
            key="custom_video_uploader",
        )
        if uploaded_file is not None:
            tfile = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
            tfile.write(uploaded_file.read())
            run_live_inference(
                video_source=tfile.name,
                source_name=uploaded_file.name,
                accident_conf=accident_conf,
                vehicle_conf=vehicle_conf,
                containment_thresh=containment_thresh,
                persistence_seconds=persistence_seconds,
                confirm_seconds=confirm_seconds,
                tentative_grace_seconds=tentative_grace_seconds,
                use_collision_heuristic=use_collision_heuristic,
                device_opt=device_opt,
            )
        else:
            st.info("👆 Drop or browse an MP4 / AVI / MOV video here to run detection.")

    # 2. Live Webcam Tab
    with tab_webcam:
        st.markdown("#### 📹 Connect to Live Camera Feed")
        st.caption("Note: Opens local camera device index connected to the host system.")
        cam_index = st.number_input("Camera Device Index (Default: 0)", min_value=0, max_value=5, value=0, step=1)
        run_live_inference(
            video_source=int(cam_index),
            source_name=f"Webcam (Camera Index {cam_index})",
            accident_conf=accident_conf,
            vehicle_conf=vehicle_conf,
            containment_thresh=containment_thresh,
            persistence_seconds=persistence_seconds,
            confirm_seconds=confirm_seconds,
            tentative_grace_seconds=tentative_grace_seconds,
            use_collision_heuristic=use_collision_heuristic,
            device_opt=device_opt,
        )

    # 3. Sample Scenario 1 Tab
    with tab_scen1:
        st.markdown("#### ⚡ Live Inference on Sample Scenario 1 (`assets/sample_traffic.mp4`)")
        st.caption("A 720p HD clip featuring high-speed vehicle collision dynamics.")
        run_live_inference(
            video_source="assets/sample_traffic.mp4",
            source_name="Sample Scenario 1 (sample_traffic.mp4)",
            accident_conf=accident_conf,
            vehicle_conf=vehicle_conf,
            containment_thresh=containment_thresh,
            persistence_seconds=persistence_seconds,
            confirm_seconds=confirm_seconds,
            tentative_grace_seconds=tentative_grace_seconds,
            use_collision_heuristic=use_collision_heuristic,
            device_opt=device_opt,
        )

    # 4. Sample Scenario 2 Tab
    with tab_scen2:
        st.markdown("#### ⚡ Live Inference on Sample Scenario 2 (`assets/sample_traffic_2.mp4`)")
        st.caption("A multi-vehicle traffic collision and tracking surveillance scenario.")
        run_live_inference(
            video_source="assets/sample_traffic_2.mp4",
            source_name="Sample Scenario 2 (sample_traffic_2.mp4)",
            accident_conf=accident_conf,
            vehicle_conf=vehicle_conf,
            containment_thresh=containment_thresh,
            persistence_seconds=persistence_seconds,
            confirm_seconds=confirm_seconds,
            tentative_grace_seconds=tentative_grace_seconds,
            use_collision_heuristic=use_collision_heuristic,
            device_opt=device_opt,
        )

    # 5. Pre-rendered Demos Tab
    with tab_prerender:
        st.markdown("#### 📺 Instant Playback of Processed Results")
        selected_demo = st.radio(
            "Choose Scenario Demo",
            options=["Scenario 1 (Collision Dynamics)", "Scenario 2 (Multi-Car Incident)"],
            horizontal=True,
        )

        if "Scenario 1" in selected_demo:
            video_path = "outputs/output_scenario1.mp4"
            if os.path.exists(video_path):
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.video(video_path)
                with col2:
                    st.markdown("### 📊 Scenario 1 Stats")
                    st.metric("Total Frames", "356")
                    st.metric("Resolution", "1280 × 720 HD")
                    st.metric("Vehicles Tracked", "10")
                    st.metric("Accident Frames", "265")
                    with open(video_path, "rb") as f:
                        st.download_button(
                            label="⬇️ Download Scenario 1 MP4",
                            data=f,
                            file_name="accident_scenario_1.mp4",
                            mime="video/mp4",
                            use_container_width=True,
                        )
            else:
                st.warning("Pre-rendered Scenario 1 video not found.")

        else:
            video_path = "outputs/output_scenario2.mp4"
            if os.path.exists(video_path):
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.video(video_path)
                with col2:
                    st.markdown("### 📊 Scenario 2 Stats")
                    st.metric("Total Frames", "518")
                    st.metric("Resolution", "1280 × 720 HD")
                    st.metric("Vehicles Tracked", "30")
                    st.metric("Accident Frames", "733")
                    with open(video_path, "rb") as f:
                        st.download_button(
                            label="⬇️ Download Scenario 2 MP4",
                            data=f,
                            file_name="accident_scenario_2.mp4",
                            mime="video/mp4",
                            use_container_width=True,
                        )
            else:
                st.warning("Pre-rendered Scenario 2 video not found.")


if __name__ == "__main__":
    main()
