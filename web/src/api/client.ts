import {
  HealthResponse,
  HealthResponseSchema,
  PipelineSettings,
  PipelineSettingsSchema,
  SessionCreateResponse,
  SessionCreateResponseSchema,
  DemoItem,
  DemoItemSchema,
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
  async getHealth(): Promise<HealthResponse> {
    const res = await fetch(`${API_BASE}/api/health`);
    return handleResponse(res, HealthResponseSchema);
  },

  async getConfig(): Promise<PipelineSettings> {
    const res = await fetch(`${API_BASE}/api/config`);
    return handleResponse(res, PipelineSettingsSchema);
  },

  async validateConfig(settings: Partial<PipelineSettings>): Promise<{ valid: boolean; validated: PipelineSettings }> {
    const res = await fetch(`${API_BASE}/api/config/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return handleResponse(res);
  },

  async createSession(
    source: "upload" | "sample1" | "sample2" | "webcam",
    settings?: Partial<PipelineSettings>,
    file?: File
  ): Promise<SessionCreateResponse> {
    if (source === "upload" && file) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", "upload");
      if (settings) {
        formData.append("settings", JSON.stringify(settings));
      }
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        body: formData,
      });
      return handleResponse(res, SessionCreateResponseSchema);
    }

    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, settings }),
    });
    return handleResponse(res, SessionCreateResponseSchema);
  },

  async getDemos(): Promise<DemoItem[]> {
    const res = await fetch(`${API_BASE}/api/demos`);
    return handleResponse(res, z.array(DemoItemSchema));
  },
};
