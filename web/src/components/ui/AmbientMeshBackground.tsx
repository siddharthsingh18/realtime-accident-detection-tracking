import React from "react";
import { useSessionStore } from "../../store/useSessionStore";

export const AmbientMeshBackground: React.FC = () => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const hasActiveAccident = useSessionStore(
    (s) =>
      (s.telemetry?.confirmed_accidents ?? 0) > 0 ||
      Object.values(s.cameraTelemetry).some((t) => (t?.confirmed_accidents ?? 0) > 0)
  );

  // Off: Flat dark background, no ambient blobs, no 3D
  if (effectsQuality === "off") {
    return hasActiveAccident ? <div className="alert-mode-vignette opacity-80" /> : null;
  }

  const isLow = effectsQuality === "low";

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {/* 1. Subtle Matrix Grid Pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-40" />

      {/* 2. Pre-blurred static CSS radial gradients (Zero GPU filter blurs) */}
      {/* Blob 1: Top-Left */}
      <div
        className={`absolute -top-32 -left-32 w-[32rem] h-[32rem] pointer-events-none transition-all duration-1000 ${
          isLow ? "" : hasActiveAccident ? "animate-pulse" : ""
        }`}
        style={{
          background: hasActiveAccident
            ? "radial-gradient(circle, rgba(225, 29, 72, 0.35) 0%, rgba(225, 29, 72, 0.12) 45%, rgba(225, 29, 72, 0) 70%)"
            : "radial-gradient(circle, rgba(6, 182, 212, 0.18) 0%, rgba(6, 182, 212, 0.06) 45%, rgba(6, 182, 212, 0) 70%)",
          willChange: isLow ? "auto" : "opacity, transform",
        }}
      />

      {/* Blob 2: Middle-Right */}
      <div
        className="absolute top-1/3 -right-40 w-[36rem] h-[36rem] pointer-events-none transition-all duration-1000"
        style={{
          background: hasActiveAccident
            ? "radial-gradient(circle, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.1) 45%, rgba(239, 68, 68, 0) 70%)"
            : "radial-gradient(circle, rgba(37, 99, 235, 0.16) 0%, rgba(37, 99, 235, 0.05) 45%, rgba(37, 99, 235, 0) 70%)",
          willChange: isLow ? "auto" : "opacity, transform",
        }}
      />

      {/* Blob 3: Bottom-Left (Subtle indigo, only on High effects) */}
      {!isLow && (
        <div
          className="absolute -bottom-32 left-1/4 w-[34rem] h-[34rem] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(49, 46, 129, 0.22) 0%, rgba(49, 46, 129, 0.06) 50%, rgba(49, 46, 129, 0) 70%)",
          }}
        />
      )}

      {/* 3. Global Red Alert Vignette during Confirmed Incident */}
      {hasActiveAccident && <div className="alert-mode-vignette" />}
    </div>
  );
};
