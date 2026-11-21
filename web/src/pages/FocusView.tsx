import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { api } from "../api/client";
import { StreamWebSocket } from "../api/websocket";
import { ClientFrameRingBuffer } from "../utils/frameBuffer";
import { MOCK_TELEMETRY_SEQUENCE, createMockFrameBlob } from "../mock/mockData";

import { VectorOverlayCanvas } from "../components/VectorOverlayCanvas";
import { TimelineScrubber } from "../components/TimelineScrubber";
import { InspectorPopover } from "../components/InspectorPopover";
import { AlertBanner } from "../components/AlertBanner";
import { KpiCards } from "../components/KpiCards";
import { Controls } from "../components/Controls";
import { SourceTabs } from "../components/SourceTabs";
import { UploadDropzone } from "../components/UploadDropzone";
import { WebcamPanel } from "../components/WebcamPanel";
import { DemoGallery } from "../components/DemoGallery";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { EventLog } from "../components/EventLog";

import {
  Activity,
  Layers,
  Sliders,
  ListFilter,
  Camera,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

export const FocusView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const cameraId = id || "cam_01";

  const {
    status,
    source,
    uploadedFile,
    settings,
    isMock,
    telemetry,
    error,
    setStatus,
    setSessionId,
    setTelemetry,
    setError,
    setActiveCameraId,
    toggleOverlay,
    showZoneBoxes,
    showVehicleBoxes,
    showMotionTrails,
    showGhostOutlines,
    showSpeedVectors,
  } = useSessionStore();

  const [activeTab, setActiveTab] = useState<"telemetry" | "zones" | "tuning" | "events">("telemetry");
  const [latestFrame, setLatestFrame] = useState<Blob | null>(null);
  const [hoverTarget, setHoverTarget] = useState<any>(null);
  const [cameraProfileSaved, setCameraProfileSaved] = useState(false);

  // Scrubber ring buffer
  const ringBufferRef = useRef(new ClientFrameRingBuffer(60));
  const [bufferCount, setBufferCount] = useState(0);
  const [memoryMB, setMemoryMB] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 800, h: 450 });

  const wsRef = useRef<StreamWebSocket | null>(null);
  const mockTimerRef = useRef<any>(null);

  useEffect(() => {
    setActiveCameraId(cameraId);
  }, [cameraId, setActiveCameraId]);

  // Track container sizing
  useEffect(() => {
    const updateSize = () => {
      if (stageContainerRef.current) {
        setStageSize({
          w: stageContainerRef.current.clientWidth,
          h: stageContainerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Frame processing and ring buffering
  const handleFrameArrived = useCallback((blob: Blob, frameIdx: number, timestampMs: number) => {
    ringBufferRef.current.push(frameIdx, timestampMs, blob);
    setBufferCount(ringBufferRef.current.getCount());
    setMemoryMB(ringBufferRef.current.getMemoryUsageMB());

    // Only update displayed canvas if in LIVE mode
    if (scrubIndex === null) {
      setLatestFrame(blob);
    }
  }, [scrubIndex]);

  // Real session runner
  const startRealSession = useCallback(async () => {
    try {
      if (source === "demos") return;
      if (source === "upload" && !uploadedFile) {
        setError("Please choose or drag & drop a video file first (.mp4, .avi, .mov, .mkv).");
        setStatus("idle");
        return;
      }
      setStatus("connecting");
      setError(null);
      const res = await api.createSession(source as any, settings, uploadedFile || undefined, cameraId);
      setSessionId(res.session_id);

      const streamWs = new StreamWebSocket(res.session_id, {
        onTelemetry: (msg) => {
          if (msg.finished) {
            setTelemetry({
              ...msg,
              confirmed_accidents:
                msg.confirmed_accidents > 0
                  ? msg.confirmed_accidents
                  : (telemetry?.confirmed_accidents ?? 0),
              zones:
                msg.zones && msg.zones.length > 0
                  ? msg.zones
                  : (telemetry?.zones ?? []),
              tracks:
                msg.tracks && msg.tracks.length > 0
                  ? msg.tracks
                  : (telemetry?.tracks ?? []),
            });
          } else {
            setTelemetry(msg);
          }
        },
        onFrame: (blob) => {
          handleFrameArrived(blob, telemetry?.frame_idx || 0, Date.now());
        },
        onStatus: (wsStatus) => {
          if (wsStatus === "connected") setStatus("running");
          else if (wsStatus === "disconnected") setStatus("finished");
          else if (wsStatus === "error") {
            setError("Stream connection failed. Server might be busy.");
            setStatus("idle");
          }
        },
      });

      wsRef.current = streamWs;
      streamWs.connect();
    } catch (err: any) {
      setError(err.message || "Failed to start session");
      setStatus("idle");
    }
  }, [source, settings, uploadedFile, cameraId, telemetry, setStatus, setError, setSessionId, setTelemetry, handleFrameArrived]);

  // Mock session runner
  const startMockSession = useCallback(() => {
    setStatus("running");
    let step = 0;

    const runStep = async () => {
      if (step >= MOCK_TELEMETRY_SEQUENCE.length) {
        setStatus("finished");
        clearInterval(mockTimerRef.current);
        return;
      }
      const msg = MOCK_TELEMETRY_SEQUENCE[step];
      setTelemetry(msg);
      const blob = await createMockFrameBlob(
        `Focus View: ${cameraId} [Frame #${msg.frame_idx}]`,
        msg.confirmed_accidents > 0
      );
      handleFrameArrived(blob, msg.frame_idx, msg.timestamp_ms);
      step++;
    };

    runStep();
    mockTimerRef.current = setInterval(runStep, 450);
  }, [cameraId, setStatus, setTelemetry, handleFrameArrived]);

  const handleStart = () => {
    if (isMock) startMockSession();
    else startRealSession();
  };

  const handleStop = () => {
    if (isMock && mockTimerRef.current) clearInterval(mockTimerRef.current);
    if (wsRef.current) {
      wsRef.current.stop();
      wsRef.current.close();
    }
    setStatus("idle");
  };

  // Draw frame on canvas
  useEffect(() => {
    if (!latestFrame || !canvasRef.current) return;
    createImageBitmap(latestFrame).then((bmp) => {
      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(bmp, 0, 0);
      }
      bmp.close();
    });
  }, [latestFrame]);

  // Handle scrubber seek
  const handleScrubSeek = (frameIdx: number | null) => {
    setScrubIndex(frameIdx);
    if (frameIdx === null) {
      // Return to LIVE
      const frames = ringBufferRef.current.getFrames();
      if (frames.length > 0) {
        setLatestFrame(frames[frames.length - 1].blob);
      }
    } else {
      const frameItem = ringBufferRef.current.getFrame(frameIdx);
      if (frameItem) {
        setLatestFrame(frameItem.blob);
      }
    }
  };

  const handleSaveProfile = async () => {
    try {
      await api.updateCamera(cameraId, {
        settings_profile: settings,
      });
      setCameraProfileSaved(true);
      setTimeout(() => setCameraProfileSaved(false), 3000);
    } catch (e) {
      console.warn("Failed to save camera profile:", e);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Banner */}
      <AlertBanner />

      {/* Control Strip & Vector Layer Toggles */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-3 rounded-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-emerald-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold uppercase tracking-wide flex items-center gap-2">
              <span>{cameraId} Focus Console</span>
              {!cameraProfileSaved && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                  Untuned Defaults
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              Stationary CCTV Surveillance Stage with Sub-frame Vector Overlay
            </div>
          </div>
        </div>

        {/* Vector Overlay Layer Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            onClick={() => toggleOverlay("showZoneBoxes")}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
              showZoneBoxes ? "bg-red-950 text-red-300 border-red-800" : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            Zones: {showZoneBoxes ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => toggleOverlay("showVehicleBoxes")}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
              showVehicleBoxes ? "bg-blue-950 text-blue-300 border-blue-800" : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            Vehicles: {showVehicleBoxes ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => toggleOverlay("showMotionTrails")}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
              showMotionTrails ? "bg-sky-950 text-sky-300 border-sky-800" : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            Trails: {showMotionTrails ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => toggleOverlay("showGhostOutlines")}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
              showGhostOutlines ? "bg-rose-950 text-rose-300 border-rose-800" : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            Ghosts: {showGhostOutlines ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => toggleOverlay("showSpeedVectors")}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
              showSpeedVectors ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-slate-800 text-slate-500 border-slate-700"
            }`}
          >
            Vectors: {showSpeedVectors ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <KpiCards />

      {/* Main Focus Grid: Stage (2 cols) vs Tabs (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        {/* Left: Large Video Stage + Scrubber */}
        <div className="lg:col-span-2 space-y-4">
          <div
            ref={stageContainerRef}
            className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center group"
          >
            {/* Raw Video Canvas */}
            <canvas ref={canvasRef} className="w-full h-full object-contain" />

            {/* Sub-frame Vector Overlay Canvas */}
            <VectorOverlayCanvas
              telemetry={telemetry}
              width={stageSize.w}
              height={stageSize.h}
              onHoverTarget={(t) => setHoverTarget(t)}
            />

            {/* Hover Inspector Popover */}
            <InspectorPopover target={hoverTarget} />

            {/* Status Overlays */}
            {status === "idle" && !latestFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs font-mono">
                Stage Inactive. Press Start Stream below.
              </div>
            )}
          </div>

          {/* Timeline Scrubber */}
          <TimelineScrubber
            totalFramesInBuffer={bufferCount}
            currentScrubIndex={scrubIndex}
            memoryUsageMB={memoryMB}
            events={telemetry?.events || []}
            zones={telemetry?.zones || []}
            isLive={scrubIndex === null}
            onSeek={handleScrubSeek}
          />

          {/* Controls & Source Selection Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-2.5 rounded-xl">
            <SourceTabs />
            <Controls
              onStart={handleStart}
              onStop={handleStop}
              onPause={() => wsRef.current?.pause()}
              onResume={() => wsRef.current?.resume()}
            />
          </div>

          {/* Active Error Banner */}
          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-700 text-rose-200 text-xs rounded-xl flex items-center justify-between shadow-lg animate-fade-in">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-rose-400 hover:text-white text-xs font-semibold px-2 py-0.5 rounded bg-rose-900/50 hover:bg-rose-900"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Source Specific Configuration Area */}
          {source === "upload" && (
            <div className="p-3.5 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-xl">
              <UploadDropzone />
            </div>
          )}
          {source === "webcam" && (
            <div className="p-3.5 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-xl">
              <WebcamPanel />
            </div>
          )}
          {source === "demos" && (
            <div className="p-3.5 bg-slate-900/70 border border-slate-800 rounded-2xl shadow-xl">
              <DemoGallery />
            </div>
          )}
        </div>

        {/* Right: Side Panel Tabs */}
        <div className="space-y-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl backdrop-blur">
          {/* Tab Selector */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab("telemetry")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition flex items-center justify-center gap-1 ${
                activeTab === "telemetry" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Timing</span>
            </button>
            <button
              onClick={() => setActiveTab("zones")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition flex items-center justify-center gap-1 ${
                activeTab === "zones" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Zones ({telemetry?.zones?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab("tuning")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition flex items-center justify-center gap-1 ${
                activeTab === "tuning" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Tuning</span>
            </button>
            <button
              onClick={() => setActiveTab("events")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition flex items-center justify-center gap-1 ${
                activeTab === "events" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Events</span>
            </button>
          </div>

          {/* Tab 1: Inference Breakdown Stacked Bar */}
          {activeTab === "telemetry" && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Inference Latency Breakdown
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Accident YOLO:</span>
                    <span className="font-mono text-white">{telemetry?.inference_ms?.accident ?? 0} ms</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-red-500 h-1.5" style={{ width: `${Math.min(100, (telemetry?.inference_ms?.accident || 0) * 1.5)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Vehicle YOLO:</span>
                    <span className="font-mono text-white">{telemetry?.inference_ms?.vehicle ?? 0} ms</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-blue-500 h-1.5" style={{ width: `${Math.min(100, (telemetry?.inference_ms?.vehicle || 0) * 1.5)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>BoT-SORT Tracker:</span>
                    <span className="font-mono text-white">{telemetry?.inference_ms?.tracking ?? 0} ms</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-sky-400 h-1.5" style={{ width: `${Math.min(100, (telemetry?.inference_ms?.tracking || 0) * 2)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>State Machine & Kinematics:</span>
                    <span className="font-mono text-white">{telemetry?.inference_ms?.logic ?? 0} ms</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-amber-400 h-1.5" style={{ width: `${Math.min(100, (telemetry?.inference_ms?.logic || 0) * 3)}%` }} />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 flex justify-between font-mono font-bold text-xs">
                  <span>Total End-to-End:</span>
                  <span className="text-emerald-400">{telemetry?.inference_ms?.total ?? 0} ms</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Zone List */}
          {activeTab === "zones" && (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Active Hazard Zones
              </div>
              {(!telemetry?.zones || telemetry.zones.length === 0) ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  Zero active accident zones. Road clear.
                </div>
              ) : (
                telemetry.zones.map((z) => (
                  <div key={z.zone_id} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-red-400">Zone #{z.zone_id}</span>
                      <span className="font-mono text-[10px] uppercase font-bold text-slate-300">
                        {z.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex justify-between font-mono">
                      <span>Origin: {z.origin}</span>
                      <span>Conf: {(z.conf * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 3: Tuning & Save Profile */}
          {activeTab === "tuning" && (
            <div className="space-y-4">
              <SettingsSidebar
                onLiveSettingsChange={(updated) => wsRef.current?.updateSettings(updated)}
              />
              <button
                onClick={handleSaveProfile}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs shadow transition flex items-center justify-center gap-1.5"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Save as Camera Profile</span>
              </button>
              {cameraProfileSaved && (
                <div className="text-[11px] text-emerald-400 text-center font-bold">
                  ✓ Profile saved for {cameraId}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Events Log */}
          {activeTab === "events" && <EventLog />}
        </div>
      </div>
    </div>
  );
};
