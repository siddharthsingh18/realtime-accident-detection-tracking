import React from "react";
import { useSessionStore } from "../../store/useSessionStore";

export const AmbientMeshBackground: React.FC = () => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const hasActiveAccident = useSessionStore(
    (s) =>
      (s.telemetry?.confirmed_accidents ?? 0) > 0 ||
      Object.values(s.cameraTelemetry).some((t) => (t?.confirmed_accidents ?? 0) > 0)
  );

  if (effectsQuality === "off") {
    return hasActiveAccident ? <div className="alert-mode-vignette opacity-80" /> : null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* 1. Subtle Matrix Grid Pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-40" />

      {/* 2. Slow-Moving Ambient Glowing Blobs */}
      <div
        className={`absolute -top-32 -left-32 w-96 h-96 rounded-full blur-[120px] transition-all duration-1000 ${
          hasActiveAccident
            ? "bg-rose-600/30 animate-pulse"
            : "bg-cyan-500/15"
        }`}
      />
      <div
        className={`absolute top-1/3 -right-40 w-[30rem] h-[30rem] rounded-full blur-[140px] transition-all duration-1000 ${
          hasActiveAccident
            ? "bg-red-600/25"
            : "bg-blue-600/15"
        }`}
      />
      <div
        className="absolute -bottom-32 left-1/4 w-[28rem] h-[28rem] rounded-full blur-[130px] bg-indigo-900/15"
      />

      {/* 3. Global Red Alert Vignette during Confirmed Incident */}
      {hasActiveAccident && <div className="alert-mode-vignette" />}
    </div>
  );
};
