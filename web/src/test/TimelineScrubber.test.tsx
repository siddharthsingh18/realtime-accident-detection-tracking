import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimelineScrubber } from "../components/TimelineScrubber";

describe("TimelineScrubber Component", () => {
  it("renders live state correctly and shows buffer frame count and RAM", () => {
    const handleSeek = vi.fn();
    render(
      <TimelineScrubber
        totalFramesInBuffer={150}
        currentScrubIndex={null}
        memoryUsageMB={24.5}
        events={[]}
        zones={[]}
        isLive={true}
        onSeek={handleSeek}
      />
    );

    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Buffer: 150 frames")).toBeInTheDocument();
    expect(screen.getByText("RAM: 24.5 MB / 60 MB")).toBeInTheDocument();
  });

  it("indicates scrubbing mode when currentScrubIndex is set", () => {
    const handleSeek = vi.fn();
    render(
      <TimelineScrubber
        totalFramesInBuffer={150}
        currentScrubIndex={80}
        memoryUsageMB={24.5}
        events={[]}
        zones={[]}
        isLive={false}
        onSeek={handleSeek}
      />
    );

    expect(screen.getByText("SCRUBBING BUFFER: #80")).toBeInTheDocument();
  });

  it("calls onSeek(null) when LIVE button is clicked while scrubbing", () => {
    const handleSeek = vi.fn();
    render(
      <TimelineScrubber
        totalFramesInBuffer={150}
        currentScrubIndex={50}
        memoryUsageMB={24.5}
        events={[]}
        zones={[]}
        isLive={false}
        onSeek={handleSeek}
      />
    );

    const liveBtn = screen.getByRole("button", { name: /LIVE/i });
    fireEvent.click(liveBtn);
    expect(handleSeek).toHaveBeenCalledWith(null);
  });

  it("calls onSeek with frame index when range input changes", () => {
    const handleSeek = vi.fn();
    render(
      <TimelineScrubber
        totalFramesInBuffer={100}
        currentScrubIndex={null}
        memoryUsageMB={15}
        events={[]}
        zones={[]}
        isLive={true}
        onSeek={handleSeek}
      />
    );

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "35" } });
    expect(handleSeek).toHaveBeenCalledWith(35);
  });
});

