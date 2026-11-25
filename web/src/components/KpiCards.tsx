import React, { useMemo } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { AlertCircle, Car, Cpu, Film } from "lucide-react";
import { FpsSparkline } from "./FpsSparkline";
import { GlassCard } from "./ui/GlassCard";
import { RadarStatusRing } from "./ui/RadarStatusRing";

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
      <GlassCard
        variant={confirmedCount && confirmedCount > 0 ? "critical" : "default"}
        glow={Boolean(confirmedCount && confirmedCount > 0)}
        className="p-4"
      >
        <div className="flex items-center justify-between text-slate-400 text-xs font-display font-bold uppercase tracking-wider mb-1">
          <span>Confirmed Accidents</span>
          {confirmedCount && confirmedCount > 0 ? (
            <RadarStatusRing status="critical">
              <AlertCircle className="w-4 h-4 text-rose-400" />
            </RadarStatusRing>
          ) : (
            <AlertCircle className="w-4 h-4 text-slate-500" />
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${
              confirmedCount === null
                ? "text-slate-500"
                : confirmedCount > 0
                ? "text-rose-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.6)] animate-pulse"
                : "text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]"
            }`}
          >
            {confirmedCount !== null ? confirmedCount : "—"}
          </span>
          <span className="text-xs text-slate-400 font-mono font-semibold">
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
      </GlassCard>

      {/* 2. Tracked Vehicles */}
      <GlassCard variant="cyan" className="p-4">
        <div className="flex items-center justify-between text-slate-400 text-xs font-display font-bold uppercase tracking-wider mb-1">
          <span>Tracked Vehicles</span>
          <Car className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-cyan-400 drop-shadow-[0_0_15px_rgba(0,240,255,0.4)]">
            {inFrame !== null ? inFrame : "—"}
          </span>
          <span className="text-xs text-slate-400 font-mono">
            {totalVehicles !== null ? `(${totalVehicles} total)` : "in frame"}
          </span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          BoT-SORT motion tracking active
        </div>
      </GlassCard>

      {/* 3. Inference FPS */}
      <GlassCard variant="warning" className="p-4">
        <div className="flex items-center justify-between text-slate-400 text-xs font-display font-bold uppercase tracking-wider mb-1">
          <span>Inference FPS</span>
          <Cpu className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.4)]">
              {smoothedFps !== null ? smoothedFps : "—"}
            </span>
            <span className="text-xs text-slate-400 font-mono">fps</span>
          </div>
          <div className="pt-1">
            <FpsSparkline data={fpsHistory} width={80} height={20} color="#00f0ff" />
          </div>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 truncate">
          {telemetry?.fps ? `Raw: ${telemetry.fps.toFixed(1)} fps (10f avg)` : "Awaiting stream"}
        </div>
      </GlassCard>

      {/* 4. Frame Progress */}
      <GlassCard variant="default" className="p-4">
        <div className="flex items-center justify-between text-slate-400 text-xs font-display font-bold uppercase tracking-wider mb-1">
          <span>Frame Progress</span>
          <Film className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-100">
            {currentFrame !== null ? currentFrame : "—"}
          </span>
          <span className="text-xs text-slate-400 font-mono font-semibold">
            {totalFrames ? `/ ${totalFrames}` : "frames"}
          </span>
        </div>
        {progressPct !== null ? (
          <div className="mt-2">
            <div className="w-full bg-slate-950/80 rounded-full h-1.5 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-600 h-1.5 rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(0,240,255,0.6)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-cyan-400 mt-1 text-right font-bold">{progressPct}%</div>
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-slate-400 font-mono">
            {currentFrame !== null ? "Continuous live feed" : "Not running"}
          </div>
        )}
      </GlassCard>
    </div>
  );
};
