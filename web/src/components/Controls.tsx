import React, { useEffect, useCallback } from "react";
import { Play, Square, Pause, RotateCcw } from "lucide-react";
import { useSessionStore } from "../store/useSessionStore";

interface Props {
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset?: () => void;
}

export const Controls: React.FC<Props> = ({
  onStart,
  onStop,
  onPause,
  onResume,
  onReset,
}) => {
  const { status, source } = useSessionStore();

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isConnecting = status === "connecting";
  const isStopping = status === "stopping";
  const isFinished = status === "finished";

  const canStart = status === "idle" || isFinished || status === "error";
  const canStop = isRunning || isPaused;
  const canPause = isRunning;
  const canResume = isPaused;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger shortcuts if focus is in an input or select
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "SELECT" ||
          activeEl.tagName === "TEXTAREA")
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (canPause) onPause();
        else if (canResume) onResume();
      } else if (e.code === "Escape") {
        e.preventDefault();
        if (canStop) onStop();
      }
    },
    [canPause, canResume, canStop, onPause, onResume, onStop]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (source === "demos") {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {canStart && (
        <button
          onClick={onStart}
          disabled={!canStart}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>Start Stream</span>
        </button>
      )}

      {isConnecting && (
        <button
          disabled
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm bg-blue-600/60 text-white opacity-75 cursor-not-allowed"
        >
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Connecting...</span>
        </button>
      )}

      {isRunning && (
        <button
          onClick={onPause}
          disabled={!canPause}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold text-sm bg-amber-600 hover:bg-amber-500 text-white shadow transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400"
          title="Pause stream (Space)"
        >
          <Pause className="w-4 h-4" />
          <span>Pause</span>
        </button>
      )}

      {isPaused && (
        <button
          onClick={onResume}
          disabled={!canResume}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400"
          title="Resume stream (Space)"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>Resume</span>
        </button>
      )}

      {canStop && (
        <button
          onClick={onStop}
          disabled={!canStop}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold text-sm bg-rose-600 hover:bg-rose-500 text-white shadow transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-400"
          title="Stop pipeline (Esc)"
        >
          <Square className="w-4 h-4 fill-white" />
          <span>Stop</span>
        </button>
      )}

      {isStopping && (
        <button
          disabled
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold text-sm bg-rose-900/50 text-rose-200 cursor-not-allowed"
        >
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Stopping...</span>
        </button>
      )}

      {isFinished && onReset && (
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-medium text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset Session</span>
        </button>
      )}
    </div>
  );
};

