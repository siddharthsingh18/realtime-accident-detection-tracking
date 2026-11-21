import React from "react";
import { TelemetryEvent, ZoneTelemetry } from "../api/types";

interface Props {
  totalFramesInBuffer: number;
  currentScrubIndex: number | null; // null means LIVE
  memoryUsageMB: number;
  events: TelemetryEvent[];
  zones: ZoneTelemetry[];
  isLive: boolean;
  onSeek: (frameIndex: number | null) => void;
}

export const TimelineScrubber: React.FC<Props> = ({
  totalFramesInBuffer,
  currentScrubIndex,
  memoryUsageMB,
  events,
  zones,
  isLive,
  onSeek,
}) => {
  const maxIdx = Math.max(0, totalFramesInBuffer - 1);
  const activeValue = currentScrubIndex !== null ? currentScrubIndex : maxIdx;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 backdrop-blur space-y-2 shadow-lg">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSeek(null)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase transition flex items-center gap-1.5 ${
              isLive
                ? "bg-emerald-600 text-white shadow-emerald-950/40"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? "bg-white animate-pulse" : "bg-slate-500"
              }`}
            />
            <span>LIVE</span>
          </button>

          {!isLive && (
            <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
              SCRUBBING BUFFER: #{activeValue}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
          <span>Buffer: {totalFramesInBuffer} frames</span>
          <span>•</span>
          <span>RAM: {memoryUsageMB} MB / 60 MB</span>
        </div>
      </div>

      {/* Scrub Range Slider with Heat Strip and Markers */}
      <div className="relative pt-1 pb-1">
        {/* Heat strip background */}
        <div className="absolute top-2 left-0 right-0 h-2 rounded bg-slate-800 overflow-hidden pointer-events-none">
          {zones && zones.length > 0 && (
            <div className="w-full h-full bg-red-900/40" />
          )}
        </div>

        {/* Event Pin Markers */}
        <div className="absolute top-0 left-0 right-0 h-4 pointer-events-none z-10">
          {events.map((ev, i) => {
            // Rough mapping of event frame to relative width %
            const pct = Math.min(100, Math.max(0, (i / Math.max(1, events.length)) * 100));
            return (
              <div
                key={i}
                style={{ left: `${pct}%` }}
                className={`absolute top-0 w-2 h-2 rounded-full transform -translate-x-1/2 ${
                  ev.type === "confirmed" ? "bg-red-500 shadow-md shadow-red-500" : "bg-emerald-400"
                }`}
                title={`${ev.type} at ${ev.timestamp_ms}ms`}
              />
            );
          })}
        </div>

        <input
          type="range"
          min={0}
          max={maxIdx}
          value={activeValue}
          disabled={totalFramesInBuffer <= 1}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            onSeek(val >= maxIdx ? null : val);
          }}
          className="relative z-20 w-full h-2 bg-transparent appearance-none cursor-pointer accent-emerald-500 disabled:opacity-30"
        />
      </div>

      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
        <span>-60s (Oldest Buffered)</span>
        <span>Drag scrubber to pause & inspect historical frames</span>
        <span>Now (Latest)</span>
      </div>
    </div>
  );
};
