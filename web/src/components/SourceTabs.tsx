import React from "react";
import { SourceType, useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { Upload, Camera, Film, Layers, PlaySquare } from "lucide-react";

interface TabItem {
  id: SourceType;
  label: string;
  badge?: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: "sample1", label: "Sample 1", badge: "Crash", icon: <Film className="w-4 h-4" /> },
  { id: "sample2", label: "Sample 2", badge: "Multi-Car", icon: <Layers className="w-4 h-4" /> },
  { id: "upload", label: "Upload Video", icon: <Upload className="w-4 h-4" /> },
  { id: "webcam", label: "Live Webcam", icon: <Camera className="w-4 h-4" /> },
  { id: "demos", label: "Demos Gallery", badge: "H.264", icon: <PlaySquare className="w-4 h-4" /> },
];

export const SourceTabs: React.FC = () => {
  const { source, setSource, status } = useSessionStore(
    useShallow((s) => ({
      source: s.source,
      setSource: s.setSource,
      status: s.status,
    }))
  );
  const isRunning = status === "running" || status === "paused";

  return (
    <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800 rounded-xl overflow-x-auto max-w-full">
      {TABS.map((tab) => {
        const isActive = source === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isRunning) {
                if (
                  !window.confirm(
                    "Switching sources will stop the active stream. Continue?"
                  )
                ) {
                  return;
                }
              }
              setSource(tab.id);
            }}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              isActive
                ? "bg-slate-800 text-white shadow-sm border border-slate-700"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                  tab.id === "sample1"
                    ? "bg-rose-950 text-rose-300 border border-rose-800"
                    : tab.id === "sample2"
                    ? "bg-amber-950 text-amber-300 border border-amber-800"
                    : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

