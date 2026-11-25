import React from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { Film, Layers, Play } from "lucide-react";

interface Props {
  onStart: () => void;
}

export const SampleLauncher: React.FC<Props> = ({ onStart }) => {
  const { source, setSource, status } = useSessionStore(
    useShallow((s) => ({
      source: s.source,
      setSource: s.setSource,
      status: s.status,
    }))
  );
  const isRunning = status === "running" || status === "paused" || status === "connecting";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* Sample 1 Card */}
      <div
        onClick={() => {
          if (!isRunning) {
            setSource("sample1");
          }
        }}
        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
          source === "sample1"
            ? "bg-slate-800/90 border-emerald-500/80 shadow-md ring-1 ring-emerald-500/50"
            : "bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-400">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Sample 1: Direct Collision</div>
              <div className="text-xs text-slate-400">assets/sample_traffic.mp4</div>
            </div>
          </div>
          {source === "sample1" && !isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow transition"
              title="Launch Sample 1"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Dense intersection with two-vehicle crash. Triggers TENTATIVE → ACTIVE confirmation and speed deceleration metrics.
        </p>
      </div>

      {/* Sample 2 Card */}
      <div
        onClick={() => {
          if (!isRunning) {
            setSource("sample2");
          }
        }}
        className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
          source === "sample2"
            ? "bg-slate-800/90 border-emerald-500/80 shadow-md ring-1 ring-emerald-500/50"
            : "bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Sample 2: Multi-Car Incident</div>
              <div className="text-xs text-slate-400">assets/sample_traffic_2.mp4</div>
            </div>
          </div>
          {source === "sample2" && !isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStart();
              }}
              className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow transition"
              title="Launch Sample 2"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Multi-vehicle interaction with secondary obstruction and persistence state machine testing.
        </p>
      </div>
    </div>
  );
};

