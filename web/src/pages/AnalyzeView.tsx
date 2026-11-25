import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { StreamWebSocket } from "../api/websocket";
import { MOCK_TELEMETRY_SEQUENCE, createMockFrameBlob } from "../mock/mockData";
import { HealthResponse } from "../api/types";

import { AlertBanner } from "../components/AlertBanner";
import { Controls } from "../components/Controls";
import { SourceTabs } from "../components/SourceTabs";
import { UploadDropzone } from "../components/UploadDropzone";
import { WebcamPanel } from "../components/WebcamPanel";
import { SampleLauncher } from "../components/SampleLauncher";
import { EventLog } from "../components/EventLog";
import { VideoStage } from "../components/VideoStage";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { MetricTile } from "../components/ui/MetricTile";
import { StatusPill } from "../components/ui/StatusPill";
import { FileVideo, Activity, Cpu } from "lucide-react";

const HeroTrafficScene = lazy(() => import("../components/3d/HeroTrafficScene"));

export const AnalyzeView: React.FC = () => {
  const {
    status,
    source,
    uploadedFile,
    settings,
    isMock,
    telemetry,
    setStatus,
    setSessionId,
    setTelemetry,
    setError,
    setIsMock,
    resetSession,
  } = useSessionStore(
    useShallow((s) => ({
      status: s.status,
      source: s.source,
      uploadedFile: s.uploadedFile,
      settings: s.settings,
      isMock: s.isMock,
      telemetry: s.telemetry,
      setStatus: s.setStatus,
      setSessionId: s.setSessionId,
      setTelemetry: s.setTelemetry,
      setError: s.setError,
      setIsMock: s.setIsMock,
      resetSession: s.resetSession,
    }))
  );

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

  // --- Mock Session Runner ---
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

  const isConfirmedAlert = (telemetry?.confirmed_accidents ?? 0) > 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner Alert */}
      <AlertBanner />

      {/* 3D Mission Control Hero Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8">
          <Suspense
            fallback={
              <div className="h-44 rounded-2xl bg-slate-900/60 border border-slate-800 skeleton-shimmer flex items-center justify-center text-xs text-slate-500 font-mono">
                Initializing 3D Spatial Sensor Feed...
              </div>
            }
          >
            <HeroTrafficScene className="h-48 sm:h-52 w-full" />
          </Suspense>
        </div>

        <div className="lg:col-span-4 flex flex-col justify-between gap-3">
          <GlassCard variant="cyan" glow={true} className="p-4 flex-1 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-widest text-cyan-400 font-bold">
                COMMAND NODE STATUS
              </span>
              <StatusPill
                status={isConfirmedAlert ? "critical" : status === "running" ? "active" : "idle"}
                label={isConfirmedAlert ? "INCIDENT DETECTED" : status === "running" ? "STREAM LIVE" : status.toUpperCase()}
                size="sm"
              />
            </div>

            <div className="my-2">
              <div className="text-xs text-slate-400 font-display">ACTIVE PIPELINE ACCELERATOR</div>
              <div className="text-base font-bold font-mono text-slate-100 flex items-center gap-1.5 mt-0.5">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <span>{health?.models.accident.arch || "YOLOv8s"} Dual Engine ({health?.device || "auto"})</span>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span>TRACKER: BoT-SORT</span>
              <span>CALIBRATION: ACTIVE</span>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* 2-Column Core Architecture: INPUT SECTION & OUTPUT SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ==================== 1. INPUT SECTION ==================== */}
        <section className="lg:col-span-5">
          <GlassCard variant="default" className="p-5 flex flex-col gap-5">
            <SectionHeader
              title="INPUT SECTION"
              badge="FEED SOURCE"
              subtitle="Select input channel & execute neural inference"
              icon={<FileVideo className="w-5 h-5 text-cyan-400" />}
            />

            {/* Step 1: Video Input Source Tabs */}
            <div className="space-y-2">
              <label className="text-xs font-display font-bold uppercase tracking-wider text-slate-300 block">
                1. Select Input Source
              </label>
              <SourceTabs />
            </div>

            {/* Step 2: Source Setup / Upload Area */}
            <div className="space-y-2">
              <label className="text-xs font-display font-bold uppercase tracking-wider text-slate-300 block">
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
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <label className="text-xs font-display font-bold uppercase tracking-wider text-slate-300 block">
                3. Inference Pipeline Control
              </label>
              <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/70 flex items-center justify-center">
                <Controls
                  onStart={handleStart}
                  onStop={handleStop}
                  onPause={handlePause}
                  onResume={handleResume}
                  onReset={handleReset}
                />
              </div>
            </div>
          </GlassCard>
        </section>

        {/* ==================== 2. OUTPUT SECTION ==================== */}
        <section className="lg:col-span-7">
          <GlassCard
            variant={isConfirmedAlert ? "critical" : "default"}
            glow={isConfirmedAlert}
            className="p-5 flex flex-col gap-5"
          >
            <SectionHeader
              title="OUTPUT SECTION"
              badge={isConfirmedAlert ? "ALERT ENGAGED" : "LIVE HUD"}
              subtitle="Annotated video stream, vehicle tracking & spatial hazard alerts"
              icon={<Activity className={`w-5 h-5 ${isConfirmedAlert ? "text-rose-400" : "text-cyan-400"}`} />}
              action={
                <StatusPill
                  status={isConfirmedAlert ? "critical" : status === "running" ? "active" : "idle"}
                  label={status.toUpperCase()}
                  size="sm"
                />
              }
            />

            {/* Video Canvas Output Stage with Cyberpunk HUD */}
            <div className="w-full">
              <VideoStage latestFrame={latestFrame} />
            </div>

            {/* Essential Real-Time Telemetry Counters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricTile
                label="FPS"
                value={telemetry?.fps ? Number(telemetry.fps.toFixed(1)) : "—"}
                variant="cyan"
              />
              <MetricTile
                label="In Frame"
                value={telemetry?.vehicles_in_frame ?? "—"}
                variant="default"
              />
              <MetricTile
                label="Tracked"
                value={telemetry?.vehicles_total_unique ?? "—"}
                variant="default"
              />
              <MetricTile
                label="Accidents"
                value={telemetry?.confirmed_accidents ?? 0}
                variant={isConfirmedAlert ? "critical" : "default"}
              />
            </div>

            {/* Clean Incident Event Log */}
            <div className="w-full">
              <EventLog />
            </div>
          </GlassCard>
        </section>
      </div>
    </div>
  );
};
