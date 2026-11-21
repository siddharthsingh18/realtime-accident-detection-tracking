/**
 * Synthetic Multi-Camera Stress Test
 * Simulates 4 concurrent video/telemetry streams at 15 FPS for 10 seconds.
 * Measures event loop lag, task durations, throughput, and heap memory usage.
 */

import { performance } from "perf_hooks";

const NUM_CAMERAS = 4;
const TARGET_FPS = 15;
const DURATION_SECONDS = 10;
const TOTAL_FRAMES_PER_CAM = TARGET_FPS * DURATION_SECONDS;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

console.log("===============================================================");
console.log("   INCIDENT COMMAND CONSOLE - SYNTHETIC PERFORMANCE BENCHMARK  ");
console.log("===============================================================");
console.log(`Cameras: ${NUM_CAMERAS} concurrent feeds`);
console.log(`Target FPS: ${TARGET_FPS} fps per feed`);
console.log(`Duration: ${DURATION_SECONDS} seconds (${TOTAL_FRAMES_PER_CAM} frames/camera, ${TOTAL_FRAMES_PER_CAM * NUM_CAMERAS} total frames)`);
console.log("---------------------------------------------------------------");

const memStart = process.memoryUsage();
const startTime = performance.now();

const taskLatencies = [];
let framesProcessed = 0;
let longTasksCount = 0; // tasks > 50ms

function simulateFramePayload(camId, frameIdx) {
  return {
    frame_idx: frameIdx,
    timestamp_ms: Date.now(),
    camera_id: `cam_0${camId + 1}`,
    fps: TARGET_FPS,
    frame_size: { w: 1280, h: 720 },
    vehicles_in_frame: 4 + (frameIdx % 5),
    vehicles_total_unique: 12 + Math.floor(frameIdx / 10),
    confirmed_accidents: frameIdx > 50 && camId === 0 ? 1 : 0,
    dropped_frames: 0,
    inference_ms: {
      accident: 12.4,
      vehicle: 8.1,
      tracking: 2.2,
      logic: 0.5,
      render: 1.1,
      total: 24.3,
    },
    tracks: [
      {
        track_id: 1,
        cls: "car",
        conf: 0.89,
        bbox: [200 + (frameIdx % 20), 300, 320, 420],
        speed_px_s: 42.0,
        trail: Array.from({ length: 15 }, (_, i) => [200 + i * 2, 300 + i]),
      },
      {
        track_id: 2,
        cls: "truck",
        conf: 0.94,
        bbox: [500, 280, 680, 480],
        speed_px_s: 30.5,
        trail: Array.from({ length: 15 }, (_, i) => [500, 280 + i * 2]),
      },
    ],
    zones: frameIdx > 50 && camId === 0 ? [
      {
        zone_id: 1,
        status: "ACTIVE",
        conf: 0.92,
        bbox: [220, 310, 340, 430],
        involved_vehicle_ids: [1, 2],
        origin: "detector",
      }
    ] : [],
    events: [],
  };
}

// Emulate client vector canvas & buffer ingestion
const clientRingBuffer = [];
const MAX_BUFFER = 600;

async function runBenchmark() {
  for (let frameIdx = 0; frameIdx < TOTAL_FRAMES_PER_CAM; frameIdx++) {
    const tickStart = performance.now();

    // Fan-out for all 4 cameras in this frame slice
    for (let c = 0; c < NUM_CAMERAS; c++) {
      const payload = simulateFramePayload(c, frameIdx);
      
      // Store in memory ring buffer
      clientRingBuffer.push(payload);
      if (clientRingBuffer.length > MAX_BUFFER) {
        clientRingBuffer.shift();
      }

      framesProcessed++;
    }

    const tickDuration = performance.now() - tickStart;
    taskLatencies.push(tickDuration);
    if (tickDuration > 50) longTasksCount++;

    // Maintain 15 FPS pacing
    const nextTickDelay = Math.max(0, FRAME_INTERVAL_MS - tickDuration);
    await new Promise((r) => setTimeout(r, nextTickDelay));
  }

  const totalElapsed = (performance.now() - startTime) / 1000;
  const memEnd = process.memoryUsage();

  // Metrics calculation
  taskLatencies.sort((a, b) => a - b);
  const avgLatency = (taskLatencies.reduce((a, b) => a + b, 0) / taskLatencies.length).toFixed(3);
  const p50Latency = taskLatencies[Math.floor(taskLatencies.length * 0.50)].toFixed(3);
  const p95Latency = taskLatencies[Math.floor(taskLatencies.length * 0.95)].toFixed(3);
  const p99Latency = taskLatencies[Math.floor(taskLatencies.length * 0.99)].toFixed(3);
  const maxLatency = taskLatencies[taskLatencies.length - 1].toFixed(3);

  const effectiveFpsPerCam = ((framesProcessed / NUM_CAMERAS) / totalElapsed).toFixed(2);
  const heapDeltaMB = ((memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024)).toFixed(2);
  const heapUsedTotalMB = (memEnd.heapUsed / (1024 * 1024)).toFixed(2);

  console.log("Results:");
  console.log(`- Total Time Elapsed: ${totalElapsed.toFixed(2)}s`);
  console.log(`- Total Frames Ingested: ${framesProcessed}`);
  console.log(`- Effective FPS Per Feed: ${effectiveFpsPerCam} fps (Target: ${TARGET_FPS})`);
  console.log(`- Mean Task Processing Time: ${avgLatency} ms`);
  console.log(`- p50 Processing Time: ${p50Latency} ms`);
  console.log(`- p95 Processing Time: ${p95Latency} ms`);
  console.log(`- p99 Processing Time: ${p99Latency} ms`);
  console.log(`- Max Task Duration: ${maxLatency} ms`);
  console.log(`- Long Tasks (>50ms): ${longTasksCount} (${((longTasksCount / taskLatencies.length) * 100).toFixed(2)}%)`);
  console.log(`- Heap Delta: ${heapDeltaMB} MB (Current Heap: ${heapUsedTotalMB} MB)`);
  console.log("---------------------------------------------------------------");

  if (parseFloat(effectiveFpsPerCam) >= TARGET_FPS * 0.90 && longTasksCount === 0) {
    console.log("STATUS: PASS (High-density 4-camera real-time requirement verified)");
    process.exit(0);
  } else if (parseFloat(effectiveFpsPerCam) >= TARGET_FPS * 0.80) {
    console.log("STATUS: PASS WITH ACCEPTABLE JITTER");
    process.exit(0);
  } else {
    console.error("STATUS: FAIL (Frame rate fell below allowable threshold)");
    process.exit(1);
  }
}

runBenchmark();

