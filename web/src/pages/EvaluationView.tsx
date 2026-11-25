import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { LatestEvalResponse } from "../api/types";
import { GlassCard } from "../components/ui/GlassCard";
import { StatusPill } from "../components/ui/StatusPill";
import { SectionHeader } from "../components/ui/SectionHeader";
import { MetricTile } from "../components/ui/MetricTile";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import {
  CheckCircle2,
  AlertTriangle,
  Activity,
  Sliders,
  FolderOpen,
  ShieldAlert,
  HelpCircle,
  Layers,
  Terminal,
} from "lucide-react";

export const EvaluationView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LatestEvalResponse | null>(null);

  useEffect(() => {
    api
      .getLatestEvaluation()
      .then((res) => setData(res))
      .catch((err) => {
        console.warn("Failed to load evaluation report:", err);
        setData({ has_run: false, message: "Could not reach evaluation service." });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-slate-500 font-mono">
        Loading evaluation telemetry...
      </div>
    );
  }

  // EMPTY STATE: No evaluation run executed yet
  if (!data || !data.has_run || !data.report) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <GlassCard className="p-5 flex items-center justify-between" glowColor="cyan">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-cyan-400" />
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-100">
                Accident Detection Evaluation Harness
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Strict offline benchmark verifying precision, recall, false alarm rates, and detection latency.
            </p>
          </div>
          <StatusPill status="idle" label="No Active Runs" />
        </GlassCard>

        <GlassCard className="p-8 text-center space-y-4" glowColor="cyan">
          <FolderOpen className="w-12 h-12 text-cyan-400/80 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-100">
              No Evaluation Runs Recorded Yet
            </h3>
            <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
              To measure model performance honestly without placeholder numbers, provide test clips and execute the evaluation harness.
            </p>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 text-left text-xs space-y-3 font-mono max-w-2xl mx-auto">
            <div className="flex items-center gap-2 text-cyan-400 font-bold border-b border-slate-800 pb-2">
              <Terminal className="w-4 h-4" />
              <span>How to Run an Evaluation:</span>
            </div>
            <div className="space-y-2 text-slate-300 text-[11px]">
              <div>
                <span className="text-slate-500">1. Place .mp4 video clips into:</span>
                <p className="text-cyan-300 ml-4 font-bold">eval/clips/</p>
              </div>
              <div>
                <span className="text-slate-500">2. Annotate ground truth in:</span>
                <p className="text-cyan-300 ml-4 font-bold">eval/labels.csv</p>
                <p className="text-[10px] text-slate-400 ml-4">Columns: filename, label (crash|normal), crash_onset_sec, condition_tags (day, night, rain, dense, etc.)</p>
              </div>
              <div>
                <span className="text-slate-500">3. Assign holdout split in:</span>
                <p className="text-cyan-300 ml-4 font-bold">eval/splits.csv</p>
                <p className="text-[10px] text-slate-400 ml-4">Columns: filename, split (dev|test)</p>
              </div>
              <div>
                <span className="text-slate-500">4. Validate dataset integrity:</span>
                <p className="text-emerald-400 ml-4 font-bold">python scripts/validate_dataset.py</p>
              </div>
              <div>
                <span className="text-slate-500">5. Execute headless evaluation:</span>
                <p className="text-emerald-400 ml-4 font-bold">python scripts/evaluate.py --backend pytorch</p>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 italic">
            Zero placeholder data: Metrics and confusion matrix render only when real clips are evaluated.
          </div>
        </GlassCard>
      </div>
    );
  }

  const report = data.report;
  const summary = report.summary_all.summary;
  const counts = report.summary_all.counts;
  const rates = report.summary_all.rates;
  const delay = report.summary_all.delay;

  // Transform condition breakdown into Recharts array
  const conditionData = Object.entries(report.condition_breakdown || {}).map(
    ([tag, metrics]) => ({
      condition: tag,
      recall: Math.round(metrics.recall * 100),
      precision: Math.round(metrics.precision * 100),
      f1: Math.round(metrics.f1_score * 100),
      clips: metrics.clip_count,
    })
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <GlassCard className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" glowColor="cyan">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-100 flex items-center gap-2">
              <span>Evaluation Report:</span>
              <span className="font-mono text-cyan-300 font-bold">{report.run_id}</span>
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Evaluated on <strong className="text-slate-200">{summary.total_clips} clips</strong> ({summary.total_crashes} crashes, {summary.total_normals} normal) • Runtime: {report.backend.toUpperCase()} • {report.timestamp_utc} UTC
          </p>
        </div>

        <div className="flex items-center gap-2">
          {report.is_smoke_test && (
            <span className="px-2.5 py-1 rounded-lg bg-amber-950/80 border border-amber-600/80 text-amber-300 text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Smoke Test (&lt;10 clips)</span>
            </span>
          )}
          <StatusPill status="online" label={`Backend: ${report.backend.toUpperCase()}`} />
        </div>
      </GlassCard>

      {/* KPI Metric Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricTile
          label="Recall (Sensitivity)"
          value={`${(rates.recall * 100).toFixed(1)}%`}
          subtext={`95% CI: [${(rates.recall_ci_95[0] * 100).toFixed(0)}%, ${(rates.recall_ci_95[1] * 100).toFixed(0)}%]`}
          variant={rates.recall >= 0.8 ? "cyan" : "warning"}
        />
        <MetricTile
          label="Precision (PPV)"
          value={`${(rates.precision * 100).toFixed(1)}%`}
          subtext={`95% CI: [${(rates.precision_ci_95[0] * 100).toFixed(0)}%, ${(rates.precision_ci_95[1] * 100).toFixed(0)}%]`}
          variant={rates.precision >= 0.8 ? "cyan" : "warning"}
        />
        <MetricTile
          label="F1 Score"
          value={rates.f1_score.toFixed(3)}
          subtext="Harmonic Mean"
          variant="cyan"
        />
        <MetricTile
          label="Accuracy"
          value={`${(rates.accuracy * 100).toFixed(1)}%`}
          subtext={`95% CI: [${(rates.accuracy_ci_95[0] * 100).toFixed(0)}%, ${(rates.accuracy_ci_95[1] * 100).toFixed(0)}%]`}
          variant="default"
        />
        <MetricTile
          label="False Alarms / Hr"
          value={`${rates.false_alarms_per_hour.toFixed(1)}/hr`}
          subtext={`Over ${summary.normal_duration_hours.toFixed(1)}h normal`}
          variant={rates.false_alarms_per_hour <= 3.0 ? "cyan" : "critical"}
        />
        <MetricTile
          label="Median Delay"
          value={delay.median_sec !== null ? `${delay.median_sec.toFixed(1)}s` : "—"}
          subtext={delay.p90_sec !== null ? `p90: ${delay.p90_sec.toFixed(1)}s` : "N/A"}
          variant="default"
        />
      </div>

      {/* Main Grid: Confusion Matrix & Splits vs PR Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: Confusion Matrix & Splits */}
        <div className="space-y-6">
          <GlassCard className="p-5 space-y-4" glowColor="cyan">
            <SectionHeader
              title="Clip-Level Confusion Matrix"
              subtitle="Classification outcomes evaluated against ground-truth labels and onset window constraints."
              icon={<ShieldAlert className="w-4 h-4 text-cyan-400" />}
            />

            <div className="grid grid-cols-2 gap-3 text-center">
              {/* TP */}
              <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-4 space-y-1">
                <div className="text-[10px] font-mono text-emerald-400 uppercase font-bold tracking-wider">
                  True Positive (TP)
                </div>
                <div className="text-2xl font-black font-mono text-emerald-300">
                  {counts.TP}
                </div>
                <div className="text-[10px] text-slate-400">
                  Correctly detected crash within {delay.max_delay_threshold_sec}s
                </div>
              </div>

              {/* FN */}
              <div className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-4 space-y-1">
                <div className="text-[10px] font-mono text-rose-400 uppercase font-bold tracking-wider">
                  False Negative (FN)
                </div>
                <div className="text-2xl font-black font-mono text-rose-300">
                  {counts.FN}
                </div>
                <div className="text-[10px] text-slate-400">
                  Missed crash, early alert, or late &gt;{delay.max_delay_threshold_sec}s
                </div>
              </div>

              {/* FP */}
              <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 space-y-1">
                <div className="text-[10px] font-mono text-amber-400 uppercase font-bold tracking-wider">
                  False Positive (FP)
                </div>
                <div className="text-2xl font-black font-mono text-amber-300">
                  {counts.FP}
                </div>
                <div className="text-[10px] text-slate-400">
                  False alarm triggered on normal clip
                </div>
              </div>

              {/* TN */}
              <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 space-y-1">
                <div className="text-[10px] font-mono text-slate-400 uppercase font-bold tracking-wider">
                  True Negative (TN)
                </div>
                <div className="text-2xl font-black font-mono text-slate-200">
                  {counts.TN}
                </div>
                <div className="text-[10px] text-slate-400">
                  Normal footage cleanly processed
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-[11px] text-slate-400 space-y-1">
              <strong className="text-slate-200">Strict Onset Delay Rule:</strong>
              <p>
                An alert fired earlier than the human-labeled crash onset or arriving more than {delay.max_delay_threshold_sec}s late is penalized as a miss (FN).
              </p>
            </div>
          </GlassCard>

          {/* Dev vs Test Splits Table */}
          <GlassCard className="p-5 space-y-3" glowColor="cyan">
            <SectionHeader
              title="Split Comparison: Dev (Tuning) vs Test (Holdout)"
              subtitle="Threshold tuning is strictly confined to 'dev'. 'Test' is reported once as an uncalibrated benchmark."
              icon={<Layers className="w-4 h-4 text-cyan-400" />}
            />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-[11px] text-slate-400 uppercase">
                  <tr>
                    <th className="p-2.5">Split</th>
                    <th className="p-2.5">Clips</th>
                    <th className="p-2.5">TP</th>
                    <th className="p-2.5">FP</th>
                    <th className="p-2.5">FN</th>
                    <th className="p-2.5">Recall</th>
                    <th className="p-2.5">Precision</th>
                    <th className="p-2.5">F1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {report.summary_dev && (
                    <tr>
                      <td className="p-2.5 font-bold text-cyan-300">DEV (Tuning)</td>
                      <td className="p-2.5">{report.summary_dev.summary.total_clips}</td>
                      <td className="p-2.5 text-emerald-400">{report.summary_dev.counts.TP}</td>
                      <td className="p-2.5 text-amber-400">{report.summary_dev.counts.FP}</td>
                      <td className="p-2.5 text-rose-400">{report.summary_dev.counts.FN}</td>
                      <td className="p-2.5">{(report.summary_dev.rates.recall * 100).toFixed(1)}%</td>
                      <td className="p-2.5">{(report.summary_dev.rates.precision * 100).toFixed(1)}%</td>
                      <td className="p-2.5 font-bold text-slate-100">{report.summary_dev.rates.f1_score.toFixed(3)}</td>
                    </tr>
                  )}
                  {report.summary_test && (
                    <tr>
                      <td className="p-2.5 font-bold text-amber-300">TEST (Holdout)</td>
                      <td className="p-2.5">{report.summary_test.summary.total_clips}</td>
                      <td className="p-2.5 text-emerald-400">{report.summary_test.counts.TP}</td>
                      <td className="p-2.5 text-amber-400">{report.summary_test.counts.FP}</td>
                      <td className="p-2.5 text-rose-400">{report.summary_test.counts.FN}</td>
                      <td className="p-2.5">{(report.summary_test.rates.recall * 100).toFixed(1)}%</td>
                      <td className="p-2.5">{(report.summary_test.rates.precision * 100).toFixed(1)}%</td>
                      <td className="p-2.5 font-bold text-slate-100">{report.summary_test.rates.f1_score.toFixed(3)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>

        {/* Right: PR Curve & Per-Condition Breakdown */}
        <div className="space-y-6">
          {/* PR Curve on DEV Split */}
          <GlassCard className="p-5 space-y-4" glowColor="cyan">
            <SectionHeader
              title="Precision-Recall Curve (Dev Split Sweep)"
              subtitle="Sweeping accident confidence threshold from 0.10 to 0.90 to map operating points."
              icon={<Activity className="w-4 h-4 text-cyan-400" />}
            />

            {report.pr_curve_dev && report.pr_curve_dev.length > 0 ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={report.pr_curve_dev} margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="recall"
                      type="number"
                      domain={[0, 1]}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      stroke="#64748b"
                      label={{ value: "Recall", position: "insideBottom", offset: -10, fill: "#94a3b8", fontSize: 11 }}
                    />
                    <YAxis
                      dataKey="precision"
                      type="number"
                      domain={[0, 1]}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                      stroke="#64748b"
                      label={{ value: "Precision", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0b1120", borderColor: "#334155", borderRadius: "0.75rem", fontSize: "11px", color: "#f8fafc" }}
                      formatter={(val: any) => [`${(Number(val) * 100).toFixed(1)}%`]}
                      labelFormatter={(l) => `Recall: ${(Number(l) * 100).toFixed(1)}%`}
                    />
                    <Line
                      type="monotone"
                      dataKey="precision"
                      name="Precision"
                      stroke="#00f0ff"
                      strokeWidth={2}
                      dot={{ fill: "#00f0ff", r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                Insufficient dev split data to calculate PR curve.
              </p>
            )}
          </GlassCard>

          {/* Condition Breakdown */}
          <GlassCard className="p-5 space-y-4" glowColor="cyan">
            <SectionHeader
              title="Performance by Condition Tag"
              subtitle="Recall & Precision breakdown across visual environments (rain, night, dense, etc.)."
              icon={<Sliders className="w-4 h-4 text-cyan-400" />}
            />

            {conditionData.length > 0 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={conditionData} margin={{ top: 10, right: 10, bottom: 20, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="condition" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke="#64748b" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0b1120", borderColor: "#334155", borderRadius: "0.75rem", fontSize: "11px", color: "#f8fafc" }}
                      formatter={(val: any) => [`${val}%`]}
                    />
                    <Bar dataKey="recall" name="Recall %" fill="#00f0ff" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="precision" name="Precision %" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                No condition tags defined in labels.csv.
              </p>
            )}
          </GlassCard>
        </div>
      </div>

      {/* Failure Analysis Gallery */}
      <GlassCard className="p-5 space-y-4" glowColor="cyan">
        <SectionHeader
          title={`Failure Analysis Gallery (${report.failures?.length || 0} Snapshots)`}
          subtitle="Automated frame captures extracted around the alert point for False Alarms (FP) or around the labeled onset for Misses (FN)."
          icon={<AlertTriangle className="w-4 h-4 text-rose-400" />}
        />

        {(!report.failures || report.failures.length === 0) ? (
          <div className="p-8 text-center text-xs text-slate-500 font-mono flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Zero failures observed in this run! Complete agreement with ground truth.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {report.failures.map((f, idx) => {
              const imgUrl = `${import.meta.env.VITE_API_URL || ""}/api/eval/runs/${report.run_id}/failures/${f.image}`;
              const isFP = f.outcome === "FP";
              return (
                <div
                  key={idx}
                  className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden shadow-lg space-y-2 hover:border-slate-700 transition"
                >
                  <div className="aspect-video bg-black relative overflow-hidden">
                    <img
                      src={imgUrl}
                      alt={f.filename}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                    <div className="absolute top-2 left-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border shadow-sm ${
                          isFP
                            ? "bg-amber-950/90 text-amber-300 border-amber-600"
                            : "bg-rose-950/90 text-rose-300 border-rose-600"
                        }`}
                      >
                        {f.outcome}: {isFP ? "False Alarm" : "Missed Crash"}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 space-y-1 text-xs">
                    <div className="font-bold text-slate-200 truncate" title={f.filename}>
                      {f.filename}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      {f.reason}
                    </p>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px] font-mono text-slate-500">
                      <span>Split: {f.split.toUpperCase()}</span>
                      <span>Max Conf: {(f.max_conf * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Limitations Section */}
      <GlassCard className="p-5 space-y-3" glowColor="cyan">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>Evaluation Limitations & Methodological Rules</span>
        </div>
        <ul className="list-disc list-inside space-y-1 text-xs text-slate-400">
          {report.limitations.map((lim, idx) => (
            <li key={idx}>{lim}</li>
          ))}
          <li>
            Confidence intervals calculated via 95% Wilson score formula. Small test clip counts yield wide intervals that shrink as more verified clips are evaluated.
          </li>
          <li>
            Operating point threshold sweeps are reported strictly on the dev split and never overwrite baseline production settings.
          </li>
        </ul>
      </GlassCard>
    </div>
  );
};
