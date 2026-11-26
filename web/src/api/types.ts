import { z } from "zod";

export const StaticFilterSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["suppress", "flag_only"]).default("suppress"),
  min_observed_s: z.number().default(3.0),
  max_speed_threshold: z.number().default(3.0),
  max_speed_threshold_px_s: z.number().default(12.0),
  require_no_prior_contact: z.boolean().default(true),
});

export type StaticFilterSettings = z.infer<typeof StaticFilterSettingsSchema>;

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
  device: z.enum(["auto", "cpu", "mps", "cuda"]).default("auto"),
  save_output: z.boolean().default(false),
  static_filter: StaticFilterSettingsSchema.optional(),
});

export type PipelineSettings = z.infer<typeof PipelineSettingsSchema>;

// --- Track Telemetry ---
export const TrackTelemetrySchema = z.object({
  track_id: z.number(),
  cls: z.string().optional(),
  conf: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  speed_px_s: z.number().optional(),
  suppressed: z.boolean().optional(),
  trail: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export type TrackTelemetry = z.infer<typeof TrackTelemetrySchema>;

// --- Zone Telemetry ---
export const ZoneTelemetrySchema = z.object({
  zone_id: z.number(),
  status: z.enum(["TENTATIVE", "ACTIVE", "MAINTAINED"]),
  conf: z.number(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  involved_vehicle_ids: z.array(z.number()),
  speed_loss_pct: z.number().optional().nullable(),
  first_seen_frame: z.number().optional().nullable(),
  confirmed_at_ms: z.number().optional().nullable(),
  origin: z.enum(["detector", "collision_heuristic", "both"]).optional(),
});

export type ZoneTelemetry = z.infer<typeof ZoneTelemetrySchema>;

// --- Telemetry Event ---
export const TelemetryEventSchema = z.object({
  type: z.enum(["confirmed", "cleared"]),
  zone_id: z.number(),
  frame_idx: z.number(),
  timestamp_ms: z.number(),
  camera_id: z.string().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().nullable(),
  details: z.string().optional().nullable(),
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// --- Inference Breakdown ---
export const InferenceBreakdownSchema = z.object({
  accident: z.number().optional(),
  vehicle: z.number().optional(),
  tracking: z.number().optional(),
  logic: z.number().optional(),
  render: z.number().optional(),
  total: z.number().optional(),
});

export type InferenceBreakdown = z.infer<typeof InferenceBreakdownSchema>;

// --- Telemetry Message ---
export const TelemetryMessageSchema = z.object({
  frame_idx: z.number(),
  total_frames: z.number().nullable().optional(),
  fps: z.number(),
  timestamp_ms: z.number(),
  camera_id: z.string().optional(),
  frame_size: z.object({ w: z.number(), h: z.number() }).optional(),
  vehicles_in_frame: z.number(),
  vehicles_total_unique: z.number(),
  confirmed_accidents: z.number(),
  dropped_frames: z.number().optional(),
  inference_ms: InferenceBreakdownSchema.optional(),
  tracks: z.array(TrackTelemetrySchema).optional(),
  zones: z.array(ZoneTelemetrySchema),
  events: z.array(TelemetryEventSchema),
  finished: z.boolean().optional(),
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

// --- Incident Persistence Schema ---
export const IncidentItemSchema = z.object({
  id: z.string(),
  camera_id: z.string(),
  session_id: z.string(),
  zone_id: z.number(),
  origin: z.enum(["detector", "collision_heuristic", "both"]),
  confirmed_at: z.string(),
  cleared_at: z.string().nullable().optional(),
  peak_conf: z.number(),
  bbox: z.array(z.number()),
  involved_vehicle_ids: z.array(z.number()),
  snapshot_path: z.string().nullable().optional(),
  snapshot_before_path: z.string().nullable().optional(),
  snapshot_after_path: z.string().nullable().optional(),
  clip_path: z.string().nullable().optional(),
  verdict: z.enum(["true_accident", "false_alarm", "unsure"]).nullable().optional(),
  verdict_note: z.string().nullable().optional(),
  verdict_at: z.string().nullable().optional(),
  settings: z.record(z.string(), z.any()).default({}),
  model_info: z.record(z.string(), z.any()).default({}),
  kinematics: z.record(z.string(), z.any()).nullable().optional(),
  time_series: z.record(z.string(), z.any()).nullable().optional(),
  static_filter: z.record(z.string(), z.any()).nullable().optional(),
  is_deleted: z.number().default(0),
});

export type IncidentItem = z.infer<typeof IncidentItemSchema>;

export const IncidentListResponseSchema = z.object({
  items: z.array(IncidentItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;

// --- Camera Schema ---
export const CameraItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  heading: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  settings_profile: z.record(z.string(), z.any()).default({}),
  ignore_region: z.array(z.array(z.number())).default([]),
  created_at: z.string(),
});

export type CameraItem = z.infer<typeof CameraItemSchema>;

// --- System Status Schema ---
export const SessionSystemInfoSchema = z.object({
  session_id: z.string(),
  camera_id: z.string(),
  source: z.string(),
  status: z.string(),
  fps: z.number(),
  dropped_frames: z.number(),
  queue_depth: z.number(),
});

export const SystemStatusResponseSchema = z.object({
  active_sessions: z.number(),
  max_concurrent_sessions: z.number(),
  device: z.string(),
  sessions: z.array(SessionSystemInfoSchema),
  hardware_contention_warning: z.string().nullable().optional(),
});

export type SystemStatusResponse = z.infer<typeof SystemStatusResponseSchema>;

// --- Notification Schemas ---
export const NotificationChannelInfoSchema = z.object({
  channel: z.string(),
  configured: z.boolean(),
});

export const NotificationSettingsResponseSchema = z.object({
  cooldown_seconds: z.number(),
  channels: z.record(z.string(), NotificationChannelInfoSchema),
});

export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsResponseSchema>;

export const NotificationLogItemSchema = z.object({
  id: z.number(),
  incident_id: z.string(),
  camera_id: z.string(),
  channel: z.string(),
  status: z.string(),
  attempts: z.number(),
  last_error: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type NotificationLogItem = z.infer<typeof NotificationLogItemSchema>;

// --- Stats Schema ---
export const StatsResponseSchema = z.object({
  total_incidents: z.number(),
  reviewed_count: z.number(),
  unreviewed_count: z.number(),
  true_accident_count: z.number(),
  false_alarm_count: z.number(),
  unsure_count: z.number(),
  false_alarm_share: z.number(),
  by_verdict: z.record(z.string(), z.number()),
  by_origin: z.record(z.string(), z.number()),
  by_hour: z.array(z.object({ hour: z.number(), count: z.number() })),
  by_day: z.array(z.object({ date: z.string(), count: z.number() })),
  per_camera: z.record(z.string(), z.number()),
  time_range: z.object({ from: z.string().nullable().optional(), to: z.string().nullable().optional() }),
  camera_filter: z.string().nullable().optional(),
  insufficient_data: z.boolean(),
  operator_caveat: z.string(),
});

export type StatsResponse = z.infer<typeof StatsResponseSchema>;

// --- Compare Schema ---
export const CompareRunResultSchema = z.object({
  profile_name: z.string(),
  settings: PipelineSettingsSchema,
  total_frames: z.number(),
  confirmed_alerts_count: z.number(),
  confirmed_zones: z.array(z.record(z.string(), z.any())),
  frame_ranges: z.array(z.tuple([z.number(), z.number()])),
});

export const CompareResponseSchema = z.object({
  source: z.string(),
  run_a: CompareRunResultSchema,
  run_b: CompareRunResultSchema,
  caveat: z.string(),
});

export type CompareResponse = z.infer<typeof CompareResponseSchema>;

// --- Demos Schema ---
export const DemoItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  resolution: z.string(),
  fps: z.number(),
  codec: z.string().default("H.264"),
  duration_seconds: z.number(),
  url: z.string().optional(),
  video_url: z.string().optional(),
});

export type DemoItem = z.infer<typeof DemoItemSchema>;

export const SessionCreateResponseSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  camera_id: z.string().default("cam_01"),
  total_frames: z.number().nullable().optional(),
  fps: z.number(),
  message: z.string(),
});

export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>;

// --- Evaluation Harness Schemas ---
export interface EvalFailureItem {
  filename: string;
  image: string;
  outcome: "FP" | "FN";
  reason: string;
  split: string;
  max_conf: number;
}

export interface EvalReport {
  run_id: string;
  timestamp_utc: string;
  backend: string;
  is_smoke_test: boolean;
  config: Record<string, any>;
  summary_all: {
    summary: {
      total_clips: number;
      total_crashes: number;
      total_normals: number;
      total_duration_sec: number;
      normal_duration_sec: number;
      normal_duration_hours: number;
    };
    counts: {
      TP: number;
      FP: number;
      FN: number;
      TN: number;
    };
    rates: {
      precision: number;
      precision_ci_95: [number, number];
      recall: number;
      recall_ci_95: [number, number];
      f1_score: number;
      accuracy: number;
      accuracy_ci_95: [number, number];
      false_alarms_per_hour: number;
    };
    delay: {
      sample_count: number;
      median_sec: number | null;
      p90_sec: number | null;
      min_sec: number | null;
      max_sec: number | null;
      max_delay_threshold_sec: number;
    };
  };
  summary_dev?: any;
  summary_test?: any;
  condition_breakdown: Record<string, {
    clip_count: number;
    crashes: number;
    normals: number;
    TP: number;
    FP: number;
    FN: number;
    TN: number;
    precision: number;
    recall: number;
    f1_score: number;
    false_alarms_per_hour: number;
    median_delay_sec: number | null;
  }>;
  pr_curve_dev: Array<{
    threshold: number;
    precision: number;
    recall: number;
    f1: number;
    TP: number;
    FP: number;
    FN: number;
    TN: number;
    fa_per_hour: number;
  }>;
  failure_count: number;
  failures: EvalFailureItem[];
  limitations: string[];
}

export interface LatestEvalResponse {
  has_run: boolean;
  message?: string;
  report?: EvalReport;
}
