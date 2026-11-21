import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCards } from "../components/KpiCards";
import { useSessionStore } from "../store/useSessionStore";

describe("KpiCards Component", () => {
  beforeEach(() => {
    useSessionStore.setState({
      telemetry: null,
      fpsHistory: [],
    });
  });

  it("renders em-dashes when telemetry is not yet available", () => {
    render(<KpiCards />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("calculates 10-frame smoothed FPS correctly and shows frame progress", () => {
    const rawFps = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38];
    // Average of 20..38 is 29.0
    useSessionStore.setState({
      telemetry: {
        frame_idx: 60,
        total_frames: 120,
        fps: 38.0,
        timestamp_ms: 2000,
        vehicles_in_frame: 7,
        vehicles_total_unique: 14,
        confirmed_accidents: 0,
        zones: [],
        events: [],
      },
      fpsHistory: rawFps,
    });

    render(<KpiCards />);
    expect(screen.getByText("29.0")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("(14 total)")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("/ 120")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});

