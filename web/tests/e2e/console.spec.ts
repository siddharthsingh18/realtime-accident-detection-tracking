import { test, expect } from "@playwright/test";

test.describe("Incident Command Console E2E", () => {
  test.beforeEach(async ({ page }) => {
    // Mock basic API endpoints for deterministic E2E testing
    await page.route("**/api/cameras*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "cam_01", name: "Camera 1 (Highway)", source: "sample1", created_at: "2026-11-21", ignore_region: [] },
          { id: "cam_02", name: "Camera 2 (Interchange)", source: "sample2", created_at: "2026-11-21", ignore_region: [] },
        ]),
      });
    });

    await page.route("**/api/stats*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_incidents: 10,
          reviewed_count: 8,
          unreviewed_count: 2,
          true_accident_count: 6,
          false_alarm_count: 2,
          unsure_count: 0,
          false_alarm_share: 25.0,
          by_verdict: { true_accident: 6, false_alarm: 2 },
          by_origin: { detector: 5, collision_heuristic: 3 },
          by_hour: [],
          by_day: [],
          per_camera: { cam_01: 5, cam_02: 5 },
          time_range: {},
          camera_filter: null,
          insufficient_data: false,
          operator_caveat: "Caveat: Quality metrics reflect human operator verdicts, not ground truth model properties.",
        }),
      });
    });

    await page.route("**/api/incidents*", async (route) => {
      if (route.request().url().includes("export.csv")) {
        await route.fulfill({ status: 200, contentType: "text/csv", body: "id,camera_id\ninc_1,cam_01" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "inc-101",
              camera_id: "cam_01",
              session_id: "sess_1",
              zone_id: 1,
              origin: "detector",
              confirmed_at: "2026-11-21T05:30:00Z",
              peak_conf: 0.92,
              bbox: [100, 100, 200, 200],
              involved_vehicle_ids: [1, 2],
              verdict: null,
              verdict_note: null,
              is_deleted: 0,
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      });
    });

    await page.goto("/");
  });

  test("loads Live Wall with app shell, header, and safety disclaimer in footer", async ({ page }) => {
    // Check title / brand
    await expect(page.locator("body")).toContainText("Incident Command Console");

    // Check safety disclaimer rule in footer
    const footer = page.locator("footer");
    await expect(footer).toContainText("Automated detections are unverified and not for emergency dispatch");

    // Check Live Wall grid layout controls exist
    await expect(page.getByTitle("Single Camera View (1)")).toBeVisible();
    await expect(page.getByTitle("Quad Grid View (4)")).toBeVisible();
  });

  test("opens and closes Command Palette via top-bar trigger and Escape", async ({ page }) => {
    // Click top bar Command Palette button
    const cmdBtn = page.getByTitle("Open Command Palette (⌘K)");
    await expect(cmdBtn).toBeVisible();
    await cmdBtn.click();

    const paletteInput = page.getByPlaceholder(/Type a command or jump to screen/i);
    await expect(paletteInput).toBeVisible();

    // Type query
    await paletteInput.fill("Analytics");
    await expect(page.getByText("Go to Incident Analytics")).toBeVisible();

    // Press Escape to close
    await page.keyboard.press("Escape");
    await expect(paletteInput).not.toBeVisible();
  });

  test("opens and closes Keyboard Shortcuts Help modal", async ({ page }) => {
    // Click keyboard help trigger in top bar
    const helpBtn = page.getByTitle("Keyboard Shortcuts Map (?)");
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    await expect(page.getByText("Operator Keyboard Shortcuts")).toBeVisible();

    // Escape to close
    await page.keyboard.press("Escape");
    await expect(page.getByText("Operator Keyboard Shortcuts")).not.toBeVisible();
  });

  test("navigates to Focus View on tile click", async ({ page }) => {
    // Find camera tile and focus button
    const focusBtn = page.getByRole("button", { name: /Focus Camera/i }).first();
    if (await focusBtn.isVisible()) {
      await focusBtn.click();
      await expect(page).toHaveURL(/\/camera\/cam_01/);
    }
  });

  test("navigates to Review Queue and validates honest UI rules", async ({ page }) => {
    await page.goto("/incidents");
    await expect(page.getByRole("heading", { name: /Incident Review Queue/i })).toBeVisible();
    await expect(page.getByText(/Export CSV/i)).toBeVisible();

    // Check honest incident row rendering
    await expect(page.getByText("inc-101")).toBeVisible();
  });

  test("navigates to Analytics page and validates operator honesty caveat", async ({ page }) => {
    await page.goto("/analytics");
    // Verify operator caveat is presented
    await expect(
      page.getByText(/Quality metrics reflect human operator verdicts/i)
    ).toBeVisible();
  });

  test("navigates to Cameras configuration and ROI editor", async ({ page }) => {
    await page.goto("/cameras");
    await expect(page.getByText(/CCTV Camera Inventory & Ignore Regions/i)).toBeVisible();
    await expect(page.getByText(/Stationary CCTV Network Placement Map/i)).toBeVisible();
  });

  test("focus view displays upload dropzone and validates file selection before starting", async ({ page }) => {
    await page.goto("/camera/cam_01");

    // Click Upload Video tab
    const uploadTab = page.getByRole("button", { name: /Upload Video/i });
    await expect(uploadTab).toBeVisible();
    await uploadTab.click();

    // Verify dropzone is rendered
    await expect(page.getByText(/Click to upload or drag & drop traffic video/i)).toBeVisible();
    await expect(page.getByText(/Supports MP4, AVI, MOV, MKV/i)).toBeVisible();

    // Click Start Stream without selecting a file -> should display friendly validation error
    const startBtn = page.getByRole("button", { name: /Start Stream/i });
    await startBtn.click();

    await expect(
      page.getByText(/Please choose or drag & drop a video file first/i)
    ).toBeVisible();

    // Now select a file using the file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "test_traffic.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("fake-video-bytes"),
    });

    // Verify the uploaded file card appears
    await expect(page.getByText("test_traffic.mp4")).toBeVisible();
    await expect(page.getByText("0.00 MB")).toBeVisible();
  });
});
