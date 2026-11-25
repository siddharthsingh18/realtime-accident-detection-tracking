import React, { useMemo } from "react";
import { AlertOctagon, ShieldCheck } from "lucide-react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";

export const AlertBanner: React.FC = () => {
  const { isAlert, confirmedAccidents, status, zones } = useSessionStore(
    useShallow((s) => ({
      isAlert: (s.telemetry?.confirmed_accidents ?? 0) > 0,
      confirmedAccidents: s.telemetry?.confirmed_accidents ?? 0,
      status: s.status,
      zones: s.telemetry?.zones,
    }))
  );
  const isActiveSession = status === "running" || status === "paused";

  const activeZones = useMemo(
    () => (zones || []).filter((z) => z.status === "ACTIVE" || z.status === "MAINTAINED"),
    [zones]
  );

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`relative w-full rounded-xl p-4 transition-all duration-300 shadow-lg overflow-hidden border ${
        isAlert
          ? "bg-gradient-to-r from-red-600 via-rose-600 to-red-800 border-red-500/80 text-white shadow-red-900/30 animate-pulse-glow"
          : "bg-gradient-to-r from-emerald-600 via-teal-700 to-emerald-800 border-emerald-500/60 text-white shadow-emerald-950/20"
      }`}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative z-10">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-lg bg-black/40 text-white ${
              isAlert ? "animate-bounce motion-reduce:animate-none" : ""
            }`}
          >
            {isAlert ? (
              <AlertOctagon className="w-6 h-6 text-yellow-300" />
            ) : (
              <ShieldCheck className="w-6 h-6 text-emerald-200" />
            )}
          </div>
          <div>
            <div className="text-base sm:text-lg font-black tracking-wide flex items-center gap-2">
              <span>
                {isAlert
                  ? `CRITICAL ALERT: ${confirmedAccidents} ACCIDENT ZONE${
                      confirmedAccidents > 1 ? "S" : ""
                    } DETECTED`
                  : "SYSTEM NORMAL: ROAD SURVEILLANCE ACTIVE"}
              </span>
              {isAlert && (
                <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-red-950/80 text-yellow-300 rounded border border-red-400">
                  Confirmed
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-white/90 font-medium">
              {isAlert
                ? activeZones.length > 0
                  ? `Incident identified in Zone(s): ${activeZones
                      .map((z) => `#${z.zone_id} (${Math.round(z.conf * 100)}% conf)`)
                      .join(", ")}`
                  : "Collision or hazardous obstruction confirmed by persistence state machine."
                : isActiveSession
                ? "Neural detection and BoT-SORT tracking active. No crash signatures confirmed."
                : "Awaiting stream launch. Ready to process road video feeds."}
            </p>
          </div>
        </div>

        {isAlert && (
          <div className="self-end sm:self-center px-3 py-1.5 rounded-lg bg-black/60 border border-white/20 text-xs font-mono font-semibold tracking-wider text-yellow-200">
            ACTION REQUIRED
          </div>
        )}
      </div>
    </div>
  );
};

