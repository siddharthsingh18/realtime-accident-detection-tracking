import React from "react";
import { useSessionStore } from "../../store/useSessionStore";

export interface VideoHudOverlayProps {
  cameraId?: string;
  fps?: number;
  isAlert?: boolean;
  hasAccident?: boolean;
  activeTracks?: number;
}

export const VideoHudOverlay: React.FC<VideoHudOverlayProps> = ({
  cameraId = "CAM_01",
  fps,
  isAlert = false,
  hasAccident = false,
  activeTracks,
}) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const allowEffects = effectsQuality !== "off";

  const effectiveAlert = isAlert || hasAccident;
  const borderColor = effectiveAlert
    ? "border-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]"
    : "border-cyan-400 shadow-[0_0_10px_rgba(0,240,255,0.4)]";

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden select-none">
      {/* 4 Animated Corner HUD Brackets */}
      <div
        className={`absolute top-2 left-2 w-5 h-5 border-t-2 border-l-2 ${borderColor} transition-colors duration-300`}
      />
      <div
        className={`absolute top-2 right-2 w-5 h-5 border-t-2 border-r-2 ${borderColor} transition-colors duration-300`}
      />
      <div
        className={`absolute bottom-2 left-2 w-5 h-5 border-b-2 border-l-2 ${borderColor} transition-colors duration-300`}
      />
      <div
        className={`absolute bottom-2 right-2 w-5 h-5 border-b-2 border-r-2 ${borderColor} transition-colors duration-300`}
      />

      {/* Top Header Bar HUD Data */}
      <div className="absolute top-2.5 left-8 right-8 flex items-center justify-between text-[10px] font-mono font-bold tracking-widest text-slate-300/80">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${effectiveAlert ? "bg-rose-500 animate-ping" : "bg-emerald-400"}`} />
          <span className={effectiveAlert ? "text-rose-400" : "text-cyan-400"}>
            FEED: {cameraId.toUpperCase()}
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <span>AI PIPELINE: DUAL-YOLO11</span>
          {activeTracks !== undefined && <span>TRACKS: {activeTracks}</span>}
          {fps !== undefined && <span>{fps.toFixed(1)} FPS</span>}
        </div>
      </div>

      {/* Scanline Crosshair Overlay in Center */}
      {allowEffects && (
        <div className="absolute inset-0 flex items-center justify-center opacity-15">
          <div className="w-16 h-16 border border-cyan-400 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-cyan-400 rounded-full" />
          </div>
        </div>
      )}

      {/* Red Critical Border Pulse */}
      {effectiveAlert && (
        <div className="absolute inset-0 border-2 border-rose-500 animate-pulse" />
      )}
    </div>
  );
};
