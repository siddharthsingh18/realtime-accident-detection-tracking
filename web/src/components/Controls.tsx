import React, { useEffect, useCallback } from "react";
import { Play, Square, Pause, RotateCcw } from "lucide-react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { GlowButton } from "./ui/GlowButton";

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
  const { status, source } = useSessionStore(
    useShallow((s) => ({
      status: s.status,
      source: s.source,
    }))
  );

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
        <GlowButton
          onClick={onStart}
          disabled={!canStart}
          variant="primary"
          icon={<Play className="w-4 h-4 fill-current" />}
        >
          Start Stream
        </GlowButton>
      )}

      {isConnecting && (
        <GlowButton
          disabled
          variant="secondary"
          icon={<span className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />}
        >
          Connecting...
        </GlowButton>
      )}

      {isRunning && (
        <GlowButton
          onClick={onPause}
          disabled={!canPause}
          variant="warning"
          icon={<Pause className="w-4 h-4" />}
          title="Pause stream (Space)"
        >
          Pause
        </GlowButton>
      )}

      {isPaused && (
        <GlowButton
          onClick={onResume}
          disabled={!canResume}
          variant="primary"
          icon={<Play className="w-4 h-4 fill-current" />}
          title="Resume stream (Space)"
        >
          Resume
        </GlowButton>
      )}

      {canStop && (
        <GlowButton
          onClick={onStop}
          disabled={!canStop}
          variant="critical"
          icon={<Square className="w-4 h-4 fill-current" />}
          title="Stop pipeline (Esc)"
        >
          Stop
        </GlowButton>
      )}

      {isStopping && (
        <GlowButton
          disabled
          variant="critical"
          icon={<span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
        >
          Stopping...
        </GlowButton>
      )}

      {isFinished && onReset && (
        <GlowButton
          onClick={onReset}
          variant="secondary"
          icon={<RotateCcw className="w-4 h-4" />}
        >
          Reset Session
        </GlowButton>
      )}
    </div>
  );
};

