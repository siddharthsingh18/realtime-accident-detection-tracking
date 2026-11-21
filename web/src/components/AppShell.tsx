import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../store/useSessionStore";
import { api } from "../api/client";
import { playAlertChime } from "../utils/audio";
import { showSystemNotification } from "../utils/notifications";

import {
  Monitor,
  Eye,
  AlertCircle,
  BarChart3,
  GitCompare,
  Camera,
  Settings,
  Bell,
  Volume2,
  VolumeX,
  Moon,
  Sun,
  Shield,
  Sparkles,
  Command,
  HelpCircle,
  Clock,
  Cpu,
} from "lucide-react";

import { AlertDrawer } from "./AlertDrawer";
import { ToastContainer } from "./ToastContainer";
import { CommandPalette } from "./CommandPalette";
import { KeyboardHelpModal } from "./KeyboardHelpModal";

export const AppShell: React.FC = () => {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const {
    theme,
    setTheme,
    density,
    isMuted,
    toggleMute,
    isMock,
    setIsMock,
    unreviewedCount,
    setUnreviewedCount,
    setAlertDrawerOpen,
    setCommandPaletteOpen,
    setKeyboardHelpOpen,
    addToast,
    activeCameraId,
  } = useSessionStore();

  const [utcTime, setUtcTime] = useState("");
  const [localTime, setLocalTime] = useState("");
  const [systemInfo, setSystemInfo] = useState<{ device: string; active_sessions: number } | null>(null);

  // Update clocks every second
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().slice(17, 25) + " UTC");
      setLocalTime(now.toLocaleTimeString() + " Local");
    };
    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll system health & unreviewed incidents count
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const sys = await api.getSystemStatus();
        setSystemInfo({ device: sys.device, active_sessions: sys.active_sessions });
        const incs = await api.getIncidents({ verdict: "unreviewed", limit: 1 });
        setUnreviewedCount(incs.total);
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, [setUnreviewedCount]);

  // Connect to SSE alert stream across all cameras
  useEffect(() => {
    const sseUrl = `${import.meta.env.VITE_API_URL || ""}/api/alerts/stream`;
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(sseUrl);
      eventSource.addEventListener("confirmed", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          // Play WebAudio alarm chime
          playAlertChime(isMuted);

          // Trigger toast
          addToast({
            type: "confirmed",
            title: `Accident Confirmed [${data.camera_id || "Camera"}]`,
            message: `Hazard zone #${data.zone_id} sustained confirmation hits.`,
            cameraId: data.camera_id,
            zoneId: data.zone_id,
          });

          // System notification
          showSystemNotification(
            `ALERT: Accident on ${data.camera_id || "Camera"}`,
            `Hazard confirmed in Zone #${data.zone_id}`
          );

          setUnreviewedCount(unreviewedCount + 1);
        } catch {}
      });
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [isMuted, unreviewedCount, addToast, setUnreviewedCount]);

  const navItems = [
    { to: "/", label: t("nav.live_wall"), icon: <Monitor className="w-4 h-4" /> },
    { to: `/camera/${activeCameraId}`, label: t("nav.focus_view"), icon: <Eye className="w-4 h-4" /> },
    { to: "/incidents", label: t("nav.review_queue"), icon: <AlertCircle className="w-4 h-4" /> },
    { to: "/analytics", label: t("nav.analytics"), icon: <BarChart3 className="w-4 h-4" /> },
    { to: "/compare", label: t("nav.compare"), icon: <GitCompare className="w-4 h-4" /> },
    { to: "/cameras", label: t("nav.cameras"), icon: <Camera className="w-4 h-4" /> },
    { to: "/settings", label: t("nav.settings"), icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col font-sans transition-colors duration-200 ${
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : theme === "high-contrast"
          ? "bg-black text-white"
          : "bg-slate-100 text-slate-900"
      }`}
    >
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-3 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-md">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs sm:text-sm font-extrabold tracking-tight uppercase">
                {t("app_title")}
              </h1>
              {isMock && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider bg-amber-950 text-amber-300 border border-amber-600 animate-pulse">
                  MOCK DATA
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 hidden md:block">
              {t("app_subtitle")}
            </p>
          </div>
        </div>

        {/* Global Controls & Tools */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs">
          {/* Command Palette Trigger */}
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition"
            title="Open Command Palette (⌘K)"
          >
            <Command className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-mono">⌘K</span>
          </button>

          {/* Keyboard Map Trigger */}
          <button
            onClick={() => setKeyboardHelpOpen(true)}
            className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition"
            title="Keyboard Shortcuts Map (?)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Alert Bell */}
          <button
            onClick={() => setAlertDrawerOpen(true)}
            className="relative p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition"
            title="Open Unreviewed Alerts Drawer"
          >
            <Bell className="w-4 h-4" />
            {unreviewedCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white font-mono text-[9px] font-black flex items-center justify-center animate-pulse">
                {unreviewedCount > 9 ? "9+" : unreviewedCount}
              </span>
            )}
          </button>

          {/* Audio Chime Mute */}
          <button
            onClick={toggleMute}
            className={`p-1.5 rounded-lg border transition ${
              isMuted
                ? "bg-slate-800 text-slate-500 border-slate-700"
                : "bg-emerald-950/60 text-emerald-300 border-emerald-700"
            }`}
            title={isMuted ? "Alarm sound is muted" : "Alarm sound is active"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Mock Mode Toggle */}
          <button
            onClick={() => setIsMock(!isMock)}
            className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
              isMock
                ? "bg-amber-950 text-amber-300 border-amber-600"
                : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
            }`}
            title="Toggle Standalone Mock Mode"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>

          {/* Language Toggle */}
          <button
            onClick={() => i18n.changeLanguage(i18n.language === "en" ? "hi" : "en")}
            className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800 text-[11px] font-bold text-slate-300 hover:text-white"
            title="Toggle Language (English / Hindi)"
          >
            {i18n.language === "en" ? "हिन्दी" : "EN"}
          </button>

          {/* Theme Selector */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "high-contrast" : "dark")}
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
            title={`Current theme: ${theme}. Click to switch.`}
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </header>

      {/* Main Body with Left Nav & Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Navigation */}
        <aside className="w-14 sm:w-56 border-r border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col justify-between py-3 px-2 sm:px-3">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to || (item.to.startsWith("/camera") && location.pathname.startsWith("/camera"));
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  {item.icon}
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="hidden sm:block p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[10px] text-slate-500 font-mono">
            <div>Fixed CCTV Operator View</div>
            <div className="text-slate-400 font-bold mt-0.5">Press ? for keys</div>
          </div>
        </aside>

        {/* Content View */}
        <main className={`flex-1 overflow-y-auto ${density === "compact" ? "p-2 sm:p-4" : "p-4 sm:p-6"}`}>
          <Outlet />
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="border-t border-slate-800 bg-slate-900/90 py-1.5 px-4 text-[11px] font-mono text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span>Device: <span className="uppercase font-bold text-white">{systemInfo?.device || "auto"}</span></span>
          </div>
          <span>•</span>
          <div>Active Concurrency: <span className="text-white font-bold">{systemInfo?.active_sessions || 0}/4</span></div>
          <span>•</span>
          <div className="text-slate-500 hidden md:block">
            {t("disclaimer")}
          </div>
        </div>

        <div className="flex items-center gap-3 text-slate-400">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>{utcTime}</span>
          </div>
          <span>•</span>
          <span>{localTime}</span>
        </div>
      </footer>

      {/* Global Modals & Notifications */}
      <ToastContainer />
      <AlertDrawer />
      <CommandPalette />
      <KeyboardHelpModal />
    </div>
  );
};
