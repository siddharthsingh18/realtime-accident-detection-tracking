import { TelemetryMessage, PipelineSettings } from "../api/types";

export const DEFAULT_SETTINGS: PipelineSettings = {
  accident_conf: 0.40,
  vehicle_conf: 0.35,
  containment_threshold: 0.50,
  iou_threshold: 0.30,
  persistence_seconds: 0.50,
  confirm_seconds: 0.17,
  tentative_grace_seconds: 0.07,
  use_collision_heuristic: true,
  device: "auto",
  save_output: false,
};

// Realistic mock sequence modeled on sample_traffic.mp4 (720x1280 or 1280x720 scene)
export const MOCK_TELEMETRY_SEQUENCE: TelemetryMessage[] = [
  {
    frame_idx: 1,
    total_frames: 120,
    fps: 28.5,
    timestamp_ms: 33,
    vehicles_in_frame: 6,
    vehicles_total_unique: 6,
    confirmed_accidents: 0,
    zones: [],
    events: [],
  },
  {
    frame_idx: 10,
    total_frames: 120,
    fps: 29.2,
    timestamp_ms: 330,
    vehicles_in_frame: 7,
    vehicles_total_unique: 9,
    confirmed_accidents: 0,
    zones: [],
    events: [],
  },
  {
    frame_idx: 20,
    total_frames: 120,
    fps: 27.8,
    timestamp_ms: 660,
    vehicles_in_frame: 7,
    vehicles_total_unique: 11,
    confirmed_accidents: 0,
    zones: [
      {
        zone_id: 1,
        status: "TENTATIVE",
        conf: 0.72,
        bbox: [320, 240, 560, 480],
        involved_vehicle_ids: [3, 4],
        speed_loss_pct: 42.5,
      },
    ],
    events: [],
  },
  {
    frame_idx: 26,
    total_frames: 120,
    fps: 28.0,
    timestamp_ms: 858,
    vehicles_in_frame: 8,
    vehicles_total_unique: 12,
    confirmed_accidents: 1,
    zones: [
      {
        zone_id: 1,
        status: "ACTIVE",
        conf: 0.88,
        bbox: [315, 235, 570, 485],
        involved_vehicle_ids: [3, 4],
        speed_loss_pct: 68.2,
      },
    ],
    events: [
      {
        type: "confirmed",
        zone_id: 1,
        frame_idx: 26,
        timestamp_ms: 858,
        bbox: [315, 235, 570, 485],
        details: "Collision confirmed between vehicle #3 and #4",
      },
    ],
  },
  {
    frame_idx: 35,
    total_frames: 120,
    fps: 28.4,
    timestamp_ms: 1155,
    vehicles_in_frame: 8,
    vehicles_total_unique: 13,
    confirmed_accidents: 1,
    zones: [
      {
        zone_id: 1,
        status: "ACTIVE",
        conf: 0.91,
        bbox: [318, 238, 572, 486],
        involved_vehicle_ids: [3, 4],
        speed_loss_pct: 71.0,
      },
    ],
    events: [],
  },
  {
    frame_idx: 50,
    total_frames: 120,
    fps: 29.0,
    timestamp_ms: 1650,
    vehicles_in_frame: 7,
    vehicles_total_unique: 15,
    confirmed_accidents: 1,
    zones: [
      {
        zone_id: 1,
        status: "MAINTAINED",
        conf: 0.82,
        bbox: [318, 238, 572, 486],
        involved_vehicle_ids: [3, 4],
        speed_loss_pct: null,
      },
    ],
    events: [],
  },
  {
    frame_idx: 75,
    total_frames: 120,
    fps: 28.9,
    timestamp_ms: 2475,
    vehicles_in_frame: 6,
    vehicles_total_unique: 18,
    confirmed_accidents: 0,
    zones: [],
    events: [
      {
        type: "cleared",
        zone_id: 1,
        frame_idx: 75,
        timestamp_ms: 2475,
        bbox: [318, 238, 572, 486],
        details: "Accident Zone #1 cleared after persistence timeout",
      },
    ],
  },
  {
    frame_idx: 120,
    total_frames: 120,
    fps: 29.1,
    timestamp_ms: 3960,
    vehicles_in_frame: 5,
    vehicles_total_unique: 22,
    confirmed_accidents: 0,
    zones: [],
    events: [],
  },
];

// Helper to generate a minimal colored canvas frame as JPEG blob
export function createMockFrameBlob(text: string, isAlert: boolean): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = isAlert ? "#2a0808" : "#0d1b1e";
    ctx.fillRect(0, 0, 640, 360);

    // Draw simulated road lines
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 360);
    ctx.lineTo(280, 180);
    ctx.moveTo(540, 360);
    ctx.lineTo(360, 180);
    ctx.stroke();

    if (isAlert) {
      // Draw simulated accident box
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.strokeRect(260, 190, 120, 80);
      ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
      ctx.fillRect(260, 190, 120, 80);
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(`MOCK STREAM: ${text}`, 20, 30);
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob || new Blob([], { type: "image/jpeg" }));
    }, "image/jpeg", 0.7);
  });
}
