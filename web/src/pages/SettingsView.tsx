import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { SystemStatusResponse } from "../api/types";
import { SettingsSidebar } from "../components/SettingsSidebar";
import {
  Settings,
  HardDrive,
  Key,
  Cpu,
} from "lucide-react";

export const SettingsView: React.FC = () => {
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [maxStorageGB, setMaxStorageGB] = useState(5.0);
  const [apiToken, setApiToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);

  useEffect(() => {
    api
      .getSystemStatus()
      .then((data) => setSystemStatus(data))
      .catch((e) => console.warn("Failed to load system status:", e));

    const savedToken = localStorage.getItem("rad_api_token");
    if (savedToken) setApiToken(savedToken);
  }, []);

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
