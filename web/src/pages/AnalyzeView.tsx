import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { api } from "../api/client";
import { StreamWebSocket } from "../api/websocket";
import { MOCK_TELEMETRY_SEQUENCE, createMockFrameBlob } from "../mock/mockData";
import { HealthResponse } from "../api/types";

import { ConnectionBadge } from "../components/ConnectionBadge";
import { AlertBanner } from "../components/AlertBanner";
import { Controls } from "../components/Controls";
import { SourceTabs } from "../components/SourceTabs";
import { UploadDropzone } from "../components/UploadDropzone";
import { WebcamPanel } from "../components/WebcamPanel";
import { SampleLauncher } from "../components/SampleLauncher";
import { EventLog } from "../components/EventLog";
import { VideoStage } from "../components/VideoStage";
import { Moon, Sun, Shield, Info, Sparkles, FileVideo, Activity } from "lucide-react";

export const AnalyzeView: React.FC = () => {
  const {
    status,
    source,
    uploadedFile,
    settings,
    isMock,
    theme,
    telemetry,
    setStatus,
    setSessionId,
    setTelemetry,
    setError,
    setIsMock,
    toggleTheme,
    resetSession,
  } = useSessionStore();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [latestFrame, setLatestFrame] = useState<Blob | null>(null);
  const wsRef = useRef<StreamWebSocket | null>(null);
  const mockTimerRef = useRef<NodeJS.Timeout | number | null>(null);

  // Fetch backend health on mount
  useEffect(() => {
    let isMounted = true;
    api
      .getHealth()
      .then((data) => {
        if (isMounted) setHealth(data);
      })
      .catch((err) => {
        console.warn("Backend /api/health unavailable (is server running?):", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Teardown WebSocket & mock timers on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current as number);
      }
    };
  }, []);

  // --- Real Backend Session ---
  const startRealSession = useCallback(async () => {
    try {
      setStatus("connecting");
      setError(null);

      if (source === "demos") {
        return;
      }

      // Validate upload file presence
      if (source === "upload" && !uploadedFile) {
        setError("Please choose a video file before starting.");
        return;
      }

      const res = await api.createSession(source, settings, uploadedFile || undefined);
      setSessionId(res.session_id);

      const streamWs = new StreamWebSocket(res.session_id, {
        onTelemetry: (msg) => {
          setTelemetry(msg);
        },
        onFrame: (blob) => {
          setLatestFrame(blob);
        },
        onStatus: (wsStatus, details) => {
          if (wsStatus === "connected") {
            setStatus("running");
          } else if (wsStatus === "disconnected") {
            if (details === "Session finished") {
              setStatus("finished");
            } else {
              setStatus("idle");
            }
          } else if (wsStatus === "error") {
            setError(details || "WebSocket connection failure");
          }
        },
      });

      wsRef.current = streamWs;
      streamWs.connect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to start session: ${msg}`);
      setStatus("error");
    }
  }, [source, settings, uploadedFile, setError, setSessionId, setStatus, setTelemetry]);

  // --- Mock Session Runner (for testing without server) ---
  const startMockSession = useCallback(() => {
    setStatus("running");
    setIsMock(true);
    let step = 0;

    const runStep = () => {
      if (step >= MOCK_TELEMETRY_SEQUENCE.length) {
        setStatus("finished");
        if (mockTimerRef.current) {
          clearInterval(mockTimerRef.current as number);
          mockTimerRef.current = null;
        }
        return;
      }

      const msg = MOCK_TELEMETRY_SEQUENCE[step];
      step++;
      setTelemetry(msg);

      const isAlert = msg.confirmed_accidents > 0;
      createMockFrameBlob(
        `Frame #${msg.frame_idx} (${msg.fps.toFixed(1)} fps)`,
        isAlert
      ).then((blob) => {
        setLatestFrame(blob);
      });
    };

    runStep();
    mockTimerRef.current = setInterval(runStep, 450);
  }, [setIsMock, setStatus, setTelemetry]);

  const handleStart = () => {
    if (useSessionStore.getState().isMock) {
      startMockSession();
    } else {
      startRealSession();
    }
  };

  const handleStop = () => {
    if (isMock) {
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current as number);
        mockTimerRef.current = null;
      }
      setStatus("idle");
    } else {
      if (wsRef.current) {
        wsRef.current.stop();
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("idle");
    }
  };

  const handlePause = () => {
    if (isMock) {
      if (mockTimerRef.current) {
        clearInterval(mockTimerRef.current as number);
        mockTimerRef.current = null;
      }
      setStatus("paused");
    } else {
      if (wsRef.current) {
        wsRef.current.pause();
      }
      setStatus("paused");
    }
  };

  const handleResume = () => {
    if (isMock) {
      startMockSession();
    } else {
      if (wsRef.current) {
        wsRef.current.resume();
      }
      setStatus("running");
    }
  };

  const handleReset = () => {
    resetSession();
    setLatestFrame(null);
  };

  const currentDevice = health?.device || "auto";

  return (
    <div
      className={`min-h-screen ${
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900"
      } transition-colors duration-200 flex flex-col font-sans`}
    >
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight">
                Road Accident Detection & Vehicle Tracking
              </h1>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Autonomous Vision Pipeline • BoT-SORT Motion Tracking • Dual YOLOv8 Verification
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ConnectionBadge device={currentDevice} />

            {/* Toggle Mock Mode button */}
            <button
              onClick={() => {
                if (status === "running" || status === "paused") {
                  handleStop();
                }
                setIsMock(!isMock);
              }}
              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
                isMock
                  ? "bg-amber-950 text-amber-300 border-amber-600"
                  : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
              }`}
              title="Toggle standalone mock mode"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Mock Mode</span>
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4 text-amber-300" />
              ) : (
                <Moon className="w-4 h-4 text-slate-600" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* Top Alert Banner */}
        <AlertBanner />

        {/* 2-Column Core Architecture: INPUT SECTION & OUTPUT SECTION */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ==================== 1. INPUT SECTION ==================== */}
          <section className="lg:col-span-5 flex flex-col gap-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur">
            {/* Section Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <FileVideo className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100 tracking-wide flex items-center gap-2">
                    <span>INPUT SECTION</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 uppercase font-semibold">
                      Source & Controls
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Select video feed and manage inference execution
                  </p>
                </div>
              </div>
            </div>

            {/* Step 1: Video Input Source Tabs */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                1. Select Input Source
              </label>
              <SourceTabs />
            </div>

            {/* Step 2: Source Setup / Upload Area */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                2. Input Feed Configuration
              </label>
              <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 min-h-[160px] flex flex-col justify-center">
                {source === "upload" && <UploadDropzone />}
                {(source === "sample1" || source === "sample2" || source === "demos") && (
                  <SampleLauncher onStart={handleStart} />
                )}
                {source === "webcam" && <WebcamPanel />}
              </div>
            </div>

            {/* Step 3: Execution Controls */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                3. Detection Execution
              </label>
              <div className="bg-slate-950/40 rounded-xl p-2.5 border border-slate-800/60 flex items-center justify-center">
                <Controls
                  onStart={handleStart}
                  onStop={handleStop}
                  onPause={handlePause}
                  onResume={handleResume}
                  onReset={handleReset}
                />
              </div>
            </div>
          </section>

          {/* ==================== 2. OUTPUT SECTION ==================== */}
          <section className="lg:col-span-7 flex flex-col gap-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur">
            {/* Section Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100 tracking-wide flex items-center gap-2">
                    <span>OUTPUT SECTION</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 uppercase font-semibold">
                      Real-Time Video
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Live annotated detections, vehicle tracking & incident telemetry
                  </p>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                <span
                  className={`w-2 h-2 rounded-full ${
                    status === "running"
                      ? "bg-emerald-400 animate-pulse"
                      : status === "paused"
                      ? "bg-amber-400"
                      : "bg-slate-500"
                  }`}
                />
                <span className="text-xs font-mono uppercase font-bold text-slate-300">
                  {status}
                </span>
              </div>
            </div>

            {/* Video Canvas Output Stage */}
            <div className="w-full">
              <VideoStage latestFrame={latestFrame} />
            </div>

            {/* Essential Real-Time Telemetry Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="text-[11px] text-slate-400 font-medium">Processing FPS</div>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {telemetry?.fps ? telemetry.fps.toFixed(1) : "—"}
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="text-[11px] text-slate-400 font-medium">Vehicles In Frame</div>
                <div className="text-xl font-bold font-mono text-cyan-400">
                  {telemetry?.vehicles_in_frame ?? "—"}
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="text-[11px] text-slate-400 font-medium">Total Tracked</div>
                <div className="text-xl font-bold font-mono text-indigo-400">
                  {telemetry?.vehicles_total_unique ?? "—"}
                </div>
              </div>
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <div className="text-[11px] text-slate-400 font-medium">Confirmed Accidents</div>
                <div
                  className={`text-xl font-bold font-mono ${
                    (telemetry?.confirmed_accidents ?? 0) > 0
                      ? "text-red-400 animate-pulse"
                      : "text-slate-400"
                  }`}
                >
                  {telemetry?.confirmed_accidents ?? "0"}
                </div>
              </div>
            </div>

            {/* Clean Incident Event Log */}
            <div className="w-full">
              <EventLog />
            </div>
          </section>
        </div>
      </main>

      {/* Footer Disclaimer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/50 py-4 px-4 sm:px-6 text-center text-xs text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Info className="w-3.5 h-3.5" />
            <span>
              Detections are automated and unverified; not for emergency dispatch.
            </span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Model: {health?.models.accident.arch || "YOLOv8s"} • BoT-SORT Tracker
          </div>
        </div>
      </footer>
    </div>
  );
};
