import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventLog } from "../components/EventLog";
import { useSessionStore } from "../store/useSessionStore";
import { TelemetryEvent } from "../api/types";

describe("EventLog Component", () => {
  beforeEach(() => {
    useSessionStore.setState({ events: [] });
  });

  it("renders empty state placeholder when no events exist", () => {
    render(<EventLog />);
    expect(screen.getByText(/No incidents recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText("0 / 200")).toBeInTheDocument();
  });

  it("caps events at 200 items in store and clears on Clear click", () => {
    const bulkEvents: TelemetryEvent[] = Array.from({ length: 250 }, (_, i) => ({
      type: i % 2 === 0 ? "confirmed" : "cleared",
      zone_id: i,
      frame_idx: i * 2,
      timestamp_ms: i * 100,
      details: `Test event ${i}`,
    }));

    bulkEvents.forEach((ev) => useSessionStore.getState().addEvent(ev));

    expect(useSessionStore.getState().events.length).toBe(200);

    render(<EventLog />);
    expect(screen.getByText("200 / 200")).toBeInTheDocument();

    const clearBtn = screen.getByTitle("Clear event log");
    fireEvent.click(clearBtn);

    expect(useSessionStore.getState().events.length).toBe(0);
    expect(screen.getByText(/No incidents recorded yet/i)).toBeInTheDocument();
  });

  it("triggers CSV export download", () => {
    const event: TelemetryEvent = {
      type: "confirmed",
      zone_id: 1,
      frame_idx: 12,
      timestamp_ms: 400,
      details: "Crash between #1 and #2",
    };
    useSessionStore.getState().addEvent(event);

    render(<EventLog />);
    const csvBtn = screen.getByRole("button", { name: /CSV/i });
    expect(csvBtn).toBeEnabled();

    const origCreateElement = document.createElement.bind(document);
    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") {
        el.click = clickSpy;
      }
      return el;
    });

    fireEvent.click(csvBtn);
    expect(clickSpy).toHaveBeenCalled();
    createElementSpy.mockRestore();
  });
});
