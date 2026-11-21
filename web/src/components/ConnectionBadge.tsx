import React from "react";
import { useSessionStore } from "../store/useSessionStore";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

interface Props {
  device?: string;
}

export const ConnectionBadge: React.FC<Props> = ({ device = "auto" }) => {
  const { status, isMock } = useSessionStore();

  let badgeColor = "bg-slate-700/60 text-slate-300 border-slate-600";
  let dotColor = "bg-slate-400";
  let label = "Idle";
  let icon = <Activity className="w-3.5 h-3.5" />;

  if (isMock) {
    badgeColor = "bg-amber-950/40 text-amber-300 border-amber-600/50";
    dotColor = "bg-amber-400";
    label = "MOCK DATA";
    icon = <AlertTriangle className="w-3.5 h-3.5" />;
  } else if (status === "running") {
    badgeColor = "bg-emerald-950/40 text-emerald-300 border-emerald-600/50";
    dotColor = "bg-emerald-400 animate-pulse";
    label = "LIVE STREAM";
    icon = <CheckCircle2 className="w-3.5 h-3.5" />;
  } else if (status === "connecting" || status === "stopping") {
    badgeColor = "bg-blue-950/40 text-blue-300 border-blue-600/50";
    dotColor = "bg-blue-400 animate-ping";
    label = status === "connecting" ? "CONNECTING..." : "STOPPING...";
    icon = <RefreshCw className="w-3.5 h-3.5 animate-spin" />;
  } else if (status === "paused") {
    badgeColor = "bg-amber-950/40 text-amber-300 border-amber-600/50";
    dotColor = "bg-amber-400";
    label = "PAUSED";
  } else if (status === "error") {
    badgeColor = "bg-rose-950/40 text-rose-300 border-rose-600/50";
    dotColor = "bg-rose-400";
    label = "STREAM ERROR";
    icon = <AlertTriangle className="w-3.5 h-3.5" />;
  } else if (status === "finished") {
    badgeColor = "bg-slate-800 text-slate-300 border-slate-700";
    dotColor = "bg-slate-400";
    label = "COMPLETED";
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur font-medium ${badgeColor}`}
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        {icon}
        <span>{label}</span>
      </div>
      <div className="hidden sm:inline-flex items-center px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-400 font-mono text-[11px]">
        Device: <span className="ml-1 text-slate-200 uppercase font-semibold">{device}</span>
      </div>
    </div>
  );
};

