import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { IncidentItem } from "../api/types";
import { Bell, X, CheckCircle, ChevronRight, AlertTriangle, ShieldAlert } from "lucide-react";

export const AlertDrawer: React.FC = () => {
  const { isAlertDrawerOpen, setAlertDrawerOpen, setUnreviewedCount } = useSessionStore(
    useShallow((s) => ({
      isAlertDrawerOpen: s.isAlertDrawerOpen,
      setAlertDrawerOpen: s.setAlertDrawerOpen,
      setUnreviewedCount: s.setUnreviewedCount,
    }))
  );
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const fetchUnreviewed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getIncidents({ verdict: "unreviewed", limit: 20 });
      setIncidents(res.items);
      setUnreviewedCount(res.total);
    } catch (e) {
      console.warn("Could not load unreviewed alerts:", e);
    } finally {
      setLoading(false);
    }
  }, [setUnreviewedCount]);

  useEffect(() => {
    if (isAlertDrawerOpen) {
      fetchUnreviewed();
    }
  }, [isAlertDrawerOpen, fetchUnreviewed]);

  if (!isAlertDrawerOpen) return null;

  const handleQuickVerdict = async (id: string, verdict: "true_accident" | "false_alarm") => {
    try {
      await api.updateIncidentVerdict(id, verdict);
      setIncidents((prev) => prev.filter((i) => i.id !== id));
      setUnreviewedCount(Math.max(0, incidents.length - 1));
    } catch (err) {
      console.error("Failed to update verdict:", err);
    }
  };

  // Check for any unreviewed incidents older than 5 minutes for escalation
  const hasEscalated = incidents.some((inc) => {
    const ageMs = Date.now() - new Date(inc.confirmed_at).getTime();
    return ageMs > 5 * 60 * 1000;
  });

  return (
    <div
      onClick={() => setAlertDrawerOpen(false)}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex justify-end animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900/95 border-l border-cyan-500/30 h-full flex flex-col shadow-2xl backdrop-blur-xl"
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Bell className="w-5 h-5 text-rose-400" />
              {incidents.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Unreviewed Alerts ({incidents.length})
            </h3>
          </div>
          <button
            onClick={() => setAlertDrawerOpen(false)}
            className="p-1 rounded text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {hasEscalated && (
          <div className="bg-rose-950/80 border-b border-rose-800 p-3 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-300 flex-shrink-0 animate-bounce" />
            <span>Escalation: Incidents pending operator review for over 5 minutes!</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-10 text-xs text-slate-500 font-mono">Loading alerts...</div>
          ) : incidents.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs flex flex-col items-center">
              <CheckCircle className="w-10 h-10 text-emerald-500 mb-2 stroke-1" />
              <span>All incidents reviewed! Zero pending alerts.</span>
            </div>
          ) : (
            incidents.map((inc) => (
              <div
                key={inc.id}
                className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2 hover:border-cyan-500/50 hover:shadow-[0_0_12px_rgba(6,182,212,0.15)] transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold text-xs text-rose-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Zone #{inc.zone_id} [{inc.camera_id}]</span>
                    </span>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {new Date(inc.confirmed_at).toLocaleTimeString()} • {(inc.peak_conf * 100).toFixed(0)}% conf
                    </div>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                    {inc.origin}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                  <button
                    onClick={() => {
                      setAlertDrawerOpen(false);
                      navigate(`/incidents/${inc.id}`);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-cyan-400 transition"
                  >
                    <span>Inspect</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleQuickVerdict(inc.id, "false_alarm")}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition"
                    >
                      False Alarm
                    </button>
                    <button
                      onClick={() => handleQuickVerdict(inc.id, "true_accident")}
                      className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold transition shadow-sm"
                    >
                      Accident
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
