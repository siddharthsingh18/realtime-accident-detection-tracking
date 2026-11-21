import React, { useMemo } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { AlertCircle, Car, Cpu, Film } from "lucide-react";
import { FpsSparkline } from "./FpsSparkline";

export const KpiCards: React.FC = () => {
  const { telemetry, fpsHistory } = useSessionStore();

  // Smoothed FPS over last 10 received messages
  const smoothedFps = useMemo(() => {
    if (!fpsHistory || fpsHistory.length === 0) return null;
    const window = fpsHistory.slice(-10);
    const sum = window.reduce((a, b) => a + b, 0);
    return (sum / window.length).toFixed(1);
  }, [fpsHistory]);

  const confirmedCount = telemetry?.confirmed_accidents ?? null;
  const inFrame = telemetry?.vehicles_in_frame ?? null;
  const totalVehicles = telemetry?.vehicles_total_unique ?? null;
  const currentFrame = telemetry?.frame_idx ?? null;
  const totalFrames = telemetry?.total_frames ?? null;

  const progressPct =
    currentFrame !== null && totalFrames && totalFrames > 0
      ? Math.min(100, Math.round((currentFrame / totalFrames) * 100))
      : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. Confirmed Accidents */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur relative overflow-hidden">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
          <span>Confirmed Accidents</span>
          <AlertCircle
            className={`w-4 h-4 ${
              confirmedCount && confirmedCount > 0 ? "text-red-400" : "text-slate-500"
            }`}
          />
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl sm:text-3xl font-black font-mono ${
              confirmedCount === null
                ? "text-slate-500"
                : confirmedCount > 0
                ? "text-red-400"
                : "text-emerald-400"
            }`}
          >
            {confirmedCount !== null ? confirmedCount : "—"}
          </span>
          <span className="text-xs text-slate-400 font-medium">
            {confirmedCount === null
              ? "Inactive"
              : confirmedCount > 0
              ? "ACTIVE ZONES"
              : "Zero incidents"}
          </span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 truncate">
          {telemetry?.zones && telemetry.zones.length > 0
            ? `${telemetry.zones.length} zone(s) in persistence tracker`
            : "No active hazard zones"}
        </div>
      </div>

      {/* 2. Tracked Vehicles */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
          <span>Tracked Vehicles</span>
          <Car className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-black font-mono text-slate-100">
            {inFrame !== null ? inFrame : "—"}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            {totalVehicles !== null ? `(${totalVehicles} total)` : "in frame"}
          </span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          BoT-SORT motion tracking active
        </div>
      </div>

      {/* 3. Inference FPS */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
          <span>Inference FPS</span>
          <Cpu className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-black font-mono text-slate-100">
              {smoothedFps !== null ? smoothedFps : "—"}
            </span>
            <span className="text-xs text-slate-400">fps</span>
          </div>
          <div className="pt-1">
            <FpsSparkline data={fpsHistory} width={80} height={20} color="#38bdf8" />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 truncate">
          {telemetry?.fps ? `Raw: ${telemetry.fps.toFixed(1)} fps (10f avg)` : "Awaiting stream"}
        </div>
      </div>

      {/* 4. Frame Progress */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
          <span>Frame Progress</span>
          <Film className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-black font-mono text-slate-100">
            {currentFrame !== null ? currentFrame : "—"}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            {totalFrames ? `/ ${totalFrames}` : "frames"}
          </span>
        </div>
        {progressPct !== null ? (
          <div className="mt-2">
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[10px] text-slate-400 mt-1 text-right">{progressPct}%</div>
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-slate-400">
            {currentFrame !== null ? "Continuous live feed" : "Not running"}
          </div>
        )}
      </div>
    </div>
  );
};

