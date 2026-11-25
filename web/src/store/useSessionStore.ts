import { create } from "zustand";
import { PipelineSettings, TelemetryMessage, TelemetryEvent } from "../api/types";
import { DEFAULT_SETTINGS } from "../mock/mockData";

export type SessionStatus = "idle" | "connecting" | "running" | "paused" | "stopping" | "error" | "finished";
export type SourceType = "upload" | "sample1" | "sample2" | "webcam" | "demos";
export type WallLayout = "1" | "2" | "4";
export type DensityMode = "comfortable" | "compact";
export type ThemeMode = "dark" | "light" | "high-contrast";
export type EffectsQuality = "high" | "low" | "off";

export interface ToastItem {
  id: string;
  type: "confirmed" | "cleared" | "info" | "undo";
  title: string;
  message: string;
  cameraId?: string;
  zoneId?: number;
  timestamp: number;
  snapshotUrl?: string;
  undoAction?: () => void;
}

interface SessionState {
  status: SessionStatus;
  source: SourceType;
  uploadedFile: File | null;
  settings: PipelineSettings;
  sessionId: string | null;
  telemetry: TelemetryMessage | null;
  fpsHistory: number[];
  events: TelemetryEvent[];
  error: string | null;
  isMock: boolean;

  // Multi-Camera & Wall Layout
  activeCameraId: string;
  wallLayout: WallLayout;
  tileCameras: string[];
  cameraTelemetry: Record<string, TelemetryMessage>;
  cameraStatus: Record<string, SessionStatus>;

  // Operator Console Preferences
  isMuted: boolean;
  density: DensityMode;
  theme: ThemeMode;
  effectsQuality: EffectsQuality;
  unreviewedCount: number;

  // Vector Overlay Toggles
  showZoneBoxes: boolean;
  showVehicleBoxes: boolean;
  showMotionTrails: boolean;
  showGhostOutlines: boolean;
  showSpeedVectors: boolean;
  showClientBboxOverlay: boolean;

  // UI Modals
  isCommandPaletteOpen: boolean;
  isKeyboardHelpOpen: boolean;
  isAlertDrawerOpen: boolean;
  toasts: ToastItem[];

  // Actions
  setSource: (source: SourceType) => void;
  setUploadedFile: (file: File | null) => void;
  setSettings: (settings: PipelineSettings) => void;
  updateSetting: <K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) => void;
  resetSettings: () => void;
  setStatus: (status: SessionStatus) => void;
  setSessionId: (id: string | null) => void;
  setTelemetry: (msg: TelemetryMessage) => void;
  setCameraTelemetry: (cameraId: string, msg: TelemetryMessage) => void;
  setCameraStatus: (cameraId: string, status: SessionStatus) => void;
  setActiveCameraId: (id: string) => void;
  setWallLayout: (layout: WallLayout) => void;
  setTileCameras: (cams: string[]) => void;
  addEvent: (event: TelemetryEvent) => void;
  clearEvents: () => void;
  setError: (err: string | null) => void;
  setIsMock: (isMock: boolean) => void;
  toggleMute: () => void;
  setDensity: (density: DensityMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setEffectsQuality: (quality: EffectsQuality) => void;
  setUnreviewedCount: (count: number) => void;
  toggleOverlay: (key: "showZoneBoxes" | "showVehicleBoxes" | "showMotionTrails" | "showGhostOutlines" | "showSpeedVectors") => void;
  toggleBboxOverlay: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setKeyboardHelpOpen: (open: boolean) => void;
  setAlertDrawerOpen: (open: boolean) => void;
  addToast: (toast: Omit<ToastItem, "id" | "timestamp">) => void;
  removeToast: (id: string) => void;
  resetSession: () => void;
}

const STORAGE_KEY_SETTINGS = "rad_pipeline_settings";
const STORAGE_KEY_THEME = "rad_theme";
const STORAGE_KEY_DENSITY = "rad_density";
const STORAGE_KEY_MUTED = "rad_muted";
const STORAGE_KEY_EFFECTS = "rad_effects_quality";

function getDefaultEffectsQuality(): EffectsQuality {
  if (typeof window === "undefined") return "high";
  try {
    const saved = localStorage.getItem(STORAGE_KEY_EFFECTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed === "high" || parsed === "low" || parsed === "off") return parsed;
    }
  } catch {}
  if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "off";
  }
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
    return "low";
  }
  return "high";
}

function loadSafe<T>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    if (val !== null) return JSON.parse(val);
  } catch {}
  return fallback;
}

