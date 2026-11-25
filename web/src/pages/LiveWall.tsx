import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { StreamWebSocket } from "../api/websocket";
import { api } from "../api/client";
import { CameraItem, TelemetryMessage } from "../api/types";
import { MOCK_TELEMETRY_SEQUENCE, createMockFrameBlob } from "../mock/mockData";
import {
  Grid2X2,
  Square,
  LayoutGrid,
  ArrowUpDown,
  Car,
  Cpu,
  ChevronRight,
  AlertOctagon,
  Play,
  Pause,
  Monitor,
} from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";
import { VideoHudOverlay } from "../components/ui/VideoHudOverlay";

export const LiveWall: React.FC = () => {
  const navigate = useNavigate();
  const {
    wallLayout,
    setWallLayout,
    tileCameras,
    setActiveCameraId,
    cameraTelemetry,
    isMock,
  } = useSessionStore(
    useShallow((s) => ({
      wallLayout: s.wallLayout,
      setWallLayout: s.setWallLayout,
      tileCameras: s.tileCameras,
      setActiveCameraId: s.setActiveCameraId,
      cameraTelemetry: s.cameraTelemetry,
      isMock: s.isMock,
    }))
  );

  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [alertsFirst, setAlertsFirst] = useState(true);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number>(0);
  const [maxActiveFeeds, setMaxActiveFeeds] = useState<number>(2);
  const [pausedFeeds, setPausedFeeds] = useState<Record<string, boolean>>({});

  const togglePauseFeed = (camId: string) => {
    setPausedFeeds((prev) => ({ ...prev, [camId]: !prev[camId] }));
  };

  // Load cameras list
  useEffect(() => {
    api
      .getCameras()
      .then((cams) => {
        if (cams.length > 0) setCameras(cams);
      })
      .catch((e) => console.warn("Failed to load cameras for Live Wall:", e));
  }, []);

  // Keyboard navigation for Live Wall
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      if (e.key === "1") setWallLayout("1");
      else if (e.key === "2") setWallLayout("2");
      else if (e.key === "4") setWallLayout("4");
      else if (e.key === "Enter") {
        const camId = tileCameras[selectedTileIndex];
        if (camId) {
          setActiveCameraId(camId);
          navigate(`/camera/${camId}`);
        }
      } else if (e.key === "ArrowRight") {
        setSelectedTileIndex((i) => (i + 1) % tileCameras.length);
      } else if (e.key === "ArrowLeft") {
        setSelectedTileIndex((i) => (i - 1 + tileCameras.length) % tileCameras.length);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTileIndex, tileCameras, setWallLayout, setActiveCameraId, navigate]);

  // Order displayed cameras based on "Alerts First" sort toggle
  const displayedCameras = [...tileCameras]
    .slice(0, wallLayout === "1" ? 1 : wallLayout === "2" ? 2 : 4)
    .sort((a, b) => {
      if (!alertsFirst) return 0;
      const telA = cameraTelemetry[a];
      const telB = cameraTelemetry[b];
      const alertA = telA && telA.confirmed_accidents > 0 ? 1 : 0;
      const alertB = telB && telB.confirmed_accidents > 0 ? 1 : 0;
      return alertB - alertA;
    });

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Wall Header & Layout Bar */}
      <GlassCard variant="cyan" glow={true} className="p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Monitor className="w-5 h-5 text-cyan-400" />
              <h2 className="text-sm sm:text-base font-extrabold font-display tracking-wider uppercase text-slate-100">
                SURVEILLANCE GRID WALL
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Multi-camera tactical surveillance. Double-click or press Enter to isolate camera.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Alerts First Toggle */}
            <button
              onClick={() => setAlertsFirst(!alertsFirst)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-display uppercase tracking-wider font-semibold flex items-center gap-1.5 transition ${
                alertsFirst
                  ? "bg-rose-950/80 text-rose-300 border-rose-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                  : "bg-slate-900/80 text-slate-400 border-slate-700 hover:text-white"
              }`}
              title="Float cameras with active confirmed alerts to the top"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Priority Sort: {alertsFirst ? "ALERTS" : "DEFAULT"}</span>
            </button>

            {/* Max Active Feeds Limit Selector */}
            <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-mono">
              <span className="text-[10px] text-slate-400 font-bold px-1 uppercase">Concurrency:</span>
              {[1, 2, 4].map((num) => (
                <button
                  key={num}
                  onClick={() => setMaxActiveFeeds(num)}
                  className={`px-2 py-0.5 rounded-lg font-bold text-xs transition ${
                    maxActiveFeeds === num
                      ? "bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title={`Limit to ${num} active concurrent stream${num > 1 ? "s" : ""}`}
                >
                  {num}
                </button>
              ))}
            </div>

            {/* Layout Grid Buttons */}
            <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setWallLayout("1")}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  wallLayout === "1" ? "bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]" : "text-slate-400 hover:text-white"
                }`}
                title="Single Camera View (1)"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setWallLayout("2")}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  wallLayout === "2" ? "bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]" : "text-slate-400 hover:text-white"
                }`}
                title="Dual Camera View (2)"
              >
                <Grid2X2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setWallLayout("4")}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  wallLayout === "4" ? "bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]" : "text-slate-400 hover:text-white"
                }`}
                title="Quad Grid View (4)"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Camera Grid Tiles */}
      <div
        className={`grid gap-4 ${
          wallLayout === "1"
            ? "grid-cols-1"
            : wallLayout === "2"
            ? "grid-cols-1 lg:grid-cols-2"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4"
        }`}
      >
        {(() => {
          let activeRunningCount = 0;
          return displayedCameras.map((camId, idx) => {
            const cam = cameras.find((c) => c.id === camId);
            const name = cam?.name || `Camera ${idx + 1} (${camId})`;
            const telemetry = cameraTelemetry[camId] || null;
            const isConfirmedAlert = telemetry && telemetry.confirmed_accidents > 0;
            const isMaintained = telemetry && telemetry.zones?.some((z) => z.status === "MAINTAINED");
            const isSelected = idx === selectedTileIndex;

            const explicitlyPaused = Boolean(pausedFeeds[camId]);
            let isPaused = explicitlyPaused;
            if (!explicitlyPaused) {
              if (activeRunningCount < maxActiveFeeds) {
                activeRunningCount++;
                isPaused = false;
              } else {
                isPaused = true;
              }
            }

            return (
              <CameraTile
                key={camId}
                cameraId={camId}
                name={name}
                isSelected={isSelected}
                isConfirmedAlert={isConfirmedAlert}
                isMaintained={isMaintained}
                telemetry={telemetry}
                isMock={isMock}
                isPaused={isPaused}
                onTogglePause={() => togglePauseFeed(camId)}
                onClick={() => setSelectedTileIndex(idx)}
                onDoubleClick={() => {
                  setActiveCameraId(camId);
                  navigate(`/camera/${camId}`);
                }}
              />
            );
          });
        })()}
      </div>
    </div>
  );
};

// Subcomponent for each live camera tile
interface TileProps {
  cameraId: string;
  name: string;
  isSelected: boolean;
  isConfirmedAlert: boolean;
  isMaintained: boolean;
  telemetry: TelemetryMessage | null;
  isMock: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onClick: () => void;
  onDoubleClick: () => void;
}

const CameraTile: React.FC<TileProps> = ({
  cameraId,
  name,
  isSelected,
  isConfirmedAlert,
  isMaintained,
  telemetry,
  isMock,
  isPaused,
  onTogglePause,
  onClick,
  onDoubleClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [latestFrame, setLatestFrame] = useState<Blob | null>(null);
  const setCameraTelemetry = useSessionStore((s) => s.setCameraTelemetry);
  const setCameraStatus = useSessionStore((s) => s.setCameraStatus);

  // Run mock or real loop for this tile
  useEffect(() => {
    if (isPaused) {
      setCameraStatus(cameraId, "paused");
      return;
    }

    let ws: StreamWebSocket | null = null;
    let mockInterval: any = null;

    if (isMock) {
      let step = 0;
      mockInterval = setInterval(async () => {
        const msg = MOCK_TELEMETRY_SEQUENCE[step % MOCK_TELEMETRY_SEQUENCE.length];
        setCameraTelemetry(cameraId, msg);
        setCameraStatus(cameraId, "running");
        const blob = await createMockFrameBlob(
          `${name} [Frame #${msg.frame_idx}]`,
          msg.confirmed_accidents > 0
        );
        setLatestFrame(blob);
        step++;
      }, 500);
    } else {
      // Create session on real backend
      api
        .createSession("sample1", undefined, undefined, cameraId)
        .then((res) => {
          ws = new StreamWebSocket(res.session_id, {
            onTelemetry: (msg) => {
              setCameraTelemetry(cameraId, msg);
              setCameraStatus(cameraId, "running");
            },
            onFrame: (blob) => setLatestFrame(blob),
            onStatus: (st) => setCameraStatus(cameraId, st as any),
          });
          ws.connect();
        })
        .catch((e) => console.warn(`Could not start stream for tile ${cameraId}:`, e));
    }

    return () => {
      if (ws) ws.close();
      if (mockInterval) clearInterval(mockInterval);
    };
  }, [cameraId, name, isMock, isPaused, setCameraTelemetry, setCameraStatus]);

  // Draw bitmap on canvas
  useEffect(() => {
    if (!latestFrame || !canvasRef.current) return;
    let cancelled = false;

    createImageBitmap(latestFrame)
      .then((bmp) => {
        if (cancelled) {
          bmp.close();
          return;
        }
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
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [latestFrame]);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`group relative rounded-2xl overflow-hidden bg-slate-900 border transition-all duration-300 cursor-pointer flex flex-col justify-between shadow-xl ${
        isSelected ? "ring-2 ring-emerald-500" : ""
      } ${
        isConfirmedAlert
          ? "border-red-500 shadow-red-950/50 animate-pulse-glow"
          : isMaintained
          ? "border-amber-500/80 shadow-amber-950/40"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      {/* Tile Header */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 truncate">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isConfirmedAlert
                ? "bg-red-500 animate-ping"
                : isMaintained
                ? "bg-amber-400"
                : "bg-emerald-400"
            }`}
          />
          <span className="text-xs font-bold text-slate-100 truncate">{name}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Pause / Resume Feed Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePause();
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition ${
              isPaused
                ? "bg-amber-950/80 text-amber-300 border border-amber-600 hover:bg-amber-900"
                : "bg-slate-800 text-slate-300 border border-slate-700 hover:text-white"
            }`}
            title={isPaused ? "Resume video stream" : "Pause feed to reduce concurrency and CPU"}
          >
            {isPaused ? <Play className="w-2.5 h-2.5 fill-current" /> : <Pause className="w-2.5 h-2.5" />}
            <span>{isPaused ? "Resume" : "Pause"}</span>
          </button>

          {isConfirmedAlert && (
            <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-red-950 text-red-300 border border-red-800 flex items-center gap-1">
              <AlertOctagon className="w-3 h-3 text-red-400" />
              <span>CRASH</span>
            </span>
          )}
          <span className="text-[10px] font-mono text-slate-400 uppercase">
            {cameraId}
          </span>
        </div>
      </div>

      {/* Video Feed Stage */}
      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full object-contain" />
        <VideoHudOverlay cameraId={cameraId} fps={telemetry?.fps} isAlert={isConfirmedAlert} />
        {!latestFrame && !isPaused && (
          <div className="text-[11px] text-slate-500 font-mono">
            Connecting stream...
          </div>
        )}

        {/* Paused Feed Standby Overlay */}
        {isPaused && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10">
            <Pause className="w-6 h-6 text-amber-400" />
            <span className="text-xs font-semibold text-slate-300">Feed Standby / Paused</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePause();
              }}
              className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs shadow-md transition cursor-pointer"
            >
              Resume Feed
            </button>
          </div>
        )}

        {/* Floating Quick Action Overlay on hover */}
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDoubleClick();
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg flex items-center gap-1"
          >
            <span>Focus Camera</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tile Mini KPI Strip */}
      <div className="p-2.5 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-1">
          <Car className="w-3.5 h-3.5 text-blue-400" />
          <span>{telemetry?.vehicles_in_frame ?? "—"} vehicles</span>
        </div>
        <div className="flex items-center gap-1">
          <Cpu className="w-3.5 h-3.5 text-amber-400" />
          <span>{telemetry?.fps ? `${telemetry.fps.toFixed(1)} fps` : "—"}</span>
        </div>
      </div>
    </div>
  );
};
