import { KpiCards } from "../components/KpiCards";
import { TelemetryMessage } from "../api/types";

export interface Story<T> {
  args: T;
}

const mockTelemetry: TelemetryMessage = {
  frame_idx: 240,
  total_frames: 480,
  fps: 28.5,
  timestamp_ms: 8000,
  camera_id: "cam_01",
  vehicles_in_frame: 5,
  vehicles_total_unique: 14,
  confirmed_accidents: 1,
  zones: [],
  events: [],
};

export const DefaultRunning: Story<Parameters<typeof KpiCards>[0]> = {
  args: {
    telemetry: mockTelemetry,
    fpsHistory: [25, 27, 28, 29, 28.5],
  },
};

export const ZeroAccidentsHighFPS: Story<Parameters<typeof KpiCards>[0]> = {
  args: {
    telemetry: {
      ...mockTelemetry,
      confirmed_accidents: 0,
      fps: 32.1,
    },
    fpsHistory: [30, 31, 32, 32.1],
  },
};
