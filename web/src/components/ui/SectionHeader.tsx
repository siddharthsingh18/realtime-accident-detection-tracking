import React from "react";

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  badge,
  icon,
  action,
  className = "",
}) => {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3.5 mb-4 ${className}`}>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.2)]">
            {icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold font-display uppercase tracking-wider text-slate-100">
              {title}
            </h2>
            {badge && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 uppercase tracking-widest">
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
      </div>

      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
};
