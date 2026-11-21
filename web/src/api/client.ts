import {
  HealthResponse,
  HealthResponseSchema,
  PipelineSettings,
  PipelineSettingsSchema,
  SessionCreateResponse,
  SessionCreateResponseSchema,
  DemoItem,
  DemoItemSchema,
  IncidentItem,
  IncidentItemSchema,
  IncidentListResponse,
  IncidentListResponseSchema,
  CameraItem,
  CameraItemSchema,
  SystemStatusResponse,
  SystemStatusResponseSchema,
  StatsResponse,
  StatsResponseSchema,
  CompareResponse,
  CompareResponseSchema,
} from "./types";
import { z } from "zod";

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "http://localhost:8000";
};

const API_BASE = getApiBase();

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

function getAuthHeaders(): HeadersInit {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("rad_api_token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response, schema?: z.ZodType<T, any, any>): Promise<T> {
  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, errorDetail);
  }
  const json = await res.json();
  if (schema) {
    return schema.parse(json);
  }
  return json as T;
}

export const api = {
  // System & Health
  async getHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE}/api/health`, { headers: getAuthHeaders() });
    return handleResponse(res, HealthResponseSchema);
  },

  async getConfig(): Promise<PipelineSettings> {
    const res = await fetch(`${API_BASE}/api/config`, { headers: getAuthHeaders() });
    return handleResponse(res, PipelineSettingsSchema);
  },

  async validateConfig(settings: Partial<PipelineSettings>): Promise<{ valid: boolean; validated: PipelineSettings }> {
    const res = await fetch(`${API_BASE}/api/config/validate`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ settings }),
    });
    return handleResponse(res);
  },

  async getSystemStatus(): Promise<SystemStatusResponse> {
    const res = await fetch(`${API_BASE}/api/system`, { headers: getAuthHeaders() });
    return handleResponse(res, SystemStatusResponseSchema);
  },

  // Sessions
  async createSession(
    source: "upload" | "sample1" | "sample2" | "webcam",
    settings?: Partial<PipelineSettings>,
    file?: File,
    cameraId: string = "cam_01"
  ): Promise<SessionCreateResponse> {
    if (source === "upload" && file) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", "upload");
      formData.append("camera_id", cameraId);
      if (settings) {
        formData.append("settings", JSON.stringify(settings));
      }
      const token = typeof localStorage !== "undefined" ? localStorage.getItem("rad_api_token") : null;
      const headers: HeadersInit = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers,
        body: formData,
      });
      return handleResponse(res, SessionCreateResponseSchema);
    }

    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ source, settings, camera_id: cameraId }),
    });
    return handleResponse(res, SessionCreateResponseSchema);
  },

  // Incidents
  async getIncidents(params?: {
    camera_id?: string;
    verdict?: string;
    origin?: string;
    from_date?: string;
    to_date?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<IncidentListResponse> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") query.set(k, String(v));
      });
    }
    const res = await fetch(`${API_BASE}/api/incidents?${query.toString()}`, { headers: getAuthHeaders() });
    return handleResponse(res, IncidentListResponseSchema);
  },

  async getIncident(id: string): Promise<IncidentItem> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}`, { headers: getAuthHeaders() });
    return handleResponse(res, IncidentItemSchema);
  },

  async updateIncidentVerdict(
    id: string,
    verdict: "true_accident" | "false_alarm" | "unsure" | null,
    note?: string
  ): Promise<IncidentItem> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}/verdict`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ verdict, note }),
    });
    return handleResponse(res, IncidentItemSchema);
  },

  async deleteIncident(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    await handleResponse(res);
  },

  async restoreIncident(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}/restore`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    await handleResponse(res);
  },

  async getIncidentAudit(id: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}/audit`, { headers: getAuthHeaders() });
    return handleResponse(res);
  },

  async replayIncident(id: string, draftSettings: PipelineSettings): Promise<any> {
    const res = await fetch(`${API_BASE}/api/incidents/${id}/replay`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(draftSettings),
    });
    return handleResponse(res);
  },

  // Stats
  async getStats(from?: string, to?: string, camera?: string): Promise<StatsResponse> {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (camera) query.set("camera", camera);
    const res = await fetch(`${API_BASE}/api/stats?${query.toString()}`, { headers: getAuthHeaders() });
    return handleResponse(res, StatsResponseSchema);
  },

  // Cameras
  async getCameras(): Promise<CameraItem[]> {
    const res = await fetch(`${API_BASE}/api/cameras`, { headers: getAuthHeaders() });
    return handleResponse(res, z.array(CameraItemSchema));
  },

  async getCamera(id: string): Promise<CameraItem> {
    const res = await fetch(`${API_BASE}/api/cameras/${id}`, { headers: getAuthHeaders() });
    return handleResponse(res, CameraItemSchema);
  },

  async updateCamera(id: string, camera: Partial<CameraItem>): Promise<CameraItem> {
    const res = await fetch(`${API_BASE}/api/cameras/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(camera),
    });
    return handleResponse(res, CameraItemSchema);
  },

  async deleteCamera(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/cameras/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    await handleResponse(res);
  },

  // Compare
  async runCompare(payload: {
    source: string;
    profile_a_settings: PipelineSettings;
    profile_b_settings: PipelineSettings;
    profile_a_name?: string;
    profile_b_name?: string;
    max_frames?: number;
  }): Promise<CompareResponse> {
    const res = await fetch(`${API_BASE}/api/compare`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, CompareResponseSchema);
  },

  // Demos
  async getDemos(): Promise<DemoItem[]> {
    const res = await fetch(`${API_BASE}/api/demos`, { headers: getAuthHeaders() });
    return handleResponse(res, z.array(DemoItemSchema));
  },
};