function saveSafe(key: string, val: any) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "idle",
  source: "sample1",
  uploadedFile: null,
  settings: loadSafe(STORAGE_KEY_SETTINGS, DEFAULT_SETTINGS),
  sessionId: null,
  telemetry: null,
  fpsHistory: [],
  events: [],
  error: null,
  isMock: false,

  activeCameraId: "cam_01",
  wallLayout: "2",
  tileCameras: ["cam_01", "cam_02", "cam_03", "cam_04"],
  cameraTelemetry: {},
  cameraStatus: {
    cam_01: "idle",
    cam_02: "idle",
    cam_03: "idle",
    cam_04: "idle",
  },

  isMuted: loadSafe(STORAGE_KEY_MUTED, false),
  density: loadSafe(STORAGE_KEY_DENSITY, "comfortable"),
  theme: loadSafe(STORAGE_KEY_THEME, "dark"),
  effectsQuality: getDefaultEffectsQuality(),
  unreviewedCount: 0,

  showZoneBoxes: true,
  showVehicleBoxes: true,
  showMotionTrails: true,
  showGhostOutlines: true,
  showSpeedVectors: true,
  showClientBboxOverlay: false,

  isCommandPaletteOpen: false,
  isKeyboardHelpOpen: false,
  isAlertDrawerOpen: false,
  toasts: [],

  setSource: (source) => set({ source }),
  setUploadedFile: (uploadedFile) => set({ uploadedFile }),

  setSettings: (settings) => {
    saveSafe(STORAGE_KEY_SETTINGS, settings);
    set({ settings });
  },

  updateSetting: (key, value) => {
    set((state) => {
      const updated = { ...state.settings, [key]: value };
      saveSafe(STORAGE_KEY_SETTINGS, updated);
      return { settings: updated };
    });
  },

  resetSettings: () => {
    saveSafe(STORAGE_KEY_SETTINGS, DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },

  setStatus: (status) => set({ status }),
  setSessionId: (sessionId) => set({ sessionId }),

  setTelemetry: (msg) => {
    set((state) => {
      if (!msg) {
        return { telemetry: null };
      }
      const nextFpsHistory = [...state.fpsHistory, msg.fps].slice(-30);
      let nextEvents = state.events;
      if (msg.events && msg.events.length > 0) {
        nextEvents = [...msg.events, ...state.events].slice(0, 200);
      }
      return {
        telemetry: msg,
        fpsHistory: nextFpsHistory,
        events: nextEvents,
        cameraTelemetry: {
          ...state.cameraTelemetry,
          [msg.camera_id || "cam_01"]: msg,
        },
      };
    });
  },

  setCameraTelemetry: (cameraId, msg) => {
    set((state) => ({
      cameraTelemetry: {
        ...state.cameraTelemetry,
        [cameraId]: msg,
      },
    }));
  },

  setCameraStatus: (cameraId, status) => {
    set((state) => ({
      cameraStatus: {
        ...state.cameraStatus,
        [cameraId]: status,
      },
    }));
  },

  setActiveCameraId: (activeCameraId) => set({ activeCameraId }),
  setWallLayout: (wallLayout) => set({ wallLayout }),
  setTileCameras: (tileCameras) => set({ tileCameras }),

  addEvent: (event) => set((state) => ({ events: [event, ...state.events].slice(0, 200) })),
  clearEvents: () => set({ events: [] }),

  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  setIsMock: (isMock) => set({ isMock }),

  toggleMute: () => {
    set((state) => {
      const next = !state.isMuted;
      saveSafe(STORAGE_KEY_MUTED, next);
      return { isMuted: next };
    });
  },

  setDensity: (density) => {
    saveSafe(STORAGE_KEY_DENSITY, density);
    set({ density });
  },

  setTheme: (theme) => {
    saveSafe(STORAGE_KEY_THEME, theme);
    set({ theme });
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      saveSafe(STORAGE_KEY_THEME, next);
      return { theme: next };
    });
  },

  setEffectsQuality: (effectsQuality) => {
    saveSafe(STORAGE_KEY_EFFECTS, effectsQuality);
    set({ effectsQuality });
  },

  setUnreviewedCount: (unreviewedCount) => set({ unreviewedCount }),

  toggleOverlay: (key) => set((state) => ({ [key]: !state[key] })),
  toggleBboxOverlay: () => set((state) => ({ showClientBboxOverlay: !state.showClientBboxOverlay })),

  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  setKeyboardHelpOpen: (isKeyboardHelpOpen) => set({ isKeyboardHelpOpen }),
  setAlertDrawerOpen: (isAlertDrawerOpen) => set({ isAlertDrawerOpen }),

  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    const newToast: ToastItem = { ...toast, id, timestamp: Date.now() };
    set((state) => ({ toasts: [newToast, ...state.toasts].slice(0, 5) }));

    // Auto dismiss after 7s (or 10s for undo)
    const timeout = toast.type === "undo" ? 10000 : 7000;
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, timeout);
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  resetSession: () => set({
    status: "idle",
    sessionId: null,
    telemetry: null,
    fpsHistory: [],
    error: null,
  }),
}));

if (typeof window !== "undefined") {
  (window as any).useSessionStore = useSessionStore;
}
