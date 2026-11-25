import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { SystemStatusResponse, NotificationSettingsResponse } from "../api/types";
import { SettingsSidebar } from "../components/SettingsSidebar";
import {
  Settings,
  HardDrive,
  Key,
  Cpu,
  Bell,
  Send,
  Clock,
} from "lucide-react";

export const SettingsView: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [maxStorageGB, setMaxStorageGB] = useState(5.0);
  const [apiToken, setApiToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [notifSettings, setNotifSettings] = useState<NotificationSettingsResponse | null>(null);
  const [cooldown, setCooldown] = useState(60);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});

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
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl backdrop-blur flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-extrabold uppercase tracking-wide">
              System Configuration & Retention Policies
            </h2>
          </div>
          <p className="text-[11px] text-slate-400">
            Hardware limits, API credentials, evidence retention rules, and master pipeline parameters.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Master Pipeline Parameters */}
        <div>
          <SettingsSidebar />
        </div>

        {/* Right: Evidence Retention & Security */}
        <div className="space-y-6">
          {/* Hardware Concurrency & Resource Status */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs shadow-xl">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>Multi-Camera Concurrency & Load</span>
            </h3>

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

            <div className="p-3 bg-slate-950 rounded-xl text-slate-400 text-[11px] space-y-1">
              <div className="font-bold text-slate-300">Hardware Contention Notice:</div>
              <p>
                The system supports up to 4 concurrent camera sessions. To preserve real-time frame rates and avoid GPU memory exhaustion, a 5th concurrent session is strictly rejected with HTTP 409 Conflict.
              </p>
            </div>
          </div>

          {/* Evidence Storage & Retention Policy */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs shadow-xl">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-sky-400" />
              <span>Evidence Storage & Auto-Pruning</span>
            </h3>

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
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
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
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
              </div>

              <div className="p-2.5 bg-slate-950 rounded-xl text-[11px] text-slate-400">
                Snapshots and H.264 clips in <code className="text-sky-300">data/incidents/</code> older than {retentionDays} days or exceeding {maxStorageGB} GB are auto-pruned.
              </div>
            </div>
          </div>

          {/* Automated Incident Alert Dispatch Channels */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Bell className="w-4 h-4 text-rose-400" />
                <span>Automated Incident Alert Dispatch</span>
              </h3>
              <span className="font-mono text-[10px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                Background Queue
              </span>
            </div>

            {/* Cooldown setting */}
            <div className="p-3 bg-slate-950 rounded-xl space-y-2 border border-slate-800">
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
          </div>

          {/* Security & Optional Bearer Token */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs shadow-xl">
            <h3 className="font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <span>API Authorization Bearer Token</span>
            </h3>

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
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  onClick={handleSaveToken}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs"
                >
                  Save
                </button>
              </div>

              {tokenSaved && (
                <div className="text-[11px] text-emerald-400 font-bold">
                  ✓ Token saved to local storage
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
