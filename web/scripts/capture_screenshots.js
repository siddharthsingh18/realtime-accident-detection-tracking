import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../docs/screenshots");
const BASE = "http://localhost:4173";

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) resolve();
          else setTimeout(check, 300);
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error("Timeout waiting for preview server"));
          else setTimeout(check, 300);
        });
    };
    check();
  });
}

async function capture() {
  console.log("Starting preview server on port 4173...");
  const previewProcess = spawn("npm", ["run", "preview", "--", "--port", "4173"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  try {
    await waitForServer(BASE);
    console.log("Preview server ready at:", BASE);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // Route mocks for consistent rendering
    await page.route("**/api/cameras*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "cam_01", name: "Camera 01: North Junction", source: "sample1", lat: 28.6139, lng: 77.2090, notes: "North approach intersection CCTV", created_at: "2026-11-21", ignore_region: [[100, 100], [250, 100], [250, 250], [100, 250]] },
          { id: "cam_02", name: "Camera 02: Highway Merge", source: "sample2", lat: 28.6150, lng: 77.2105, notes: "Multi-lane arterial merge point", created_at: "2026-11-21", ignore_region: [] },
          { id: "cam_03", name: "Camera 03: South Crosswalk", source: "sample1", lat: 28.6120, lng: 77.2075, notes: "High-pedestrian crosswalk junction", created_at: "2026-11-21", ignore_region: [] },
          { id: "cam_04", name: "Camera 04: West Plaza", source: "sample2", lat: 28.6110, lng: 77.2060, notes: "Rotary interchange and plaza feed", created_at: "2026-11-21", ignore_region: [] },
        ]),
      });
    });

    await page.route("**/api/stats*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_incidents: 42,
          reviewed_count: 36,
          unreviewed_count: 6,
          true_accident_count: 28,
          false_alarm_count: 8,
          unsure_count: 0,
          false_alarm_share: 22.2,
          by_verdict: { true_accident: 28, false_alarm: 8 },
          by_origin: { detector: 20, collision_heuristic: 12, both: 10 },
          by_hour: [
            { hour: 8, count: 4 },
            { hour: 9, count: 7 },
            { hour: 10, count: 5 },
            { hour: 11, count: 3 },
            { hour: 12, count: 8 },
            { hour: 13, count: 6 },
            { hour: 14, count: 9 },
          ],
          by_day: [
            { date: "2026-11-15", count: 6 },
            { date: "2026-11-16", count: 8 },
            { date: "2026-11-17", count: 5 },
            { date: "2026-11-18", count: 9 },
            { date: "2026-11-19", count: 4 },
            { date: "2026-11-20", count: 10 },
          ],
          per_camera: { cam_01: 18, cam_02: 14, cam_03: 6, cam_04: 4 },
          time_range: {},
          camera_filter: null,
          insufficient_data: false,
          operator_caveat: "Based only on incidents an operator reviewed. Missed accidents are not counted and are not measurable here.",
        }),
      });
    });

    const mockIncidents = [
      {
        id: "inc-20261121-001",
        camera_id: "cam_01",
        session_id: "sess_sample1",
        zone_id: 1,
        origin: "detector",
        confirmed_at: "2026-11-21T06:14:22Z",
        cleared_at: "2026-11-21T06:15:05Z",
        peak_conf: 0.94,
        bbox: [320, 240, 580, 480],
        involved_vehicle_ids: [3, 7],
        snapshot_path: "data/incidents/inc-20261121-001/snapshot.jpg",
        clip_path: "data/incidents/inc-20261121-001/clip.mp4",
        verdict: "true_accident",
        verdict_note: "High-speed rear impact between sedan and SUV",
        verdict_at: "2026-11-21T06:16:10Z",
        settings: { accident_conf: 0.40, use_collision_heuristic: true },
        model_info: { arch: "YOLOv8s", weights: "accident_yolo11s.pt" },
        is_deleted: 0,
      },
      {
        id: "inc-20261121-002",
        camera_id: "cam_02",
        session_id: "sess_sample2",
        zone_id: 2,
        origin: "collision_heuristic",
        confirmed_at: "2026-11-21T06:22:45Z",
        cleared_at: null,
        peak_conf: 0.81,
        bbox: [410, 310, 620, 500],
        involved_vehicle_ids: [12, 14],
        snapshot_path: null,
        clip_path: null,
        verdict: null,
        verdict_note: null,
        verdict_at: null,
        settings: { accident_conf: 0.40, use_collision_heuristic: true },
        model_info: { arch: "YOLOv8s", weights: "accident_yolo11s.pt" },
        is_deleted: 0,
      },
    ];

    await page.route("**/api/incidents*", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/incidents/inc-20261121-001/audit")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, incident_id: "inc-20261121-001", old_verdict: null, new_verdict: "true_accident", note: "High-speed rear impact", changed_at: "2026-11-21T06:16:10Z" },
          ]),
        });
        return;
      }
      if (url.includes("/api/incidents/inc-20261121-001/notifications")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { id: 1, incident_id: "inc-20261121-001", channel: "telegram", status: "sent", attempts: 1, created_at: "2026-11-21T06:14:25Z" },
            { id: 2, incident_id: "inc-20261121-001", channel: "slack", status: "sent", attempts: 1, created_at: "2026-11-21T06:14:26Z" },
          ]),
        });
        return;
      }
      if (url.includes("/api/incidents/inc-20261121-001")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockIncidents[0]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: mockIncidents,
          total: 2,
          limit: 100,
          offset: 0,
        }),
      });
    });

    await page.route("**/api/settings/notifications*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cooldown_seconds: 60,
          channels: {
            telegram: { configured: true, error: null },
            slack: { configured: true, error: null },
            webhook: { configured: false, error: null },
            email: { configured: false, error: null },
          },
        }),
      });
    });

    await page.route("**/api/system/status*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_sessions: 2,
          max_concurrent_sessions: 4,
          device: "mps",
        }),
      });
    });

    // Helper function to capture full set of views for a theme
    async function captureThemeViews(themeName) {
      console.log(`\n--- Capturing ${themeName.toUpperCase()} theme views ---`);

      // 1. Dashboard (Normal State)
      console.log(`Capturing Dashboard (Normal) [${themeName}]...`);
      await page.goto(`${BASE}/analyze`);
      await page.waitForTimeout(600);
      await page.evaluate((th) => {
        if (window.useSessionStore) {
          window.useSessionStore.getState().setTheme(th);
          window.useSessionStore.getState().setTelemetry({
            frame_idx: 142,
            timestamp_ms: Date.now(),
            fps: 29.8,
            vehicles_in_frame: 4,
            vehicles_total_unique: 18,
            confirmed_accidents: 0,
            zones: [{ status: "TENTATIVE", conf: 0.42, bbox: [200, 150, 400, 300], zone_id: 1, involved_vehicle_ids: [2, 5] }],
            inference_ms: { total: 14.2 },
          });
        }
      }, themeName);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT_DIR, `dashboard_normal_${themeName}.png`), fullPage: true });

      // 2. Dashboard (Critical Alert State - Red Vignette & Beacon)
      console.log(`Capturing Dashboard (Critical Alert) [${themeName}]...`);
      await page.evaluate(() => {
        if (window.useSessionStore) {
          window.useSessionStore.getState().setTelemetry({
            frame_idx: 188,
            timestamp_ms: Date.now(),
            fps: 29.5,
            vehicles_in_frame: 3,
            vehicles_total_unique: 19,
            confirmed_accidents: 1,
            zones: [{ status: "ACTIVE", conf: 0.94, bbox: [220, 180, 450, 340], zone_id: 1, involved_vehicle_ids: [3, 7] }],
            inference_ms: { total: 15.1 },
          });
        }
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT_DIR, `dashboard_alert_${themeName}.png`), fullPage: true });

      // Reset confirmed accident state
      await page.evaluate(() => {
        if (window.useSessionStore) {
          window.useSessionStore.getState().setTelemetry(null);
        }
      });

      // 3. Live Wall
      console.log(`Capturing Live Wall [${themeName}]...`);
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT_DIR, `live_wall_${themeName}.png`), fullPage: true });

      // 4. Incidents Review Queue
      console.log(`Capturing Incidents Queue [${themeName}]...`);
      await page.goto(`${BASE}/incidents`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT_DIR, `incidents_${themeName}.png`), fullPage: true });

      // 5. Analytics View
      console.log(`Capturing Analytics View [${themeName}]...`);
      await page.goto(`${BASE}/analytics`);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT_DIR, `analytics_${themeName}.png`), fullPage: true });

      // 6. Settings View
      console.log(`Capturing Settings View [${themeName}]...`);
      await page.goto(`${BASE}/settings`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT_DIR, `settings_${themeName}.png`), fullPage: true });
    }

    // Capture in dark theme
    await captureThemeViews("dark");

    // Capture in light theme
    await captureThemeViews("light");

    await browser.close();
    console.log("\nAll required screenshots captured successfully to:", OUT_DIR);
  } finally {
    previewProcess.kill("SIGTERM");
  }
}

capture().catch((e) => {
  console.error(e);
  process.exit(1);
});
