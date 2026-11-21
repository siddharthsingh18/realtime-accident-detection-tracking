import { z } from "zod";

// --- Pipeline Settings Schema ---
export const PipelineSettingsSchema = z.object({
  accident_conf: z.number().min(0.05).max(0.95).default(0.40),
  vehicle_conf: z.number().min(0.05).max(0.95).default(0.35),
  containment_threshold: z.number().min(0.10).max(1.00).default(0.50),
  iou_threshold: z.number().min(0.05).max(0.95).default(0.30),
  persistence_seconds: z.number().min(0.02).max(5.00).default(0.50),
  confirm_seconds: z.number().min(0.02).max(5.00).default(0.17),
  tentative_grace_seconds: z.number().min(0.02).max(5.00).default(0.07),
  use_collision_heuristic: z.boolean().default(true),
  device: z.string().default("auto"),
  save_output: z.boolean().default(false),
});

export type PipelineSettings = z.infer<typeof PipelineSettingsSchema>;

// --- Zone Telemetry ---
export const ZoneTelemetrySchema = z.object({
  zone_id: z.number(),
  status: z.enum(["TENTATIVE", "ACTIVE", "MAINTAINED"]),
  conf: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  involved_vehicle_ids: z.array(z.number()),
  speed_loss_pct: z.number().optional().nullable(),
});

export type ZoneTelemetry = z.infer<typeof ZoneTelemetrySchema>;

// --- Telemetry Event ---
export const TelemetryEventSchema = z.object({
  type: z.enum(["confirmed", "cleared"]),
  zone_id: z.number(),
  frame_idx: z.number(),
  timestamp_ms: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  details: z.string().optional(),
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// --- Telemetry Message ---
export const TelemetryMessageSchema = z.object({
  frame_idx: z.number(),
  total_frames: z.number().nullable().optional(),
  fps: z.number(),
  timestamp_ms: z.number(),
  vehicles_in_frame: z.number(),
  vehicles_total_unique: z.number(),
  confirmed_accidents: z.number(),
  zones: z.array(ZoneTelemetrySchema),
  events: z.array(TelemetryEventSchema),
});

export type TelemetryMessage = z.infer<typeof TelemetryMessageSchema>;

// --- Health Response ---
export const HealthResponseSchema = z.object({
  status: z.string(),
  device: z.string(),
  models: z.object({
    accident: z.object({
      file: z.string(),
      arch: z.string(),
      classes: z.record(z.string(), z.string()).optional(),
    }),
    vehicle: z.object({
      file: z.string(),
    }),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// --- Session ---
export const SessionCreateRequestSchema = z.object({
  source: z.enum(["upload", "sample1", "sample2", "webcam"]),
  settings: PipelineSettingsSchema.optional(),
});

export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;

export const SessionCreateResponseSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  status: z.string(),
});

export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>;

// --- Demo Item ---
export const DemoItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  resolution: z.string(),
  fps: z.number(),
  codec: z.string(),
  duration_seconds: z.number(),
  video_url: z.string(),
});

export type DemoItem = z.infer<typeof DemoItemSchema>;

