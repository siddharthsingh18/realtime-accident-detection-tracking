import React from "react";
import { ShieldCheck, AlertTriangle, AlertOctagon, Activity, Radio } from "lucide-react";
import { useSessionStore } from "../../store/useSessionStore";

export type StatusPillType = "normal" | "warning" | "critical" | "active" | "idle" | "online";

export interface StatusPillProps {
  status: StatusPillType;
  label?: string;
  size?: "sm" | "md";
  className?: string;
  pulse?: boolean;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  size = "md",
  className = "",
  pulse = false,
}) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const allowMotion = effectsQuality !== "off";

  const config = {
    normal: {
      bg: "bg-emerald-950/70 border-emerald-500/50 text-emerald-300",
      dot: "bg-emerald-400",
      halo: "calm-status-halo",
      Icon: ShieldCheck,
      defaultLabel: "Normal",
    },
    online: {
      bg: "bg-emerald-950/70 border-emerald-500/50 text-emerald-300",
      dot: "bg-emerald-400",
      halo: "calm-status-halo",
      Icon: ShieldCheck,
      defaultLabel: "Online",
    },
    active: {
      bg: "bg-cyan-950/70 border-cyan-500/50 text-cyan-300",
      dot: "bg-cyan-400 animate-pulse",
      halo: "shadow-[0_0_12px_rgba(0,240,255,0.4)]",
      Icon: Activity,
      defaultLabel: "Monitoring",
    },
    warning: {
      bg: "bg-amber-950/70 border-amber-500/50 text-amber-300",
      dot: "bg-amber-400",
      halo: "shadow-[0_0_12px_rgba(245,158,11,0.4)]",
      Icon: AlertTriangle,
      defaultLabel: "Warning",
    },
    critical: {
      bg: "bg-rose-950/80 border-rose-500/60 text-rose-300",
      dot: "bg-rose-500 animate-ping",
      halo: "shadow-[0_0_20px_rgba(239,68,68,0.6)]",
      Icon: AlertOctagon,
      defaultLabel: "Incident Alert",
    },
    idle: {
      bg: "bg-slate-900/80 border-slate-700/60 text-slate-400",
      dot: "bg-slate-500",
      halo: "",
      Icon: Radio,
      defaultLabel: "Standby",
    },
  };

  const current = config[status] || config.normal;
  const CurrentIcon = current.Icon;
  const sizeClasses =
    size === "sm"
      ? "px-2 py-0.5 text-[10px] gap-1"
      : "px-2.5 py-1 text-xs gap-1.5";

  return (
    <div
      className={`inline-flex items-center rounded-full font-mono font-bold tracking-wider uppercase border backdrop-blur-md transition-all duration-300 ${current.bg} ${
        allowMotion ? current.halo : ""
      } ${sizeClasses} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${current.dot} ${pulse ? "animate-pulse" : ""}`}
      />
      <CurrentIcon className="w-3.5 h-3.5" />
      <span>{label || current.defaultLabel}</span>
    </div>
  );
};
