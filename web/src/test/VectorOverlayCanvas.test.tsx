import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { VectorOverlayCanvas } from "../components/VectorOverlayCanvas";
import { TelemetryMessage } from "../api/types";

describe("VectorOverlayCanvas Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTelemetry: TelemetryMessage = {
    frame_idx: 42,
    timestamp_ms: 1400,
    fps: 30,
    camera_id: "cam_01",
    frame_size: { w: 1280, h: 720 },
    vehicles_in_frame: 2,
    vehicles_total_unique: 5,
    confirmed_accidents: 1,
    tracks: [
      {
        track_id: 1,
        cls: "car",
        conf: 0.88,
        bbox: [100, 150, 200, 250],
        speed_px_s: 35.5,
        suppressed: false,
        trail: [[100, 150], [105, 155], [110, 160]],
      },
    ],
    zones: [
      {
        zone_id: 1,
        status: "ACTIVE",
        conf: 0.92,
        bbox: [120, 160, 220, 260],
        involved_vehicle_ids: [1],
        origin: "detector",
      },
    ],
    events: [],
  };

  it("renders canvas element with matching dimensions", () => {
    const { container } = render(
      <VectorOverlayCanvas
        telemetry={mockTelemetry}
        width={640}
        height={360}
      />
    );

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas?.width).toBe(640);
    expect(canvas?.height).toBe(360);
  });

  it("handles null telemetry gracefully without throwing", () => {
    const { container } = render(
      <VectorOverlayCanvas
        telemetry={null}
        width={640}
        height={360}
      />
    );

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });
});

