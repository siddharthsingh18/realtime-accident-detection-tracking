import React, { useState } from "react";
import { api } from "../api/client";
import { PipelineSettings, CompareResponse } from "../api/types";
import { DEFAULT_SETTINGS } from "../mock/mockData";
import {
  GitCompare,
  Play,
  Info,
} from "lucide-react";
import { GlassCard } from "../components/ui/GlassCard";
import { GlowButton } from "../components/ui/GlowButton";

export const CompareView: React.FC = () => {
  const [source, setSource] = useState("sample1");
  const [profileASettings, setProfileASettings] = useState<PipelineSettings>({
    ...DEFAULT_SETTINGS,
    use_collision_heuristic: true,
  });
  const [profileBSettings, setProfileBSettings] = useState<PipelineSettings>({
    ...DEFAULT_SETTINGS,
    use_collision_heuristic: false,
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);

  const handleRunCompare = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.runCompare({
        source,
        profile_a_settings: profileASettings,
        profile_b_settings: profileBSettings,
        profile_a_name: "Profile A (Collision Heuristic ON)",
        profile_b_name: "Profile B (Collision Heuristic OFF)",
        max_frames: 120,
      });
      setResult(res);
    } catch (e) {
      console.error("Comparison execution failed:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <GlassCard variant="cyan" glow={true} className="p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <GitCompare className="w-5 h-5 text-cyan-400" />
              <h2 className="text-sm sm:text-base font-extrabold font-display tracking-wider uppercase text-slate-100">
                A/B PIPELINE COMPARISON ENGINE
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Compare two detection configurations side-by-side on identical video footage.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="bg-slate-950/80 border border-slate-700 text-xs rounded-xl px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-cyan-400 shadow-inner"
            >
              <option value="sample1">Sample 1 (Highway Incident)</option>
              <option value="sample2">Sample 2 (Multi-Car Incident)</option>
            </select>

            <GlowButton
              onClick={handleRunCompare}
              disabled={loading}
              variant="primary"
              icon={<Play className="w-4 h-4 fill-current" />}
            >
              {loading ? "Benchmarking..." : "Run Benchmark"}
            </GlowButton>
          </div>
        </div>
      </GlassCard>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile A */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase">Profile A (Heuristic ON)</span>
            <span className="font-mono text-[10px] text-emerald-400">Baseline</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Accident Confidence:</span>
                <span className="font-mono text-white">{profileASettings.accident_conf.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={profileASettings.accident_conf}
                onChange={(e) => setProfileASettings({ ...profileASettings, accident_conf: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-2 border-t border-slate-800">
              <span>Collision Heuristic Gate</span>
              <input
                type="checkbox"
                checked={profileASettings.use_collision_heuristic}
                onChange={(e) => setProfileASettings({ ...profileASettings, use_collision_heuristic: e.target.checked })}
                className="rounded border-slate-700 bg-slate-800 text-emerald-500"
              />
            </label>
          </div>
        </div>

        {/* Profile B */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200 uppercase">Profile B (Heuristic OFF)</span>
            <span className="font-mono text-[10px] text-amber-400">Pure Deep Learning</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Accident Confidence:</span>
                <span className="font-mono text-white">{profileBSettings.accident_conf.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.05"
                value={profileBSettings.accident_conf}
                onChange={(e) => setProfileBSettings({ ...profileBSettings, accident_conf: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-2 border-t border-slate-800">
              <span>Collision Heuristic Gate</span>
              <input
                type="checkbox"
                checked={profileBSettings.use_collision_heuristic}
                onChange={(e) => setProfileBSettings({ ...profileBSettings, use_collision_heuristic: e.target.checked })}
                className="rounded border-slate-700 bg-slate-800 text-emerald-500"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Comparison Outcome Cards */}
      {result && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-6 animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Simulation Results on {result.source}
            </h3>
            <span className="font-mono text-xs text-slate-400">
              Frames evaluated: {result.run_a.total_frames}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Run A Card */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-emerald-400">{result.run_a.profile_name}</div>
              <div className="text-2xl font-black font-mono text-white">
                {result.run_a.confirmed_alerts_count} Confirmed Alert(s)
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Active Zone Ranges:{" "}
                {result.run_a.frame_ranges.length > 0
                  ? result.run_a.frame_ranges.map(([s, e]) => `[f#${s}–f#${e}]`).join(", ")
                  : "None"}
              </div>
            </div>

            {/* Run B Card */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 text-xs">
              <div className="font-bold text-amber-400">{result.run_b.profile_name}</div>
              <div className="text-2xl font-black font-mono text-white">
                {result.run_b.confirmed_alerts_count} Confirmed Alert(s)
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Active Zone Ranges:{" "}
                {result.run_b.frame_ranges.length > 0
                  ? result.run_b.frame_ranges.map(([s, e]) => `[f#${s}–f#${e}]`).join(", ")
                  : "None"}
              </div>
            </div>
          </div>

          {/* Shared Timeline Axis */}
          <div className="space-y-2 text-xs">
            <span className="text-slate-400 font-bold block">Shared Frame Axis Timeline:</span>
            <div className="h-6 w-full bg-slate-950 rounded-lg relative overflow-hidden border border-slate-800">
              {result.run_a.frame_ranges.map(([s, e], i) => {
                const total = Math.max(1, result.run_a.total_frames);
                const left = (s / total) * 100;
                const width = ((e - s) / total) * 100;
                return (
                  <div
                    key={`a-${i}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="absolute top-0 bottom-1/2 bg-emerald-500 opacity-80"
                    title={`Run A: f#${s} to f#${e}`}
                  />
                );
              })}
              {result.run_b.frame_ranges.map(([s, e], i) => {
                const total = Math.max(1, result.run_b.total_frames);
                const left = (s / total) * 100;
                const width = ((e - s) / total) * 100;
                return (
                  <div
                    key={`b-${i}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="absolute top-1/2 bottom-0 bg-amber-500 opacity-80"
                    title={`Run B: f#${s} to f#${e}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>Frame #0</span>
              <span>Top: Profile A (Green) • Bottom: Profile B (Amber)</span>
              <span>Frame #{result.run_a.total_frames}</span>
            </div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{result.caveat}</span>
          </div>
        </div>
      )}
    </div>
  );
};
