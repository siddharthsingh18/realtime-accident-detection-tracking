import React, { useState, useEffect } from "react";
import { perfMonitor, PerfMetrics } from "../../utils/perfMonitor";
import { Activity, X, Gauge, Cpu, Layers } from "lucide-react";

export const PerformanceOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("perf") === "true";
  });

  const [metrics, setMetrics] = useState<PerfMetrics>(perfMonitor.getMetrics());

  useEffect(() => {
    const unsub = perfMonitor.subscribe(setMetrics);
    return unsub;
  }, []);

  // Keyboard shortcut Ctrl+Shift+P or Cmd+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title="Open Performance Overlay (Ctrl+Shift+P)"
        className="fixed bottom-3 right-3 z-50 p-2 rounded-full bg-slate-900/90 border border-slate-700/80 text-emerald-400 hover:bg-slate-800 transition-all shadow-lg text-xs flex items-center gap-1.5 opacity-60 hover:opacity-100"
      >
        <Activity className="w-3.5 h-3.5" />
        <span className="font-mono text-[10px]">PERF</span>
      </button>
    );
  }

  return (
    <div
      role="region"
      aria-label="Performance Diagnostics"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl bg-slate-950/95 border border-emerald-500/40 p-4 shadow-2xl font-mono text-xs text-slate-200 select-none"
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <Activity className="w-4 h-4 animate-pulse" />
          <span>Dev Performance Monitor</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-white p-1 rounded"
          title="Close (Ctrl+Shift+P)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5">
        <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            AppShell Renders:
          </span>
          <span
            className={`font-bold ${
              metrics.appShellRendersPerSec > 5 ? "text-rose-400 animate-pulse" : "text-emerald-400"
            }`}
          >
            {metrics.appShellRendersPerSec}/s
          </span>
        </div>

        <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            VideoStage Renders:
          </span>
          <span className="font-bold text-slate-200">{metrics.videoStageRendersPerSec}/s</span>
        </div>

        <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-amber-400" />
            Video Canvas FPS:
          </span>
          <span className="font-bold text-cyan-300">{metrics.videoCanvasFps} fps</span>
        </div>

        <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            JS Time / Frame:
          </span>
          <span
            className={`font-bold ${
              metrics.jsTimePerFrameMs > 16.6 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {metrics.jsTimePerFrameMs} ms
          </span>
        </div>

        <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
          <span className="text-slate-400">Long Tasks (10s window):</span>
          <span
            className={`font-bold ${
              metrics.longTasksPer10Sec > 2 ? "text-rose-400" : "text-slate-300"
            }`}
          >
            {metrics.longTasksPer10Sec}
          </span>
        </div>

        {metrics.jsHeapSizeMB !== null && (
          <div className="flex justify-between items-center py-1 px-2 rounded bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400">JS Heap Used:</span>
            <span className="font-bold text-purple-400">{metrics.jsHeapSizeMB} MB</span>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between items-center">
        <span>Toggle: Ctrl+Shift+P</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
          }}
          className="hover:text-emerald-400 underline"
        >
          Copy JSON
        </button>
      </div>
    </div>
  );
};
