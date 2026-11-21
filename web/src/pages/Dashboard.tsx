import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { api } from "../api/client";
import { StreamWebSocket } from "../api/websocket";
import { MOCK_TELEMETRY_SEQUENCE, createMockFrameBlob } from "../mock/mockData";
import { HealthResponse } from "../api/types";

import { ConnectionBadge } from "../components/ConnectionBadge";
import { AlertBanner } from "../components/AlertBanner";
import { KpiCards } from "../components/KpiCards";
import { Controls } from "../components/Controls";
import { SourceTabs } from "../components/SourceTabs";
import { UploadDropzone } from "../components/UploadDropzone";
import { WebcamPanel } from "../components/WebcamPanel";
import { SampleLauncher } from "../components/SampleLauncher";
import { DemoGallery } from "../components/DemoGallery";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { EventLog } from "../components/EventLog";
import { VideoStage } from "../components/VideoStage";
import { Moon, Sun, Shield, Info, Sparkles } from "lucide-react";

export const Dashboard: React.FC = () => {
  const {
    status,
    source,
    uploadedFile,
    settings,
    isMock,
    theme,
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

  const handleLiveSettingsChange = (updated: Partial<typeof settings>) => {
    if (wsRef.current) {
      wsRef.current.updateSettings(updated);
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Top Alert Banner */}
        <AlertBanner />

        {/* Source Selector & Stream Controls Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-2 sm:p-2.5 rounded-2xl backdrop-blur">
          <SourceTabs />
          <Controls
            onStart={handleStart}
            onStop={handleStop}
            onPause={handlePause}
            onResume={handleResume}
            onReset={handleReset}
          />
        </div>

        {/* Source Config Area (shown based on active tab) */}
        {source === "upload" && <UploadDropzone />}
        {(source === "sample1" || source === "sample2") && (
          <SampleLauncher onStart={handleStart} />
        )}
        {source === "webcam" && <WebcamPanel />}
        {source === "demos" && <DemoGallery />}

        {/* Standard Video Stream Layout (for non-demo sources) */}
        {source !== "demos" && (
          <>
            {/* KPI Cards Row */}
            <KpiCards />

            {/* Video Canvas & Side Panels Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
              {/* Left / Center: Video Stage (2 Cols) */}
              <div className="lg:col-span-2 space-y-4">
                <VideoStage latestFrame={latestFrame} />
              </div>

              {/* Right: Sidebar Controls & Incident Event Log (1 Col) */}
              <div className="space-y-4 sm:space-y-6">
                <EventLog />
                <SettingsSidebar
                  onLiveSettingsChange={handleLiveSettingsChange}
                  availableDevice={currentDevice}
                />
              </div>
            </div>
          </>
        )}
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
