import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "../pages/Dashboard";
import { useSessionStore } from "../store/useSessionStore";

describe("Dashboard Mock Mode Integration", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    useSessionStore.setState({
      status: "idle",
      source: "sample1",
      isMock: false,
      telemetry: null,
      events: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes mock session transition: normal -> confirmed accident -> alert banner -> event log", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Dashboard />
      </QueryClientProvider>
    );

    // Initial state: green normal alert
    expect(
      screen.getByText(/SYSTEM NORMAL: ROAD SURVEILLANCE ACTIVE/i)
    ).toBeInTheDocument();

    // Toggle mock mode button
    const mockModeBtn = screen.getByTitle("Toggle standalone mock mode");
    fireEvent.click(mockModeBtn);
    expect(useSessionStore.getState().isMock).toBe(true);

    // Click Start Stream
    const startBtn = screen.getByRole("button", { name: /Start Stream/i });
    fireEvent.click(startBtn);

    // Initial step 0
    expect(useSessionStore.getState().status).toBe("running");

    // Advance timers across the sequence steps (sequence has 8 steps, each 450ms)
    // Step 0: frame 1 (0 accidents)
    // Step 1: frame 10 (0 accidents)
    // Step 2: frame 20 (tentative accident)
    // Step 3: frame 26 (ACTIVE confirmed accident) -> triggers red banner & event
    await act(async () => {
      vi.advanceTimersByTime(450 * 3 + 50);
    });

    // Check confirmed accident KPI and Alert Banner
    expect(useSessionStore.getState().telemetry?.confirmed_accidents).toBe(1);
    expect(
      screen.getByText(/CRITICAL ALERT: 1 ACCIDENT ZONE DETECTED/i)
    ).toBeInTheDocument();

    // Check incident event log has logged the crash
    expect(screen.getByText("Collision Confirmed")).toBeInTheDocument();
    expect(
      screen.getByText(/Collision confirmed between vehicle #3 and #4/i)
    ).toBeInTheDocument();

    // Advance to end of sequence (step 7)
    await act(async () => {
      vi.advanceTimersByTime(450 * 5);
    });

    expect(useSessionStore.getState().status).toBe("finished");
  });
});
