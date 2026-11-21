import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsSidebar } from "../components/SettingsSidebar";
import { useSessionStore } from "../store/useSessionStore";
import { DEFAULT_SETTINGS } from "../mock/mockData";

describe("SettingsSidebar Component", () => {
  beforeEach(() => {
    useSessionStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      status: "idle",
    });
    localStorage.clear();
  });

  it("renders accident confidence slider and updates store and localStorage on change", () => {
    render(<SettingsSidebar />);

    const slider = screen.getAllByRole("slider")[0];
    fireEvent.change(slider, { target: { value: "0.65" } });

    expect(useSessionStore.getState().settings.accident_conf).toBe(0.65);
    const stored = JSON.parse(localStorage.getItem("rad_pipeline_settings") || "{}");
    expect(stored.accident_conf).toBe(0.65);
  });

  it("toggles kinematic collision heuristic checkbox", () => {
    render(<SettingsSidebar />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(useSessionStore.getState().settings.use_collision_heuristic).toBe(false);
  });

  it("calls onLiveSettingsChange when stream is running", () => {
    useSessionStore.setState({ status: "running" });
    const liveChangeMock = vi.fn();
    render(<SettingsSidebar onLiveSettingsChange={liveChangeMock} />);

    const slider = screen.getAllByRole("slider")[0];
    fireEvent.change(slider, { target: { value: "0.55" } });

    expect(liveChangeMock).toHaveBeenCalledWith({ accident_conf: 0.55 });
  });
});

