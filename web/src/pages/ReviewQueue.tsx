import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { api } from "../api/client";
import { IncidentItem } from "../api/types";
import { GlassCard } from "../components/ui/GlassCard";
import {
  Download,
  Filter,
  Search,
  ChevronRight,
  Info,
  ShieldAlert,
} from "lucide-react";

export const ReviewQueue: React.FC = () => {
  const navigate = useNavigate();
  const addToast = useSessionStore((s) => s.addToast);

  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [cameraFilter, setCameraFilter] = useState<string>("");
  const [verdictFilter, setVerdictFilter] = useState<string>("");
  const [originFilter, setOriginFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Keyboard cursor selection
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchIncidents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getIncidents({
        camera_id: cameraFilter || undefined,
        verdict: verdictFilter || undefined,
        origin: originFilter || undefined,
        search: searchQuery || undefined,
        limit: 100,
      });
      setIncidents(res.items);
      setTotal(res.total);
    } catch (e) {
      console.warn("Failed to load incidents:", e);
    } finally {
      setLoading(false);
    }
  }, [cameraFilter, verdictFilter, originFilter, searchQuery]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const applyVerdict = useCallback(async (id: string, verdict: "true_accident" | "false_alarm" | "unsure") => {
    try {
      const updated = await api.updateIncidentVerdict(id, verdict);
      setIncidents((prev) => prev.map((item) => (item.id === id ? updated : item)));
      addToast({
        type: "info",
        title: "Verdict Recorded",
        message: `Incident marked as ${verdict.replace("_", " ")}.`,
      });
    } catch (err) {
      console.error("Failed to update verdict:", err);
    }
  }, [addToast]);

  // Keyboard navigation & verdict shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(incidents.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && incidents[selectedIndex]) {
        e.preventDefault();
        navigate(`/incidents/${incidents[selectedIndex].id}`);
      } else if (e.key.toLowerCase() === "t" && incidents[selectedIndex]) {
        e.preventDefault();
        applyVerdict(incidents[selectedIndex].id, "true_accident");
      } else if (e.key.toLowerCase() === "f" && incidents[selectedIndex]) {
        e.preventDefault();
        applyVerdict(incidents[selectedIndex].id, "false_alarm");
      } else if (e.key.toLowerCase() === "u" && incidents[selectedIndex]) {
        e.preventDefault();
        applyVerdict(incidents[selectedIndex].id, "unsure");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, incidents, navigate, applyVerdict]);

  const handleBulkVerdict = async (verdict: "true_accident" | "false_alarm") => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      await api.updateIncidentVerdict(id, verdict);
    }
    fetchIncidents();
    setSelectedIds(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <GlassCard className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4" glowColor="cyan">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-extrabold tracking-tight uppercase text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-cyan-400" />
              <span>Incident Review Queue</span>
            </h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {total} Total
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Keyboard First: J/K to move, T = True, F = False, U = Unsure, Enter = Open.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-1.5 mr-2">
              <span className="text-xs font-mono text-slate-400">{selectedIds.size} selected</span>
              <button
                onClick={() => handleBulkVerdict("true_accident")}
                className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition shadow-sm"
              >
                Mark Accident
              </button>
              <button
                onClick={() => handleBulkVerdict("false_alarm")}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Mark False Alarm
              </button>
            </div>
          )}

          <a
            href={`${import.meta.env.VITE_API_URL || ""}/api/incidents/export.csv`}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </a>
        </div>
      </GlassCard>

      {/* Filter Bar */}
      <GlassCard className="p-3 flex flex-wrap items-center gap-2 text-xs" glowColor="cyan">
        <div className="flex items-center gap-1.5 text-slate-400 mr-2">
          <Filter className="w-3.5 h-3.5 text-cyan-400" />
          <span>Filters:</span>
        </div>

        {/* Verdict Filter */}
        <select
          value={verdictFilter}
          onChange={(e) => setVerdictFilter(e.target.value)}
          className="bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          <option value="">All Verdicts</option>
          <option value="unreviewed">Unreviewed Only</option>
          <option value="true_accident">True Accident</option>
          <option value="false_alarm">False Alarm</option>
          <option value="unsure">Unsure</option>
        </select>

        {/* Origin Filter */}
        <select
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
          className="bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          <option value="">All Origins</option>
          <option value="detector">YOLO Detector</option>
          <option value="collision_heuristic">Collision Heuristic</option>
          <option value="both">Dual Verified</option>
        </select>

        {/* Camera Filter */}
        <select
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          className="bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          <option value="">All Cameras</option>
          <option value="cam_01">Camera 01</option>
          <option value="cam_02">Camera 02</option>
          <option value="cam_03">Camera 03</option>
          <option value="cam_04">Camera 04</option>
        </select>

        {/* Search */}
        <div className="flex-1 min-w-[180px] relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="Search incident ID or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800/90 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500"
          />
        </div>
      </GlassCard>

      {/* Incidents Virtual Table */}
      <GlassCard className="overflow-hidden p-0" glowColor="cyan">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 font-mono text-[11px] text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === incidents.length && incidents.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(incidents.map((i) => i.id)));
                      else setSelectedIds(new Set());
                    }}
                    className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-400"
                  />
                </th>
                <th className="p-3">Incident</th>
                <th className="p-3">Camera</th>
                <th className="p-3">Time (Confirmed)</th>
                <th className="p-3">Origin</th>
                <th className="p-3">Confidence</th>
                <th className="p-3">Verdict</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 font-mono">
                    Loading incident queue...
                  </td>
                </tr>
              ) : incidents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-slate-500 font-mono">
                    No incidents matching selected filters.
                  </td>
                </tr>
              ) : (
                incidents.map((inc, idx) => {
                  const isCurrent = idx === selectedIndex;
                  const isChecked = selectedIds.has(inc.id);

                  let verdictBadge = (
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                      Unreviewed
                    </span>
                  );
                  if (inc.verdict === "true_accident") {
                    verdictBadge = (
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-red-950 text-red-300 border border-red-800 shadow-[0_0_8px_rgba(239,68,68,0.2)]">
                        True Accident
                      </span>
                    );
                  } else if (inc.verdict === "false_alarm") {
                    verdictBadge = (
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                        False Alarm
                      </span>
                    );
                  } else if (inc.verdict === "unsure") {
                    verdictBadge = (
                      <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-950 text-amber-300 border border-amber-800">
                        Unsure
                      </span>
                    );
                  }

                  let originBadge = (
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                      Detector
                    </span>
                  );
                  if (inc.origin === "collision_heuristic") {
                    originBadge = (
                      <span
                        className="px-2 py-0.5 rounded font-mono text-[10px] bg-amber-950 text-amber-300 border border-amber-800"
                        title="Kinematic collision candidate"
                      >
                        Overlap + motion rule (untuned)
                      </span>
                    );
                  } else if (inc.origin === "both") {
                    originBadge = (
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                        Dual Verified
                      </span>
                    );
                  }

                  return (
                    <tr
                      key={inc.id}
                      onClick={() => setSelectedIndex(idx)}
                      onDoubleClick={() => navigate(`/incidents/${inc.id}`)}
                      className={`cursor-pointer transition ${
                        isCurrent
                          ? "bg-slate-800/90 ring-1 ring-inset ring-cyan-400 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)]"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(inc.id);
                            else next.delete(inc.id);
                            setSelectedIds(next);
                          }}
                          className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-400"
                        />
                      </td>

                      <td className="p-3">
                        <div className="font-bold text-slate-100 flex items-center gap-1.5">
                          <span>{inc.id}</span>
                          {inc.peak_conf > 0.8 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_4px_#f43f5e]" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Zone #{inc.zone_id} • {inc.involved_vehicle_ids.length} vehicle(s)
                        </div>
                      </td>

                      <td className="p-3 font-mono text-cyan-300 uppercase">{inc.camera_id}</td>

                      <td className="p-3 font-mono text-slate-300">
                        {new Date(inc.confirmed_at).toLocaleString()}
                      </td>

                      <td className="p-3">{originBadge}</td>

                      <td className="p-3 font-mono font-bold text-slate-200">
                        {(inc.peak_conf * 100).toFixed(0)}%
                      </td>

                      <td className="p-3">{verdictBadge}</td>

                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              applyVerdict(inc.id, "false_alarm");
                            }}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-semibold transition"
                            title="Mark as False Alarm (F)"
                          >
                            False
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              applyVerdict(inc.id, "true_accident");
                            }}
                            className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-[10px] text-white font-bold transition shadow-sm"
                            title="Mark as True Accident (T)"
                          >
                            Crash
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/incidents/${inc.id}`);
                            }}
                            className="p-1 text-slate-400 hover:text-cyan-400 transition"
                            title="Inspect details (Enter)"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 p-2">
        <Info className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <span>Verdicts are operator opinions and are used only for counts on the Analytics page.</span>
      </div>
    </div>
  );
};
