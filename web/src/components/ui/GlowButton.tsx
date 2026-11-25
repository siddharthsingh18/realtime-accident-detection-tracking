import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { useSessionStore } from "../../store/useSessionStore";

export interface GlowButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: "primary" | "critical" | "warning" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const GlowButton: React.FC<GlowButtonProps> = ({
  variant = "primary",
  size = "md",
  icon,
  children,
  className = "",
  disabled,
  ...props
}) => {
  const effectsQuality = useSessionStore((state) => state.effectsQuality);
  const allowMotion = effectsQuality !== "off";

  const sizeClasses = {
    sm: "px-2.5 py-1 text-xs gap-1.5 rounded-lg",
    md: "px-3.5 py-2 text-xs sm:text-sm gap-2 rounded-xl",
    lg: "px-5 py-2.5 text-sm sm:text-base gap-2.5 rounded-xl font-bold",
  }[size];

  const variantClasses = {
    primary:
      "bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold border border-cyan-400/50 shadow-[0_0_15px_rgba(0,240,255,0.3)] hover:shadow-[0_0_25px_rgba(0,240,255,0.6)] hover:border-cyan-300",
    critical:
      "bg-gradient-to-r from-rose-600 to-red-700 text-white font-bold border border-rose-400/50 shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_25px_rgba(239,68,68,0.6)] hover:border-rose-300",
    warning:
      "bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 font-bold border border-amber-400/50 shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:shadow-[0_0_25px_rgba(245,158,11,0.6)] hover:border-amber-300",
    secondary:
      "bg-slate-900/90 text-slate-200 border border-slate-700/80 hover:bg-slate-800 hover:border-cyan-500/50 hover:text-cyan-300 shadow-md",
    ghost:
      "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent hover:border-slate-700/60",
  }[variant];

  return (
    <motion.button
      whileHover={allowMotion && !disabled ? { scale: 1.02 } : undefined}
      whileTap={allowMotion && !disabled ? { scale: 0.98 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-display tracking-wide uppercase transition-colors relative group select-none disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span>{children}</span>
    </motion.button>
  );
};
