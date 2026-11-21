import { create } from "zustand";
import { PipelineSettings, TelemetryMessage, TelemetryEvent } from "../api/types";
import { DEFAULT_SETTINGS } from "../mock/mockData";

export type SessionStatus = "idle" | "connecting" | "running" | "paused" | "stopping" | "error" | "finished";
export type SourceType = "upload" | "sample1" | "sample2" | "webcam" | "demos";

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
  showClientBboxOverlay: boolean;
  theme: "dark" | "light";

  // Actions
  setSource: (source: SourceType) => void;
  setUploadedFile: (file: File | null) => void;
  setSettings: (settings: PipelineSettings) => void;
  updateSetting: <K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) => void;
  resetSettings: () => void;
  setStatus: (status: SessionStatus) => void;
  setSessionId: (id: string | null) => void;
  setTelemetry: (msg: TelemetryMessage) => void;
  addEvent: (event: TelemetryEvent) => void;
  clearEvents: () => void;
  setError: (err: string | null) => void;
  setIsMock: (isMock: boolean) => void;
  toggleBboxOverlay: () => void;
  toggleTheme: () => void;
  resetSession: () => void;
}

const STORAGE_KEY_SETTINGS = "rad_pipeline_settings";
const STORAGE_KEY_THEME = "rad_theme";

function loadSavedSettings(): PipelineSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {
    // localStorage not accessible
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: PipelineSettings) {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function loadSavedTheme(): "dark" | "light" {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_THEME);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  return "dark";
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "idle",
  source: "sample1",
  uploadedFile: null,
  settings: loadSavedSettings(),
  sessionId: null,
  telemetry: null,
  fpsHistory: [],
  events: [],
  error: null,
  isMock: false,
  showClientBboxOverlay: false,
  theme: loadSavedTheme(),

  setSource: (source) => set({ source }),
  setUploadedFile: (uploadedFile) => set({ uploadedFile }),

  setSettings: (settings) => {
    saveSettings(settings);
    set({ settings });
  },

  updateSetting: (key, value) => {
    set((state) => {
      const updated = { ...state.settings, [key]: value };
      saveSettings(updated);
      return { settings: updated };
    });
  },

  resetSettings: () => {
    saveSettings(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },

  setStatus: (status) => set({ status }),
  setSessionId: (sessionId) => set({ sessionId }),

  setTelemetry: (msg) => {
    set((state) => {
      // Append FPS to history (last 30 frames)
      const nextFpsHistory = [...state.fpsHistory, msg.fps].slice(-30);

      // Collect new events if any
      let nextEvents = state.events;
      if (msg.events && msg.events.length > 0) {
        // Prepend new events, keep max 200
        nextEvents = [...msg.events, ...state.events].slice(0, 200);
      }

      return {
        telemetry: msg,
        fpsHistory: nextFpsHistory,
        events: nextEvents,
      };
    });
  },

  addEvent: (event) => {
    set((state) => ({
      events: [event, ...state.events].slice(0, 200),
    }));
  },

  clearEvents: () => set({ events: [] }),

  setError: (error) => set({ error, status: error ? "error" : "idle" }),

  setIsMock: (isMock) => set({ isMock }),

  toggleBboxOverlay: () => set((state) => ({ showClientBboxOverlay: !state.showClientBboxOverlay })),

  toggleTheme: () => {
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY_THEME, nextTheme);
      } catch {
        // ignore
      }
      return { theme: nextTheme };
    });
  },

  resetSession: () => {
    set({
      status: "idle",
      sessionId: null,
      telemetry: null,
      fpsHistory: [],
      error: null,
    });
  },
}));

