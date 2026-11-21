import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamWebSocket } from "../api/websocket";

describe("StreamWebSocket Client", () => {
  let mockWsInstance: any;
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstance = {
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      binaryType: "blob",
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    global.WebSocket = vi.fn().mockImplementation(() => mockWsInstance) as any;
    (global.WebSocket as any).OPEN = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
  });

  it("parses valid JSON telemetry message and dispatches callback", () => {
    const onTelemetry = vi.fn();
    const onFrame = vi.fn();
    const onStatus = vi.fn();

    const client = new StreamWebSocket("sess_123", {
      onTelemetry,
      onFrame,
      onStatus,
    });
    client.connect();

    // Trigger onopen
    mockWsInstance.onopen();
    expect(onStatus).toHaveBeenCalledWith("connected");

    // Send valid telemetry JSON
    const sampleMsg = {
      frame_idx: 5,
      fps: 25.0,
      timestamp_ms: 200,
      vehicles_in_frame: 4,
      vehicles_total_unique: 4,
      confirmed_accidents: 0,
      zones: [],
      events: [],
    };
    mockWsInstance.onmessage({ data: JSON.stringify(sampleMsg) });

    expect(onTelemetry).toHaveBeenCalledWith(sampleMsg);
  });

  it("dispatches binary frame blob to onFrame callback", () => {
    const onTelemetry = vi.fn();
    const onFrame = vi.fn();
    const onStatus = vi.fn();

    const client = new StreamWebSocket("sess_123", {
      onTelemetry,
      onFrame,
      onStatus,
    });
    client.connect();

    const dummyBlob = new Blob(["jpegdata"], { type: "image/jpeg" });
    mockWsInstance.onmessage({ data: dummyBlob });

    expect(onFrame).toHaveBeenCalledWith(dummyBlob);
  });

  it("handles abnormal disconnect by attempting exponential reconnect", () => {
    const onTelemetry = vi.fn();
    const onFrame = vi.fn();
    const onStatus = vi.fn();

    const client = new StreamWebSocket("sess_123", {
      onTelemetry,
      onFrame,
      onStatus,
    });
    client.connect();
    mockWsInstance.onopen();

    // Abnormal close (code 1006)
    mockWsInstance.onclose({ code: 1006 });
    expect(onStatus).toHaveBeenCalledWith("reconnecting", expect.stringContaining("attempt 1"));

    // Fast forward timer by 1000ms
    vi.advanceTimersByTime(1100);
    expect(global.WebSocket).toHaveBeenCalledTimes(2);

    client.close();
  });
});

