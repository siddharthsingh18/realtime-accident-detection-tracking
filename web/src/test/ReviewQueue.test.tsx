import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewQueue } from "../pages/ReviewQueue";
import { api } from "../api/client";

// Mock API client
vi.mock("../api/client", () => ({
  api: {
    getIncidents: vi.fn(),
    updateIncidentVerdict: vi.fn(),
  },
}));

describe("ReviewQueue Component", () => {
  const mockIncidents = [
    {
      id: "inc-001",
      camera_id: "cam_01",
      session_id: "sess_1",
      zone_id: 1,
      origin: "detector",
      confirmed_at: "2026-11-21T05:30:00Z",
      peak_conf: 0.91,
      bbox: [100, 100, 200, 200],
      involved_vehicle_ids: [1, 2],
      verdict: null,
      verdict_note: null,
      is_deleted: 0,
    },
    {
      id: "inc-002",
      camera_id: "cam_02",
      session_id: "sess_2",
      zone_id: 2,
      origin: "collision_heuristic",
      confirmed_at: "2026-11-21T05:31:00Z",
      peak_conf: 0.85,
      bbox: [150, 150, 250, 250],
      involved_vehicle_ids: [3, 4],
      verdict: "true_accident",
      verdict_note: "Rear end",
      is_deleted: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getIncidents as any).mockResolvedValue({
      items: mockIncidents,
      total: 2,
      limit: 100,
      offset: 0,
    });
    (api.updateIncidentVerdict as any).mockResolvedValue({
      ...mockIncidents[0],
      verdict: "true_accident",
    });
  });

  it("renders incident list from api", async () => {
    render(
      <MemoryRouter>
        <ReviewQueue />
      </MemoryRouter>
    );

    expect(screen.getByText(/Review Queue/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("inc-001")).toBeInTheDocument();
      expect(screen.getByText("inc-002")).toBeInTheDocument();
    });
  });

  it("supports keyboard navigation with J and K", async () => {
    render(
      <MemoryRouter>
        <ReviewQueue />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("inc-001")).toBeInTheDocument();
    });

    // Press 'j' to navigate down
    fireEvent.keyDown(window, { key: "j" });
    // Press 'k' to navigate back up
    fireEvent.keyDown(window, { key: "k" });
  });

  it("supports keyboard verdict shortcut 'T' for true accident", async () => {
    render(
      <MemoryRouter>
        <ReviewQueue />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("inc-001")).toBeInTheDocument();
    });

    // Press 't' on first item
    fireEvent.keyDown(window, { key: "t" });

    await waitFor(() => {
      expect(api.updateIncidentVerdict).toHaveBeenCalledWith("inc-001", "true_accident");
    });
  });

  it("supports keyboard verdict shortcut 'F' for false alarm", async () => {
    (api.updateIncidentVerdict as any).mockResolvedValue({
      ...mockIncidents[0],
      verdict: "false_alarm",
    });

    render(
      <MemoryRouter>
        <ReviewQueue />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("inc-001")).toBeInTheDocument();
    });

    // Press 'f' on first item
    fireEvent.keyDown(window, { key: "f" });

    await waitFor(() => {
      expect(api.updateIncidentVerdict).toHaveBeenCalledWith("inc-001", "false_alarm");
    });
  });

  it("filters incidents when dropdown selection changes", async () => {
    render(
      <MemoryRouter>
        <ReviewQueue />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("inc-001")).toBeInTheDocument();
    });

    // Change verdict filter dropdown
    const select = screen.getByDisplayValue("All Verdicts");
    fireEvent.change(select, { target: { value: "unreviewed" } });

    await waitFor(() => {
      expect(api.getIncidents).toHaveBeenCalledWith(
        expect.objectContaining({
          verdict: "unreviewed",
        })
      );
    });
  });
});
