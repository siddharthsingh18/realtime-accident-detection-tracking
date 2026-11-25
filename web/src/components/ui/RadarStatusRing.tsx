import React from "react";
import { useSessionStore } from "../../store/useSessionStore";

export interface RadarStatusRingProps {
  status?: "normal" | "warning" | "critical" | "idle";
  children?: React.ReactNode;
  className?: string;
}

export const RadarStatusRing: React.FC<RadarStatusRingProps> = ({
  status = "normal",
  children,
  className = "",
}) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const allowMotion = effectsQuality !== "off";

  const ringColors = {
    normal: "border-emerald-500/40 text-emerald-400",
    warning: "border-amber-500/40 text-amber-400",
    critical: "border-rose-500/60 text-rose-400",
    idle: "border-slate-700/40 text-slate-400",
  }[status];

  return (
    <div className={`relative inline-flex items-center justify-center p-1 ${className}`}>
      {allowMotion && status !== "idle" && (
        <>
          {/* Outer sweeping radar ping ring */}
          <span
            className={`absolute inset-0 rounded-full border ${ringColors} animate-ping opacity-30`}
          />
          {/* Secondary rotating radar sweep ring */}
          <span
            className={`absolute -inset-1 rounded-full border border-dashed ${ringColors} opacity-40 animate-radar-sweep`}
          />
        </>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
};
