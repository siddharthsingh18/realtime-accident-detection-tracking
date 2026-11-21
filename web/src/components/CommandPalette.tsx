import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../store/useSessionStore";
import { Search, Monitor, AlertCircle, BarChart3, GitCompare, Camera, Settings, Eye, Volume2, VolumeX, Moon, Sun } from "lucide-react";

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    toggleOverlay,
    toggleMute,
    isMuted,
    theme,
    setTheme,
    setActiveCameraId,
  } = useSessionStore();

  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const actions = [
    { id: "nav_wall", title: "Go to Live Wall", icon: <Monitor className="w-4 h-4" />, run: () => navigate("/") },
    { id: "nav_review", title: "Go to Review Queue", icon: <AlertCircle className="w-4 h-4" />, run: () => navigate("/incidents") },
    { id: "nav_analytics", title: "Go to Incident Analytics", icon: <BarChart3 className="w-4 h-4" />, run: () => navigate("/analytics") },
    { id: "nav_compare", title: "Go to A/B Comparison", icon: <GitCompare className="w-4 h-4" />, run: () => navigate("/compare") },
    { id: "nav_cameras", title: "Go to Camera Setup", icon: <Camera className="w-4 h-4" />, run: () => navigate("/cameras") },
    { id: "nav_settings", title: "Go to System Settings", icon: <Settings className="w-4 h-4" />, run: () => navigate("/settings") },
    { id: "cam_1", title: "Switch to Camera 01 (North)", icon: <Camera className="w-4 h-4" />, run: () => { setActiveCameraId("cam_01"); navigate("/camera/cam_01"); } },
    { id: "cam_2", title: "Switch to Camera 02 (Highway)", icon: <Camera className="w-4 h-4" />, run: () => { setActiveCameraId("cam_02"); navigate("/camera/cam_02"); } },
    { id: "toggle_mute", title: isMuted ? "Unmute Alarm Chime" : "Mute Alarm Chime", icon: isMuted ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />, run: () => toggleMute() },
    { id: "toggle_trails", title: "Toggle Motion Trails Overlay", icon: <Eye className="w-4 h-4" />, run: () => toggleOverlay("showMotionTrails") },
    { id: "toggle_ghosts", title: "Toggle Ghost Outlines Overlay", icon: <Eye className="w-4 h-4" />, run: () => toggleOverlay("showGhostOutlines") },
    { id: "toggle_theme", title: `Switch Theme (Current: ${theme})`, icon: theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />, run: () => setTheme(theme === "dark" ? "light" : theme === "light" ? "high-contrast" : "dark") },
  ];

  const filtered = actions.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      } else if (e.key === "Escape" && isCommandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div
      onClick={() => setCommandPaletteOpen(false)}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-24 p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center px-4 border-b border-slate-800">
          <Search className="w-5 h-5 text-slate-400 mr-3" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command or jump to screen... (Esc to close)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => (i + 1) % Math.max(1, filtered.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
              } else if (e.key === "Enter" && filtered[selectedIndex]) {
                e.preventDefault();
                filtered[selectedIndex].run();
                setCommandPaletteOpen(false);
              }
            }}
            className="w-full bg-transparent py-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">No matching commands found.</div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => {
                  item.run();
                  setCommandPaletteOpen(false);
                }}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition ${
                  idx === selectedIndex
                    ? "bg-emerald-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {item.icon}
                <span>{item.title}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

