import React, { useEffect, useState } from "react";
import { GlassCard } from "./GlassCard";
import { useSessionStore } from "../../store/useSessionStore";

export interface MetricTileProps {
  label: string;
  value: number | string;
  unit?: string;
  change?: string;
  subtext?: string;
  trend?: "up" | "down" | "neutral";
  variant?: "cyan" | "critical" | "warning" | "success" | "default";
  icon?: React.ReactNode;
  sparkline?: number[];
  className?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  unit,
  change,
  subtext,
  trend,
  variant = "default",
  icon,
  sparkline,
  className = "",
}) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const [displayValue, setDisplayValue] = useState<number | string>(value);

  // Smooth counter animation for numeric values
  useEffect(() => {
    if (typeof value === "number" && effectsQuality !== "off") {
      let current = typeof displayValue === "number" ? displayValue : 0;
      const target = value;
      const diff = target - current;
      if (Math.abs(diff) < 0.05) {
        setDisplayValue(target);
        return;
      }
      const step = diff / 6;
      const interval = setInterval(() => {
        current += step;
        if ((diff > 0 && current >= target) || (diff < 0 && current <= target)) {
          setDisplayValue(target);
          clearInterval(interval);
        } else {
          setDisplayValue(Math.round(current * 10) / 10);
        }
      }, 30);
      return () => clearInterval(interval);
    } else {
      setDisplayValue(value);
    }
  }, [value, effectsQuality]);

  const valueColors = {
    cyan: "text-cyan-400 drop-shadow-[0_0_12px_rgba(0,240,255,0.4)]",
    critical: "text-rose-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]",
    warning: "text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.4)]",
    success: "text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]",
    default: "text-slate-100",
  }[variant];

  return (
    <GlassCard variant={variant} glow={variant === "critical" || variant === "cyan"} className={`p-4 flex flex-col justify-between ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 font-display">
          {label}
        </span>
        {icon && <span className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-300">{icon}</span>}
      </div>

      <div className="my-2 flex items-baseline gap-1.5">
        <span className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${valueColors}`}>
          {typeof displayValue === "number" && Number.isInteger(displayValue)
            ? displayValue
            : typeof displayValue === "number"
            ? displayValue.toFixed(1)
            : displayValue}
        </span>
        {unit && <span className="text-xs font-mono text-slate-400 font-semibold">{unit}</span>}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]">
        {(change || subtext) && (
          <span
            className={`font-mono font-medium ${
              trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-slate-400"
            }`}
          >
            {change || subtext}
          </span>
        )}

        {sparkline && sparkline.length > 1 && (
          <div className="flex items-end gap-0.5 h-3 ml-auto opacity-70">
            {sparkline.map((val, idx) => {
              const max = Math.max(...sparkline, 1);
              const heightPercent = Math.min(100, Math.max(15, (val / max) * 100));
              return (
                <div
                  key={idx}
                  style={{ height: `${heightPercent}%` }}
                  className={`w-1 rounded-sm ${variant === "critical" ? "bg-rose-400" : "bg-cyan-400"}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </GlassCard>
  );
};
