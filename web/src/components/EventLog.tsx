import React from "react";
import { useSessionStore } from "../store/useSessionStore";
import { Download, Trash2, ListChecks, CheckCircle, AlertOctagon } from "lucide-react";

export const EventLog: React.FC = () => {
  const events = useSessionStore((s) => s.events);
  const clearEvents = useSessionStore((s) => s.clearEvents);

  const exportCsv = () => {
    if (events.length === 0) return;

    const headers = ["timestamp_ms", "frame_idx", "type", "zone_id", "details"];
    const rows = events.map((ev) => [
      ev.timestamp_ms,
      ev.frame_idx,
      ev.type,
      ev.zone_id,
      `"${(ev.details || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `accident_events_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-lg flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Incident Event Log
          </h3>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
            {events.length} / 200
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={exportCsv}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium border border-slate-700 transition"
            title="Download CSV export"
          >
            <Download className="w-3 h-3" />
            <span>CSV</span>
          </button>
          <button
            onClick={clearEvents}
            disabled={events.length === 0}
            className="p-1 rounded bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-700 transition"
            title="Clear event log"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto max-h-60 sm:max-h-72 space-y-2 pr-1">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500">
            <p className="text-xs">No incidents recorded yet.</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              Confirmed crashes and cleared zones will appear here chronologically.
            </p>
          </div>
        ) : (
          events.map((ev, idx) => {
            const isConfirmed = ev.type === "confirmed";
            return (
              <div
                key={`${ev.frame_idx}-${ev.zone_id}-${idx}`}
                className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 transition-all ${
                  isConfirmed
                    ? "bg-red-950/30 border-red-800/60 text-red-200"
                    : "bg-emerald-950/20 border-emerald-800/50 text-emerald-200"
                }`}
              >
                <div className="mt-0.5">
                  {isConfirmed ? (
                    <AlertOctagon className="w-4 h-4 text-red-400 flex-shrink-0" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold tracking-wide uppercase text-[11px]">
                      {isConfirmed ? "Collision Confirmed" : "Zone Cleared"}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {(ev.timestamp_ms / 1000).toFixed(2)}s (f#{ev.frame_idx})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                    {ev.details || `Zone #${ev.zone_id} status updated.`}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

