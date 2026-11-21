import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Controls } from "../components/Controls";
import { useSessionStore } from "../store/useSessionStore";

describe("Controls Component", () => {
  const onStart = vi.fn();
  const onStop = vi.fn();
  const onPause = vi.fn();
  const onResume = vi.fn();
  const onReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders enabled Start button in idle state", () => {
    useSessionStore.setState({ status: "idle", source: "sample1" });
    render(
      <Controls
        onStart={onStart}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onReset={onReset}
      />
    );

    const startBtn = screen.getByRole("button", { name: /Start Stream/i });
    expect(startBtn).toBeEnabled();
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("renders Pause and Stop buttons when running", () => {
    useSessionStore.setState({ status: "running", source: "sample1" });
    render(
      <Controls
        onStart={onStart}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onReset={onReset}
      />
    );

    const pauseBtn = screen.getByRole("button", { name: /Pause/i });
    const stopBtn = screen.getByRole("button", { name: /Stop/i });

    expect(pauseBtn).toBeEnabled();
    expect(stopBtn).toBeEnabled();

    fireEvent.click(pauseBtn);
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("renders Resume and Stop buttons when paused", () => {
    useSessionStore.setState({ status: "paused", source: "sample1" });
    render(
      <Controls
        onStart={onStart}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onReset={onReset}
      />
    );

    const resumeBtn = screen.getByRole("button", { name: /Resume/i });
    expect(resumeBtn).toBeEnabled();
    fireEvent.click(resumeBtn);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

