import React from "react";
import { ZoneTelemetry, TrackTelemetry } from "../api/types";
import { Car, ShieldAlert } from "lucide-react";

interface Props {
  target: { type: "zone" | "track"; data: any; x: number; y: number } | null;
}

export const InspectorPopover: React.FC<Props> = ({ target }) => {
  if (!target) return null;

  const isZone = target.type === "zone";
  const zone: ZoneTelemetry = isZone ? target.data : null;
  const track: TrackTelemetry = !isZone ? target.data : null;

  return (
    <div
      style={{ left: `${Math.min(target.x + 12, window.innerWidth - 260)}px`, top: `${Math.max(10, target.y - 40)}px` }}
      className="absolute z-30 pointer-events-none bg-slate-900/95 border border-slate-700 rounded-xl p-3 shadow-2xl backdrop-blur text-xs w-64 animate-fade-in"
    >
      {isZone && zone && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-red-400">
              <ShieldAlert className="w-4 h-4" />
              <span>Zone #{zone.zone_id} [{zone.status}]</span>
            </div>
            <span className="font-mono text-[10px] bg-red-950 text-red-300 px-1.5 py-0.5 rounded border border-red-800">
              {(zone.conf * 100).toFixed(0)}% conf
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300">
            <span className="text-slate-500">Origin:</span>
            <span className="font-mono text-right text-amber-300">
              {zone.origin === "collision_heuristic"
                ? "Overlap Rule"
                : zone.origin === "both"
                ? "Dual Verified"
                : "YOLO Detector"}
            </span>

            <span className="text-slate-500">Involved Vehicles:</span>
            <span className="font-mono text-right">
              {zone.involved_vehicle_ids.length > 0 ? zone.involved_vehicle_ids.map(id => `#${id}`).join(", ") : "None"}
            </span>

            {zone.speed_loss_pct && (
              <>
                <span className="text-slate-500">Speed Decel:</span>
                <span className="font-mono text-right text-rose-400 font-bold">
                  {zone.speed_loss_pct.toFixed(1)}% drop
                </span>
              </>
            )}
          </div>
          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
            Confirmed zone evaluated by persistence state machine.
          </div>
        </div>
      )}

      {!isZone && track && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <div className="flex items-center gap-1.5 font-bold text-blue-400">
              <Car className="w-4 h-4" />
              <span>Track #{track.track_id} ({track.cls})</span>
            </div>
            <span className="font-mono text-[10px] bg-blue-950 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800">
              {(track.conf * 100).toFixed(0)}%
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-300">
            <span className="text-slate-500">Speed:</span>
            <span className="font-mono text-right text-amber-300">
              {(track.speed_px_s ?? 0).toFixed(1)} px/s
            </span>

            <span className="text-slate-500">Suppression:</span>
            <span className="font-mono text-right text-slate-400">
              {track.suppressed ? "Inside Hazard (Ghost)" : "Active"}
            </span>

            <span className="text-slate-500">Motion Trail:</span>
            <span className="font-mono text-right">
              {track.trail?.length || 0} points
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
