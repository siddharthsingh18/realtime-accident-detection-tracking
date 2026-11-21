import { AlertBanner } from "../components/AlertBanner";
import { TelemetryMessage } from "../api/types";

export interface Story<T> {
  args: T;
}

const baseTelemetry: TelemetryMessage = {
  frame_idx: 120,
  fps: 29.8,
  timestamp_ms: 4000,
  camera_id: "cam_01",
  vehicles_in_frame: 4,
  vehicles_total_unique: 8,
  confirmed_accidents: 0,
  zones: [],
  events: [],
};

export const CalmNormalTraffic: Story<Parameters<typeof AlertBanner>[0]> = {
  args: {
    telemetry: baseTelemetry,
  },
};

export const ActiveCollisionAlert: Story<Parameters<typeof AlertBanner>[0]> = {
  args: {
    telemetry: {
      ...baseTelemetry,
      confirmed_accidents: 1,
      zones: [
        {
          zone_id: 1,
          status: "ACTIVE",
          conf: 0.94,
          bbox: [200, 300, 350, 450],
          involved_vehicle_ids: [2, 3],
          origin: "detector",
        },
      ],
    },
  },
};

export const MaintainedAccident: Story<Parameters<typeof AlertBanner>[0]> = {
  args: {
    telemetry: {
      ...baseTelemetry,
      confirmed_accidents: 1,
      zones: [
        {
          zone_id: 2,
          status: "MAINTAINED",
          conf: 0.82,
          bbox: [180, 260, 310, 390],
          involved_vehicle_ids: [1, 4],
          origin: "both",
        },
      ],
    },
  },
};
