import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { IncidentItem } from "../api/types";
import { useSessionStore } from "../store/useSessionStore";
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
} from "lucide-react";

export const IncidentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useSessionStore();

  const [incident, setIncident] = useState<IncidentItem | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
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
    Promise.all([api.getIncident(id), api.getIncidentAudit(id)])
      .then(([inc, audit]) => {
        setIncident(inc);
        setVerdict(inc.verdict || null);
        setVerdictNote(inc.verdict_note || "");
        setAuditRows(audit);
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
      <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
        <h3 className="text-base font-bold text-slate-100">Incident Not Found</h3>
        <button
          onClick={() => navigate("/incidents")}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs"
        >
          Return to Review Queue
        </button>
      </div>
    );
  }

  const clipUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/clip`;
  const snapUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/snapshot`;
  const zipUrl = `${import.meta.env.VITE_API_URL || ""}/api/incidents/${incident.id}/evidence.zip`;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Action Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-4 rounded-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/incidents")}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold uppercase tracking-wide">
                Incident {incident.id}
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Copy Link</span>
          </button>

          <a
            href={zipUrl}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Evidence ZIP</span>
          </a>
        </div>
      </div>

      {/* Main Grid: Video Player & Snapshot (2 Cols) vs Metadata & Verdict (1 Col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: Video Player & Snapshot Preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-4 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between">
              <span>Synchronized Incident Clip (H.264 Range Stream)</span>
              <span className="font-mono text-emerald-400 text-[11px]">5s Pre-roll • 5s Post-roll</span>
            </div>

            <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
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
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold flex items-center gap-1.5"
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
                <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 font-mono text-[10px]">
                  {[0.25, 0.5, 1.0, 2.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => {
                        setPlaybackRate(rate);
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                      }}
                      className={`px-1.5 py-0.5 rounded ${
                        playbackRate === rate ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
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
                    className="rounded border-slate-700 bg-slate-800 text-emerald-500"
                  />
                  <span>Loop Event Window</span>
                </label>
              </div>
            </div>
          </div>

          {/* Snapshot Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              High-Resolution Crash Moment Snapshot
            </h4>
            <div className="aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
              <img src={snapUrl} alt="Crash Snapshot" className="w-full h-full object-contain" />
            </div>
          </div>
        </div>

        {/* Right: Verdict Form, Settings, and Audit Trail */}
        <div className="space-y-4">
          {/* Operator Verdict Form */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3 backdrop-blur shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Operator Verdict Decision
            </h3>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setVerdict("true_accident")}
                className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                  verdict === "true_accident"
                    ? "bg-red-950 text-red-200 border-red-600 shadow-md ring-1 ring-red-500"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
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
                    ? "bg-amber-950 text-amber-200 border-amber-600 shadow-md ring-1 ring-amber-500"
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
                className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
              />
            </div>

            <button
              onClick={() => setShowConfirmModal(true)}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md transition"
            >
              Confirm & Save Verdict
            </button>
          </div>

          {/* Active Settings Profile & Model Meta */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-emerald-400" />
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
          </div>

          {/* Audit History Log */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <History className="w-4 h-4 text-sky-400" />
              <span>Verdict Audit History</span>
            </h3>

            {auditRows.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic py-2">No previous verdict changes.</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {auditRows.map((aud) => (
                  <div key={aud.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                    <div className="flex justify-between font-mono text-[10px]">
                      <span className="text-emerald-400 font-bold uppercase">{aud.new_verdict}</span>
                      <span className="text-slate-500">{new Date(aud.changed_at).toLocaleTimeString()}</span>
                    </div>
                    {aud.note && <p className="text-[11px] text-slate-300">{aud.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-4">
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
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Confirm Verdict
              </button>
            </div>
          </div>
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
