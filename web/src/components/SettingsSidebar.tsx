import React, { useState } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { Sliders, RotateCcw, ChevronDown, ChevronUp, Cpu, ShieldCheck } from "lucide-react";
import { PipelineSettings } from "../api/types";

interface Props {
  onLiveSettingsChange?: (settings: Partial<PipelineSettings>) => void;
  availableDevice?: string;
}

export const SettingsSidebar: React.FC<Props> = ({
  onLiveSettingsChange,
  availableDevice = "auto",
}) => {
  const { settings, updateSetting, resetSettings, status } = useSessionStore(
    useShallow((s) => ({
      settings: s.settings,
      updateSetting: s.updateSetting,
      resetSettings: s.resetSettings,
      status: s.status,
    }))
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isRunning = status === "running" || status === "paused";

  const handleSliderChange = <K extends keyof PipelineSettings>(
    key: K,
    val: PipelineSettings[K]
  ) => {
    updateSetting(key, val);
    if (isRunning && onLiveSettingsChange) {
      onLiveSettingsChange({ [key]: val });
    }
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 space-y-5 shadow-lg">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Pipeline Parameters
          </h3>
        </div>
        <button
          onClick={resetSettings}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 transition"
          title="Reset to project defaults"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Primary Thresholds */}
      <div className="space-y-4">
        {/* Accident Confidence */}
        <div>
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-slate-300 font-medium">Accident Confidence</span>
            <span className="font-mono font-bold text-emerald-400">
              {settings.accident_conf.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0.05"
            max="0.95"
            step="0.01"
            value={settings.accident_conf}
            onChange={(e) =>
              handleSliderChange("accident_conf", parseFloat(e.target.value))
            }
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <span className="text-[10px] text-slate-400">
            Min probability for YOLOv8 crash detection (0.05 - 0.95)
          </span>
        </div>

        {/* Vehicle Confidence */}
        <div>
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-slate-300 font-medium">Vehicle Confidence</span>
            <span className="font-mono font-bold text-blue-400">
              {settings.vehicle_conf.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0.05"
            max="0.95"
            step="0.01"
            value={settings.vehicle_conf}
            onChange={(e) =>
              handleSliderChange("vehicle_conf", parseFloat(e.target.value))
            }
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-[10px] text-slate-400">
            Min score for vehicle tracker inputs (0.05 - 0.95)
          </span>
        </div>

        {/* Collision Heuristic Toggle */}
        <div className="pt-2 border-t border-slate-800/80">
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-slate-200">
                Kinematic Collision Heuristic
              </div>
              <div className="text-[10px] text-slate-400">
                Requires sustained overlap + sharp deceleration before flagging crash
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.use_collision_heuristic}
              onChange={(e) =>
                handleSliderChange("use_collision_heuristic", e.target.checked)
              }
              className="mt-0.5 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500 h-4 w-4"
            />
          </label>
        </div>
      </div>

      {/* Advanced Collapsible Section */}
      <div className="pt-2 border-t border-slate-800">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between text-xs font-bold text-slate-300 hover:text-white transition"
        >
          <span>Advanced Timing & Containment</span>
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-4 pt-2">
            {/* Containment Threshold */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-slate-400">Containment Threshold</span>
                <span className="font-mono text-slate-200">
                  {settings.containment_threshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="1.00"
                step="0.05"
                value={settings.containment_threshold}
                onChange={(e) =>
                  handleSliderChange(
                    "containment_threshold",
                    parseFloat(e.target.value)
                  )
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            {/* Confirm Seconds */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-slate-400">Confirmation Window</span>
                <span className="font-mono text-slate-200">
                  {settings.confirm_seconds.toFixed(2)} s
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.50"
                step="0.01"
                value={settings.confirm_seconds}
                onChange={(e) =>
                  handleSliderChange("confirm_seconds", parseFloat(e.target.value))
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-[10px] text-slate-400">
                Duration to confirm TENTATIVE → ACTIVE
              </span>
            </div>

            {/* Persistence Timeout */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-slate-400">Persistence Timeout</span>
                <span className="font-mono text-slate-200">
                  {settings.persistence_seconds.toFixed(2)} s
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="3.00"
                step="0.05"
                value={settings.persistence_seconds}
                onChange={(e) =>
                  handleSliderChange(
                    "persistence_seconds",
                    parseFloat(e.target.value)
                  )
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <span className="text-[10px] text-slate-400">
                Duration MAINTAINED zone survives without detection
              </span>
            </div>

            {/* Tentative Grace */}
            <div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-slate-400">Tentative Grace</span>
                <span className="font-mono text-slate-200">
                  {settings.tentative_grace_seconds.toFixed(2)} s
                </span>
              </div>
              <input
                type="range"
                min="0.02"
                max="0.50"
                step="0.01"
                value={settings.tentative_grace_seconds}
                onChange={(e) =>
                  handleSliderChange(
                    "tentative_grace_seconds",
                    parseFloat(e.target.value)
                  )
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            {/* Device Selector */}
            <div className="pt-2">
              <label className="text-xs text-slate-400 flex items-center gap-1.5 mb-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-300" />
                <span>Compute Device</span>
              </label>
              <select
                value={settings.device}
                onChange={(e) => handleSliderChange("device", e.target.value as any)}
                disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
              >
                <option value="auto">Auto (Detected: {availableDevice})</option>
                <option value="cpu">CPU</option>
                <option value="mps">Apple Silicon MPS</option>
                <option value="cuda">NVIDIA CUDA</option>
              </select>
              {isRunning && (
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Device changes take effect on next session launch.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 text-[10px] text-slate-400 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        <span>Settings auto-persisted to browser storage</span>
      </div>
    </div>
  );
};

