import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertBanner } from "../components/AlertBanner";
import { useSessionStore } from "../store/useSessionStore";

describe("AlertBanner Component", () => {
  beforeEach(() => {
    useSessionStore.setState({
      telemetry: null,
      status: "idle",
    });
  });

  it("renders safe green banner when 0 confirmed accidents", () => {
    useSessionStore.setState({
      telemetry: {
        frame_idx: 10,
        fps: 30,
        timestamp_ms: 333,
        vehicles_in_frame: 5,
        vehicles_total_unique: 5,
        confirmed_accidents: 0,
        zones: [],
        events: [],
      },
      status: "running",
    });

    render(<AlertBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/SYSTEM NORMAL: ROAD SURVEILLANCE ACTIVE/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Neural detection and BoT-SORT tracking active/i)
    ).toBeInTheDocument();
  });

  it("renders critical red banner when confirmed accidents > 0", () => {
    useSessionStore.setState({
      telemetry: {
        frame_idx: 45,
        fps: 28,
        timestamp_ms: 1500,
        vehicles_in_frame: 6,
        vehicles_total_unique: 8,
        confirmed_accidents: 1,
        zones: [
          {
            zone_id: 2,
            status: "ACTIVE",
            conf: 0.88,
            bbox: [100, 100, 250, 250],
            involved_vehicle_ids: [1, 2],
          },
        ],
        events: [],
      },
      status: "running",
    });

    render(<AlertBanner />);
    expect(
      screen.getByText(/CRITICAL ALERT: 1 ACCIDENT ZONE DETECTED/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/ACTION REQUIRED/i)).toBeInTheDocument();
    expect(screen.getByText(/Zone\(s\): #2 \(88% conf\)/i)).toBeInTheDocument();
  });
});

