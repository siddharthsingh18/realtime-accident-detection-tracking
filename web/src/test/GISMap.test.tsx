import { describe, it, expect } from "vitest";
import { validateCoordinates } from "../components/CameraLocationPicker";

describe("GIS Coordinate and Heading Validation", () => {
  it("accepts valid latitude and longitude coordinates", () => {
    const res = validateCoordinates("28.6139", "77.2090", "45");
    expect(res.valid).toBe(true);
    expect(res.lat).toBe(28.6139);
    expect(res.lng).toBe(77.209);
    expect(res.heading).toBe(45);
    expect(res.error).toBeUndefined();
  });

  it("accepts valid boundary coordinates (-90, 90, -180, 180)", () => {
    const resMin = validateCoordinates("-90", "-180", "0");
    expect(resMin.valid).toBe(true);
    expect(resMin.lat).toBe(-90);
    expect(resMin.lng).toBe(-180);
    expect(resMin.heading).toBe(0);

    const resMax = validateCoordinates("90", "180", "360");
    expect(resMax.valid).toBe(true);
    expect(resMax.lat).toBe(90);
    expect(resMax.lng).toBe(180);
    expect(resMax.heading).toBe(360);
  });

  it("allows empty optional heading while validating coordinates", () => {
    const res = validateCoordinates("12.9716", "77.5946", "");
    expect(res.valid).toBe(true);
    expect(res.lat).toBe(12.9716);
    expect(res.lng).toBe(77.5946);
    expect(res.heading).toBeNull();
  });

  it("allows clearing coordinates when all fields are empty", () => {
    const res = validateCoordinates("", "", "");
    expect(res.valid).toBe(true);
    expect(res.lat).toBeNull();
    expect(res.lng).toBeNull();
    expect(res.heading).toBeNull();
  });

  it("rejects latitude outside -90 to 90 range", () => {
    const resOver = validateCoordinates("90.001", "77.2090", "");
    expect(resOver.valid).toBe(false);
    expect(resOver.error).toContain("Latitude must be a valid number between -90.0 and 90.0");

    const resUnder = validateCoordinates("-95.5", "77.2090", "");
    expect(resUnder.valid).toBe(false);
  });

  it("rejects longitude outside -180 to 180 range", () => {
    const resOver = validateCoordinates("28.6139", "180.5", "");
    expect(resOver.valid).toBe(false);
    expect(resOver.error).toContain("Longitude must be a valid number between -180.0 and 180.0");

    const resUnder = validateCoordinates("28.6139", "-185.0", "");
    expect(resUnder.valid).toBe(false);
  });

  it("rejects non-numeric coordinate strings", () => {
    const res = validateCoordinates("invalid_lat", "77.2090", "");
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("rejects heading outside 0 to 360 degrees", () => {
    const resOver = validateCoordinates("28.6139", "77.2090", "365");
    expect(resOver.valid).toBe(false);
    expect(resOver.error).toContain("Heading must be between 0° and 360°");

    const resNegative = validateCoordinates("28.6139", "77.2090", "-15");
    expect(resNegative.valid).toBe(false);
  });

  it("rejects setting only latitude without longitude", () => {
    const res = validateCoordinates("28.6139", "", "");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Both latitude and longitude are required together");
  });
});

describe("GIS Marker Status Mapping", () => {
  function getCameraMarkerStatus(
    cameraStatus: string | undefined,
    confirmedAccidents: number | undefined
  ): "incident" | "online" | "idle" {
    if ((confirmedAccidents ?? 0) > 0) return "incident";
    if (cameraStatus === "running") return "online";
    return "idle";
  }

  it("prioritizes active incident status over running state", () => {
    const status = getCameraMarkerStatus("running", 2);
    expect(status).toBe("incident");
  });

  it("returns online when camera is actively streaming with 0 accidents", () => {
    const status = getCameraMarkerStatus("running", 0);
    expect(status).toBe("online");
  });

  it("returns idle when camera is standby or paused", () => {
    const statusIdle = getCameraMarkerStatus("idle", 0);
    expect(statusIdle).toBe("idle");

    const statusPaused = getCameraMarkerStatus("paused", 0);
    expect(statusPaused).toBe("idle");
  });
});

describe("GIS Incident Time Filtering", () => {
  const now = new Date("2026-11-26T00:30:00Z").getTime();

  const mockIncidents = [
    { id: "inc_recent", confirmed_at: new Date(now - 30 * 60 * 1000).toISOString() }, // 30 min ago
    { id: "inc_yesterday", confirmed_at: new Date(now - 12 * 3600 * 1000).toISOString() }, // 12 hrs ago
    { id: "inc_three_days", confirmed_at: new Date(now - 3 * 24 * 3600 * 1000).toISOString() }, // 3 days ago
    { id: "inc_old", confirmed_at: new Date(now - 10 * 24 * 3600 * 1000).toISOString() }, // 10 days ago
  ];

  function filterIncidentsByRange(incidents: typeof mockIncidents, range: "1h" | "24h" | "7d", referenceTimeMs: number) {
    const windowMs =
      range === "1h"
        ? 3600 * 1000
        : range === "24h"
        ? 24 * 3600 * 1000
        : 7 * 24 * 3600 * 1000;

    return incidents.filter((inc) => {
      const incTime = new Date(inc.confirmed_at).getTime();
      return referenceTimeMs - incTime <= windowMs;
    });
  }

  it("correctly filters incidents for 1h window", () => {
    const res = filterIncidentsByRange(mockIncidents, "1h", now);
    expect(res.map((x) => x.id)).toEqual(["inc_recent"]);
  });

  it("correctly filters incidents for 24h window", () => {
    const res = filterIncidentsByRange(mockIncidents, "24h", now);
    expect(res.map((x) => x.id)).toEqual(["inc_recent", "inc_yesterday"]);
  });

  it("correctly filters incidents for 7d window", () => {
    const res = filterIncidentsByRange(mockIncidents, "7d", now);
    expect(res.map((x) => x.id)).toEqual(["inc_recent", "inc_yesterday", "inc_three_days"]);
  });
});
