import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { StatsResponse } from "../api/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  BarChart3,
  Info,
  CheckCircle,
} from "lucide-react";

export const AnalyticsView: React.FC = () => {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameraFilter, setCameraFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getStats(undefined, undefined, cameraFilter || undefined)
      .then((data) => setStats(data))
      .catch((e) => console.warn("Failed to load analytics:", e))
      .finally(() => setLoading(false));
  }, [cameraFilter]);

  if (loading) {
    return <div className="p-12 text-center text-xs text-slate-500 font-mono">Loading analytics...</div>;
  }

  if (!stats) {
    return (
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl">
        <p className="text-xs text-slate-400">No incident statistics available yet.</p>
      </div>
    );
  }

  // Format origin data for Recharts
  const originData = Object.entries(stats.by_origin || {}).map(([key, val]) => ({
    name: key === "collision_heuristic" ? "Overlap Rule" : key === "both" ? "Dual Verified" : "YOLO Detector",
    count: val,
  }));

  // Format verdict data for Recharts
  const verdictData = Object.entries(stats.by_verdict || {}).map(([key, val]) => ({
    name: key.replace("_", " "),
    count: val,
  }));

  return (
    <div className="space-y-6">
      {/* Top Header & Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-extrabold tracking-tight uppercase">
              Incident Analytics & Operator Verdicts
            </h2>
          </div>
          <p className="text-[11px] text-slate-400">
            Real incident distributions and operator review outcomes. Derived strictly from database records.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none"
          >
            <option value="">All Cameras</option>
            <option value="cam_01">Camera 01</option>
            <option value="cam_02">Camera 02</option>
            <option value="cam_03">Camera 03</option>
            <option value="cam_04">Camera 04</option>
          </select>
        </div>
      </div>

      {/* Operator-Reviewed Outcomes Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Operator-Reviewed Outcomes
            </h3>
          </div>
          <span className="font-mono text-xs text-slate-400">
            {stats.reviewed_count} reviewed of {stats.total_incidents} total
          </span>
        </div>

        {/* Counts summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
            <span className="text-slate-500 font-mono text-[11px] block">True Accidents</span>
            <span className="text-xl font-bold font-mono text-red-400">{stats.true_accident_count}</span>
          </div>

          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
            <span className="text-slate-500 font-mono text-[11px] block">False Alarms</span>
            <span className="text-xl font-bold font-mono text-slate-200">{stats.false_alarm_count}</span>
          </div>

          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
            <span className="text-slate-500 font-mono text-[11px] block">Unsure / Ambiguous</span>
            <span className="text-xl font-bold font-mono text-amber-400">{stats.unsure_count}</span>
          </div>

          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl">
            <span className="text-slate-500 font-mono text-[11px] block">Reviewed False Alarm Share</span>
            <span className="text-xl font-bold font-mono text-slate-300">
              {stats.insufficient_data ? "—" : `${(stats.false_alarm_share * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>

        {/* Honesty Warning Banner */}
        <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-slate-300 font-bold">
            <Info className="w-3.5 h-3.5 text-emerald-400" />
            <span>Honesty Caveat:</span>
          </div>
          <p className="text-slate-400 text-[11px]">
            {stats.operator_caveat}
          </p>
          {stats.insufficient_data && (
            <p className="text-amber-400 text-[11px] font-mono">
              Notice: Fewer than 20 operator reviews recorded. Percentage metrics withheld to prevent sample bias.
            </p>
          )}
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Chart 1: Alerts by Hour of Day */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Alert Volume by Hour of Day (UTC)
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.by_hour}>
                <XAxis dataKey="hour" stroke="#64748b" fontSize={10} tickFormatter={(h) => `${h}h`} />
                <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Alerts Over Time (Daily) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Alert Trend Over Time (Daily)
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.by_day}>
                <XAxis dataKey="date" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                />
                <Area type="monotone" dataKey="count" stroke="#38bdf8" fill="#0284c7" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Detection Origin Breakdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Alerts by Detection Origin
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={originData}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                />
                <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Operator Verdicts Breakdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Operator Verdicts Breakdown
          </h3>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={verdictData}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                />
                <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
