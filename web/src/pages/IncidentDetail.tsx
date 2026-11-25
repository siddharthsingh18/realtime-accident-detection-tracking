import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { IncidentItem, NotificationLogItem } from "../api/types";
import { useSessionStore } from "../store/useSessionStore";
import { GlassCard } from "../components/ui/GlassCard";
import { GlowButton } from "../components/ui/GlowButton";
import {
  Download,
  Share2,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  Play,
  Pause,
  Sliders,
  History,
  HelpCircle,
  Info,
  Bell,
  RefreshCw,
  XCircle,
  CheckCircle2,
  ShieldAlert,
  Activity,
} from "lucide-react";

export const IncidentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addToast = useSessionStore((s) => s.addToast);

  const [incident, setIncident] = useState<IncidentItem | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<NotificationLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Verdict state
  const [verdict, setVerdict] = useState<"true_accident" | "false_alarm" | "unsure" | null>(null);
  const [verdictNote, setVerdictNote] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Video Player Controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [loopWindow, setLoopWindow] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.getIncident(id),
      api.getIncidentAudit(id),
      api.getIncidentNotifications(id).catch(() => []),
    ])
      .then(([inc, audit, notifs]) => {
        setIncident(inc);
        setVerdict(inc.verdict || null);
        setVerdictNote(inc.verdict_note || "");
        setAuditRows(audit);
        setNotifications(notifs || []);
      })
      .catch((e) => console.warn("Failed to load incident detail:", e))
      .finally(() => setLoading(false));
  }, [id]);

  const handleApplyVerdict = async () => {
    if (!id) return;
    try {
      const updated = await api.updateIncidentVerdict(id, verdict, verdictNote);
      setIncident(updated);
      const audit = await api.getIncidentAudit(id);
      setAuditRows(audit);
      setShowConfirmModal(false);
      addToast({
        type: "info",
        title: "Verdict Updated",
        message: `Saved verdict: ${verdict?.replace("_", " ")}`,
      });
    } catch (err) {
      console.error("Failed to save verdict:", err);
    }
  };

  const handleFrameStep = (forward: boolean) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.pause();
    setIsPlaying(false);
    const step = 1.0 / 30.0;
    vid.currentTime = Math.max(0, vid.currentTime + (forward ? step : -step));
  };

  if (loading) {
    return <div className="p-12 text-center text-xs text-slate-500 font-mono">Loading incident data...</div>;
  }

  if (!incident) {
    return (
      <GlassCard className="p-8 text-center space-y-3" glowColor="crimson">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-slate-100">Incident Not Found</h3>
        <button
          onClick={() => navigate("/incidents")}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
        >
          Return to Review Queue
        </button>
      </GlassCard>
    );
  }

  const clipUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/clip`;
  const snapUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/snapshot`;
  const zipUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/evidence.zip`;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Action Header */}
      <GlassCard className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" glowColor="cyan">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/incidents")}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-cyan-400" />
                <span>Incident {incident.id}</span>
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                {incident.camera_id}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Confirmed at: {new Date(incident.confirmed_at).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              addToast({ type: "info", title: "Link Copied", message: "Incident URL copied to clipboard." });
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Copy Link</span>
          </button>

          <a
            href={zipUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Evidence ZIP</span>
          </a>
        </div>
      </GlassCard>

      {/* Main Grid: Video Player & Snapshot (2 Cols) vs Metadata & Verdict (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: Video Player & Snapshot Preview */}
        <div className="lg:col-span-2 space-y-4">
          <GlassCard className="p-4 space-y-3" glowColor="cyan">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span>Synchronized Incident Clip (H.264 Range Stream)</span>
              <span className="font-mono text-cyan-400 text-[11px]">5s Pre-roll • 5s Post-roll</span>
            </div>

            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
              <video
                ref={videoRef}
                src={clipUrl}
                loop={loopWindow}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="w-full h-full object-contain"
              />
            </div>

            {/* Custom Video Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const vid = videoRef.current;
                    if (!vid) return;
                    if (isPlaying) vid.pause();
                    else vid.play();
                  }}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold flex items-center gap-1.5 transition shadow-sm"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                  <span>{isPlaying ? "Pause" : "Play"}</span>
                </button>

                <button
                  onClick={() => handleFrameStep(false)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-mono text-[11px]"
                  title="Step 1 frame backward"
                >
                  -1 frame
                </button>
                <button
                  onClick={() => handleFrameStep(true)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-mono text-[11px]"
                  title="Step 1 frame forward"
                >
                  +1 frame
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Speed selector */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700 font-mono text-[10px]">
                  {[0.25, 0.5, 1.0, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        setPlaybackRate(rate);
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                      }}
                      className={`px-1.5 py-0.5 rounded transition ${
                        playbackRate === rate ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={loopWindow}
                    onChange={(e) => setLoopWindow(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-cyan-500"
                  />
                  <span>Loop Event Window</span>
                </label>
              </div>
            </div>
          </GlassCard>

          {/* Snapshot Preview */}
          <GlassCard className="p-4 space-y-2" glowColor="cyan">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              High-Resolution Crash Moment Snapshot
            </h4>
            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
              <img src={snapUrl} alt="Crash Snapshot" className="w-full h-full object-contain" />
            </div>
          </GlassCard>
        </div>

        {/* Right: Verdict Form, Settings, and Audit Trail */}
        <div className="space-y-4">
          {/* Operator Verdict Form */}
          <GlassCard className="p-4 space-y-3" glowColor="cyan">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Operator Verdict Decision
            </h3>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setVerdict("true_accident")}
                className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                  verdict === "true_accident"
                    ? "bg-red-950 text-red-200 border-red-600 shadow-[0_0_12px_rgba(239,68,68,0.3)] ring-1 ring-red-500"
                    : "bg-slate-800/80 text-slate-400 border-slate-700 hover:text-white"
                }`}
              >
                <CheckCircle className="w-4 h-4 text-red-400" />
                <span>True Crash</span>
              </button>

              <button
                onClick={() => setVerdict("false_alarm")}
                className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                  verdict === "false_alarm"
                    ? "bg-slate-800 text-slate-100 border-slate-500 shadow-md ring-1 ring-slate-400"
                    : "bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white"
                }`}
              >
                <AlertTriangle className="w-4 h-4 text-slate-300" />
                <span>False Alarm</span>
              </button>

              <button
                onClick={() => setVerdict("unsure")}
                className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                  verdict === "unsure"
                    ? "bg-amber-950 text-amber-200 border-amber-600 shadow-[0_0_12px_rgba(245,158,11,0.3)] ring-1 ring-amber-500"
                    : "bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white"
                }`}
              >
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>Unsure</span>
              </button>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Operator Notes / Rationale:</label>
              <textarea
                rows={3}
                value={verdictNote}
                onChange={(e) => setVerdictNote(e.target.value)}
                placeholder="Describe observations (e.g. abrupt stop, brake lock, lane dispute)..."
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <GlowButton
              onClick={() => setShowConfirmModal(true)}
              variant="primary"
              className="w-full py-2 font-bold text-xs"
            >
              Confirm & Save Verdict
            </GlowButton>
          </GlassCard>

          {/* Active Settings Profile & Model Meta */}
          <GlassCard className="p-4 space-y-3 text-xs" glowColor="cyan">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Active Settings During Incident</span>
            </h3>

            <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Accident Conf:</span>
                <span>{incident.settings.accident_conf ?? "0.40"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Vehicle Conf:</span>
                <span>{incident.settings.vehicle_conf ?? "0.35"}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Collision Heuristic:</span>
                <span className={incident.settings.use_collision_heuristic ? "text-emerald-400" : "text-slate-400"}>
                  {incident.settings.use_collision_heuristic ? "ENABLED" : "DISABLED"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Architecture:</span>
                <span>{incident.model_info.accident_model || "YOLOv8s"}</span>
              </div>
            </div>
          </GlassCard>

          {/* Ground-Plane Kinematics & TTC Telemetry */}
          <GlassCard className="p-4 space-y-3 text-xs" glowColor="cyan">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span>Ground-Plane Kinematic Telemetry</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {incident.kinematics?.is_calibrated ? "CALIBRATED" : "UNCALIBRATED"}
              </span>
            </h3>

            {incident.kinematics && incident.kinematics.is_calibrated ? (
              <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-500">Time-to-Collision (TTC):</span>
                  <span className="font-bold text-cyan-300">
                    {incident.kinematics.ttc_s_display || (incident.kinematics.ttc_s ? `${incident.kinematics.ttc_s.toFixed(2)}s` : "inf")}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-500">Peak Deceleration:</span>
                  <span className="font-bold text-amber-300">
                    {incident.kinematics.max_peak_decel_mps2 ? `${incident.kinematics.max_peak_decel_mps2.toFixed(1)} m/s²` : "0.0 m/s²"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-500">Relative Speed Drop:</span>
                  <span className="font-bold text-emerald-300">
                    {incident.kinematics.relative_speed_drop_mps ? `${incident.kinematics.relative_speed_drop_mps.toFixed(1)} m/s` : "0.0 m/s"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-500">Queued Traffic Flag:</span>
                  <span className={incident.kinematics.is_queued_traffic ? "text-amber-400 font-bold" : "text-slate-400"}>
                    {incident.kinematics.is_queued_traffic ? "TRUE (Queue)" : "FALSE (Moving)"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-500">Closing Speed:</span>
                  <span>{incident.kinematics.closing_speed_mps ? `${incident.kinematics.closing_speed_mps.toFixed(1)} m/s` : "N/A"}</span>
                </div>
                {incident.kinematics.summary_reason && (
                  <p className="text-[10px] text-slate-400 italic pt-1">
                    {incident.kinematics.summary_reason}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 italic py-1">
                Kinematics uncalibrated or camera homography matrix not configured. Pixel-based heuristic was utilized.
              </div>
            )}
          </GlassCard>

          {/* Alert Notification Delivery Status */}
          <GlassCard className="p-4 space-y-3 text-xs" glowColor="crimson">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-rose-400" />
                <span>Alert Notification Dispatch</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {notifications.length} delivery records
              </span>
            </h3>

            {notifications.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic py-1">
                No automated alerts logged for this incident (channels not configured or in cooldown).
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((n) => {
                  let badgeClass = "bg-slate-800 text-slate-400 border-slate-700";
                  let Icon = RefreshCw;
                  if (n.status === "sent") {
                    badgeClass = "bg-emerald-950/80 text-emerald-300 border-emerald-800";
                    Icon = CheckCircle2;
                  } else if (n.status === "failed") {
                    badgeClass = "bg-rose-950/80 text-rose-300 border-rose-800";
                    Icon = XCircle;
                  } else if (n.status === "retrying" || n.status === "sending") {
                    badgeClass = "bg-amber-950/80 text-amber-300 border-amber-800 animate-pulse";
                    Icon = RefreshCw;
                  }

                  return (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold uppercase text-slate-200 font-mono text-[11px]">
                            {n.channel}
                          </span>
                          <span
                            className={`flex items-center gap-1 text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${badgeClass}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{n.status}</span>
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Attempts: {n.attempts}/3 • {new Date(n.created_at).toLocaleTimeString()}
                        </div>
                        {n.last_error && (
                          <p className="text-[10px] text-rose-400 font-mono bg-rose-950/40 p-1 rounded mt-1">
                            Error: {n.last_error}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {/* Audit History Log */}
          <GlassCard className="p-4 space-y-3 text-xs" glowColor="cyan">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <History className="w-4 h-4 text-sky-400" />
              <span>Verdict Audit History</span>
            </h3>

            {auditRows.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic py-2">No previous verdict changes.</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {auditRows.map((aud) => (
                  <div key={aud.id} className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 space-y-1">
                    <div className="flex justify-between font-mono text-[10px]">
                      <span className="text-emerald-400 font-bold uppercase">{aud.new_verdict}</span>
                      <span className="text-slate-500">{new Date(aud.changed_at).toLocaleTimeString()}</span>
                    </div>
                    {aud.note && <p className="text-[11px] text-slate-300">{aud.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <GlassCard className="w-full max-w-sm p-5 space-y-4 shadow-2xl" glowColor="cyan">
            <h3 className="text-sm font-bold text-slate-100 uppercase">Confirm Verdict Submission</h3>
            <p className="text-xs text-slate-300">
              Are you sure you want to log verdict <strong>{verdict?.replace("_", " ")}</strong> for incident {incident.id}?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyVerdict}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow-sm"
              >
                Confirm Verdict
              </button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Mandatory Persistent Note */}
      <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
        <Info className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <span>Verdicts are operator opinions and are used only for counts on the Analytics page.</span>
      </div>
    </div>
  );
};
