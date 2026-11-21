import { TimelineScrubber } from "../components/TimelineScrubber";

export interface Story<T> {
  args: T;
}

export const LiveMode: Story<Parameters<typeof TimelineScrubber>[0]> = {
  args: {
    totalFramesInBuffer: 300,
    currentScrubIndex: null,
    memoryUsageMB: 28.4,
    events: [],
    zones: [],
    isLive: true,
    onSeek: () => {},
  },
};

export const ScrubbingIncident: Story<Parameters<typeof TimelineScrubber>[0]> = {
  args: {
    totalFramesInBuffer: 300,
    currentScrubIndex: 142,
    memoryUsageMB: 28.4,
    events: [
      {
        type: "confirmed",
        zone_id: 1,
        frame_idx: 142,
        timestamp_ms: 4500,
        camera_id: "cam_01",
        details: "Crash confirmed",
      },
    ],
    zones: [],
    isLive: false,
    onSeek: () => {},
  },
};
