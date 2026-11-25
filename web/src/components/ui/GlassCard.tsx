import React, { useRef } from "react";
import { useSessionStore } from "../../store/useSessionStore";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "cyan" | "warning" | "critical" | "success";
  glowColor?: "cyan" | "crimson" | "amber" | "emerald" | "default" | string;
  spotlight?: boolean;
  glow?: boolean;
  children: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  variant = "default",
  glowColor,
  spotlight = true,
  glow = false,
  className = "",
  children,
  onMouseMove,
  ...props
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const effectsQuality = useSessionStore((state) => state.effectsQuality);

  // Map glowColor to variant and enable glow
  let effectiveVariant = variant;
  let effectiveGlow = glow;

  if (glowColor) {
    effectiveGlow = true;
    if (glowColor === "cyan") effectiveVariant = "cyan";
    else if (glowColor === "crimson" || glowColor === "red") effectiveVariant = "critical";
    else if (glowColor === "amber" || glowColor === "yellow") effectiveVariant = "warning";
    else if (glowColor === "emerald" || glowColor === "green") effectiveVariant = "success";
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (spotlight && effectsQuality !== "off" && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cardRef.current.style.setProperty("--mouse-x", `${x}px`);
      cardRef.current.style.setProperty("--mouse-y", `${y}px`);
    }
    if (onMouseMove) onMouseMove(e);
  };

  let borderVariantClass = "border-slate-800/80 hover:border-slate-700/80";
  let glowClass = "";

  if (effectiveVariant === "cyan") {
    borderVariantClass = "border-cyan-500/30 hover:border-cyan-400/60";
    if (effectiveGlow && effectsQuality !== "off") glowClass = "shadow-[0_0_20px_rgba(0,240,255,0.18)]";
  } else if (effectiveVariant === "critical") {
    borderVariantClass = "border-rose-500/50 hover:border-rose-400/80";
    if (effectiveGlow && effectsQuality !== "off") glowClass = "shadow-[0_0_25px_rgba(239,68,68,0.25)]";
  } else if (effectiveVariant === "warning") {
    borderVariantClass = "border-amber-500/40 hover:border-amber-400/70";
    if (effectiveGlow && effectsQuality !== "off") glowClass = "shadow-[0_0_20px_rgba(245,158,11,0.2)]";
  } else if (effectiveVariant === "success") {
    borderVariantClass = "border-emerald-500/40 hover:border-emerald-400/70";
    if (effectiveGlow && effectsQuality !== "off") glowClass = "shadow-[0_0_20px_rgba(16,185,129,0.2)]";
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      className={`spotlight-card rounded-2xl ${
        effectsQuality === "high" ? "bg-surface/75 backdrop-blur-md" : "bg-slate-900/90"
      } border ${borderVariantClass} ${glowClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
