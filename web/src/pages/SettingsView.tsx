import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { SystemStatusResponse, NotificationSettingsResponse } from "../api/types";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { useSessionStore } from "../store/useSessionStore";
import { GlassCard } from "../components/ui/GlassCard";
import { GlowButton } from "../components/ui/GlowButton";
import { SectionHeader } from "../components/ui/SectionHeader";
import { StatusPill } from "../components/ui/StatusPill";
import {
  Settings,
  HardDrive,
  Key,
  Cpu,
  Bell,
  Send,
  Clock,
  Sparkles,
  Zap,
  Gauge,
  Eye,
} from "lucide-react";

export const SettingsView: React.FC = () => {
  const effectsQuality = useSessionStore((s) => s.effectsQuality);
  const setEffectsQuality = useSessionStore((s) => s.setEffectsQuality);
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [maxStorageGB, setMaxStorageGB] = useState(5.0);
  const [apiToken, setApiToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [notifSettings, setNotifSettings] = useState<NotificationSettingsResponse | null>(null);
  const [cooldown, setCooldown] = useState(60);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});

  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    api
      .getSystemStatus()
      .then((data) => setSystemStatus(data))
      .catch((e) => console.warn("Failed to load system status:", e));

    api
      .getNotificationSettings()
      .then((data) => {
        setNotifSettings(data);
        if (data?.cooldown_seconds) setCooldown(data.cooldown_seconds);
      })
      .catch((e) => console.warn("Failed to load notification settings:", e));

    const savedToken = localStorage.getItem("rad_api_token");
    if (savedToken) setApiToken(savedToken);
  }, []);

  const handleSaveCooldown = async () => {
    try {
      await api.updateNotificationSettings({ cooldown_seconds: cooldown });
      setTestStatus((prev) => ({ ...prev, cooldown: "Saved cooldown window!" }));
      setTimeout(() => setTestStatus((prev) => ({ ...prev, cooldown: "" })), 3000);
    } catch (e) {
      console.error("Failed to update cooldown:", e);
    }
  };

  const handleSendTestAlert = async (channel: string) => {
    setTestStatus((prev) => ({ ...prev, [channel]: "Sending test alert..." }));
    try {
      const res = await api.sendTestNotification(channel);
      setTestStatus((prev) => ({ ...prev, [channel]: res.message || "Test alert enqueued!" }));
      setTimeout(() => setTestStatus((prev) => ({ ...prev, [channel]: "" })), 4000);
    } catch (e: any) {
      setTestStatus((prev) => ({ ...prev, [channel]: `Error: ${e.message || "Failed"}` }));
    }
  };

  const handleSaveToken = () => {
    if (apiToken.trim()) {
      localStorage.setItem("rad_api_token", apiToken.trim());
    } else {
      localStorage.removeItem("rad_api_token");
    }
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <GlassCard className="p-4 flex items-center justify-between" glowColor="cyan">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-100">
              System Configuration & Control Center Settings
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Hardware limits, visual rendering budget, evidence retention rules, and master pipeline parameters.
          </p>
        </div>
        <StatusPill status="online" label="Engine Online" pulse />
      </GlassCard>

      {/* Visual Effects & GPU Rendering Budget */}
      <GlassCard className="p-5 space-y-4" glowColor="cyan">
        <SectionHeader
          title="Visual Effects & GPU Rendering Budget"
          subtitle="Strict performance budget controls: toggle 3D scene, ambient light mesh, and cursor spotlight to protect video throughput."
          icon={<Sparkles className="w-4 h-4 text-cyan-400" />}
          badge={`FX: ${effectsQuality.toUpperCase()}`}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => setEffectsQuality("high")}
            className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden ${
              effectsQuality === "high"
                ? "bg-cyan-950/40 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400"
                : "bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-xs uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> High (Cinematic)
              </span>
              {effectsQuality === "high" && (
                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#06b6d4]" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Interactive 3D low-poly traffic scene, dynamic ambient mesh blobs, pointer spotlight, and neon edge glow.
            </p>
          </button>

          <button
            onClick={() => setEffectsQuality("low")}
            className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden ${
              effectsQuality === "low"
                ? "bg-amber-950/40 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)] ring-1 ring-amber-400"
                : "bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-xs uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Low (Balanced)
              </span>
              {effectsQuality === "low" && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b]" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              2D schematic hero fallback, static ambient gradient, limited blur backdrops. Ideal for laptops.
            </p>
          </button>

          <button
            onClick={() => setEffectsQuality("off")}
            className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden ${
              effectsQuality === "off"
                ? "bg-emerald-950/40 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] ring-1 ring-emerald-400"
                : "bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-xs uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" /> Off (Zero WebGL)
              </span>
              {effectsQuality === "off" && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Flat solid panels, zero 3D/canvas effects, no pointer spotlight. Minimal battery & CPU consumption.
            </p>
          </button>
        </div>

        {/* Telemetry and Hardware Environment */}
        <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-3 text-slate-400">
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Detected CPU Cores: <strong className="text-slate-200 font-mono">{cores}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-amber-400" />
            <span>Reduced Motion Preference: <strong className="text-slate-200 font-mono">{prefersReduced ? "Active (Reduced)" : "Standard"}</strong></span>
          </div>
          <div className="text-slate-500 text-[10px] font-mono">
            Auto-throttles to 30 FPS when visible; completely halts when tab is backgrounded.
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Master Pipeline Parameters */}
        <div>
          <SettingsSidebar />
        </div>

        {/* Right: Evidence Retention & Security */}
        <div className="space-y-6">
          {/* Hardware Concurrency & Resource Status */}
          <GlassCard className="p-5 space-y-3 text-xs" glowColor="cyan">
            <SectionHeader
              title="Multi-Camera Concurrency & Load"
              icon={<Cpu className="w-4 h-4 text-emerald-400" />}
            />

            <div className="space-y-2 font-mono text-[11px] text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Active Sessions:</span>
                <span className="text-emerald-400 font-bold">
                  {systemStatus?.active_sessions || 0} / {systemStatus?.max_concurrent_sessions || 4}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-500">Inference Device:</span>
                <span className="uppercase">{systemStatus?.device || "auto"}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-950/80 rounded-xl text-slate-400 text-[11px] space-y-1 border border-slate-800/80">
              <div className="font-bold text-slate-300">Hardware Contention Notice:</div>
              <p>
                The system supports up to 4 concurrent camera sessions. To preserve real-time frame rates and avoid GPU memory exhaustion, a 5th concurrent session is strictly rejected with HTTP 409 Conflict.
              </p>
            </div>
          </GlassCard>

          {/* Evidence Storage & Retention Policy */}
          <GlassCard className="p-5 space-y-3 text-xs" glowColor="cyan">
            <SectionHeader
              title="Evidence Storage & Auto-Pruning"
              icon={<HardDrive className="w-4 h-4 text-sky-400" />}
            />

            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Retention Window (Days):</span>
                  <span className="font-mono text-white font-bold">{retentionDays} days</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="90"
                  step="1"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                  <span>Max Disk Storage Cap (GB):</span>
                  <span className="font-mono text-white font-bold">{maxStorageGB.toFixed(1)} GB</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="20.0"
                  step="0.5"
                  value={maxStorageGB}
                  onChange={(e) => setMaxStorageGB(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              <div className="p-2.5 bg-slate-950/80 rounded-xl text-[11px] text-slate-400 border border-slate-800/80">
                Snapshots and H.264 clips in <code className="text-cyan-300">data/incidents/</code> older than {retentionDays} days or exceeding {maxStorageGB} GB are auto-pruned.
              </div>
            </div>
          </GlassCard>

          {/* Automated Incident Alert Dispatch Channels */}
          <GlassCard className="p-5 space-y-4 text-xs" glowColor="crimson">
            <div className="flex items-center justify-between">
              <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Bell className="w-4 h-4 text-rose-400" />
                <span>Automated Incident Alert Dispatch</span>
              </h3>
              <span className="font-mono text-[10px] text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                Background Queue
              </span>
            </div>

            {/* Cooldown setting */}
            <div className="p-3 bg-slate-950/80 rounded-xl space-y-2 border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Per-Camera Cooldown Window</span>
                </span>
                <span className="font-mono text-emerald-400 font-bold">{cooldown}s</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Minimum delay between alerts from the same camera to prevent crash spam.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="10"
                  max="300"
                  step="5"
                  value={cooldown}
                  onChange={(e) => setCooldown(parseInt(e.target.value, 10))}
                  className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
                <button
                  onClick={handleSaveCooldown}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-xs"
                >
                  Save Cooldown
                </button>
              </div>
              {testStatus.cooldown && (
                <div className="text-[11px] text-emerald-400 font-bold">
                  ✓ {testStatus.cooldown}
                </div>
              )}
            </div>

            {/* Channels List */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Notification Channels & Test Triggers
              </div>

              {[
                {
                  id: "telegram",
                  name: "Telegram Bot",
                  envHelp: "TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID",
                },
                {
                  id: "slack",
                  name: "Slack Webhook",
                  envHelp: "SLACK_WEBHOOK_URL",
                },
                {
                  id: "webhook",
                  name: "Generic JSON Webhook",
                  envHelp: "GENERIC_WEBHOOK_URL & GENERIC_WEBHOOK_SECRET",
                },
                {
                  id: "email",
                  name: "SMTP Email",
                  envHelp: "SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_TO",
                },
              ].map((ch) => {
                const info = notifSettings?.channels?.[ch.id];
                const isConfigured = info?.configured;
                const statusMsg = testStatus[ch.id];

                return (
                  <div
                    key={ch.id}
                    className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">{ch.name}</span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            isConfigured
                              ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
                              : "bg-slate-800 text-slate-400 border-slate-700"
                          }`}
                        >
                          {isConfigured ? "Configured in .env" : "Not Configured"}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                        Env: {ch.envHelp}
                      </p>
                      {statusMsg && (
                        <p className="text-[11px] font-semibold text-rose-300 mt-1">
                          {statusMsg}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => handleSendTestAlert(ch.id)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-slate-200 font-semibold rounded-lg text-xs transition"
                    >
                      <Send className="w-3 h-3 text-rose-400" />
                      <span>Send Test Alert</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          {/* Security & Optional Bearer Token */}
          <GlassCard className="p-5 space-y-3 text-xs" glowColor="cyan">
            <SectionHeader
              title="API Authorization Bearer Token"
              icon={<Key className="w-4 h-4 text-amber-400" />}
            />

            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">
                If the backend is launched with <code className="text-amber-300">API_TOKEN</code> configured, enter your bearer token here. Left blank by default in local dev.
              </p>

              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder="Enter API Bearer Token..."
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <GlowButton
                  onClick={handleSaveToken}
                  variant="primary"
                  className="px-4 py-2 font-bold text-xs"
                >
                  Save
                </GlowButton>
              </div>

              {tokenSaved && (
                <div className="text-[11px] text-emerald-400 font-bold">
                  ✓ Token saved to local storage
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
};
