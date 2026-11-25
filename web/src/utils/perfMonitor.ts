/**
 * Dev-only performance monitor tracking:
 * - AppShell & VideoStage renders per second
 * - Long tasks per 10 seconds (via PerformanceObserver)
 * - Main-thread JS time per frame (ms)
 * - JS heap size (MB)
 * - Live video canvas FPS
 */

export interface PerfMetrics {
  appShellRendersPerSec: number;
  videoStageRendersPerSec: number;
  longTasksPer10Sec: number;
  jsTimePerFrameMs: number;
  jsHeapSizeMB: number | null;
  videoCanvasFps: number;
  totalAppShellRenders: number;
  totalVideoStageRenders: number;
}

class PerformanceTracker {
  private appShellRenderCount = 0;
  private videoStageRenderCount = 0;
  private frameDrawCount = 0;
  private frameDrawTimes: number[] = [];
  private longTaskTimestamps: number[] = [];

  private currentMetrics: PerfMetrics = {
    appShellRendersPerSec: 0,
    videoStageRendersPerSec: 0,
    longTasksPer10Sec: 0,
    jsTimePerFrameMs: 0,
    jsHeapSizeMB: null,
    videoCanvasFps: 0,
    totalAppShellRenders: 0,
    totalVideoStageRenders: 0,
  };

  private listeners: Set<(m: PerfMetrics) => void> = new Set();
  private intervalId: any = null;

  constructor() {
    this.initLongTaskObserver();
    this.startTicker();
  }

  private initLongTaskObserver() {
    if (typeof window === "undefined" || !("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const now = performance.now();
        list.getEntries().forEach(() => {
          this.longTaskTimestamps.push(now);
        });
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // "longtask" may not be supported in some environments (e.g. Firefox/Safari/Vitest)
    }
  }

  private startTicker() {
    if (typeof window === "undefined") return;
    this.intervalId = setInterval(() => {
      const now = performance.now();

      // Prune long tasks older than 10s
      this.longTaskTimestamps = this.longTaskTimestamps.filter((t) => now - t <= 10000);

      // Average JS time per frame in the last second
      const avgFrameTime =
        this.frameDrawTimes.length > 0
          ? this.frameDrawTimes.reduce((a, b) => a + b, 0) / this.frameDrawTimes.length
          : 0;

      // JS Heap if available
      let heapMB: number | null = null;
      if (typeof window !== "undefined" && (window.performance as any)?.memory) {
        heapMB = Number(
          ((window.performance as any).memory.usedJSHeapSize / (1024 * 1024)).toFixed(1)
        );
      }

      this.currentMetrics = {
        appShellRendersPerSec: this.appShellRenderCount,
        videoStageRendersPerSec: this.videoStageRenderCount,
        longTasksPer10Sec: this.longTaskTimestamps.length,
        jsTimePerFrameMs: Number(avgFrameTime.toFixed(2)),
        jsHeapSizeMB: heapMB,
        videoCanvasFps: this.frameDrawCount,
        totalAppShellRenders: this.currentMetrics.totalAppShellRenders + this.appShellRenderCount,
        totalVideoStageRenders: this.currentMetrics.totalVideoStageRenders + this.videoStageRenderCount,
      };

      // Reset per-second buckets
      this.appShellRenderCount = 0;
      this.videoStageRenderCount = 0;
      this.frameDrawCount = 0;
      this.frameDrawTimes = [];

      this.notify();
    }, 1000);
  }

  public recordAppShellRender() {
    this.appShellRenderCount++;
  }

  public recordVideoStageRender() {
    this.videoStageRenderCount++;
  }

  public recordFrameDrawn(costMs: number) {
    this.frameDrawCount++;
    this.frameDrawTimes.push(costMs);
  }

  public getMetrics(): PerfMetrics {
    return this.currentMetrics;
  }

  public subscribe(cb: (m: PerfMetrics) => void): () => void {
    this.listeners.add(cb);
    cb(this.currentMetrics);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((cb) => cb(this.currentMetrics));
  }

  public destroy() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.listeners.clear();
  }
}

export const perfMonitor = new PerformanceTracker();
