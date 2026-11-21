import { VectorOverlayCanvas } from "../components/VectorOverlayCanvas";
import { TelemetryMessage } from "../api/types";

export interface Story<T> {
  args: T;
}

const mockTelemetry: TelemetryMessage = {
  frame_idx: 100,
  fps: 30,
  timestamp_ms: 3300,
  camera_id: "cam_01",
  frame_size: { w: 1280, h: 720 },
  vehicles_in_frame: 2,
  vehicles_total_unique: 5,
  confirmed_accidents: 1,
  tracks: [
    {
      track_id: 1,
      cls: "car",
      conf: 0.89,
      bbox: [200, 300, 350, 450],
      speed_px_s: 45.0,
      suppressed: false,
      trail: [[190, 290], [195, 295], [200, 300]],
    },
  ],
  zones: [
    {
      zone_id: 1,
      status: "ACTIVE",
      conf: 0.95,
      bbox: [210, 310, 360, 460],
      involved_vehicle_ids: [1],
      origin: "detector",
    },
  ],
  events: [],
};

export const ActiveCollisionVectorCanvas: Story<Parameters<typeof VectorOverlayCanvas>[0]> = {
  args: {
    telemetry: mockTelemetry,
    width: 640,
    height: 360,
  },
};
