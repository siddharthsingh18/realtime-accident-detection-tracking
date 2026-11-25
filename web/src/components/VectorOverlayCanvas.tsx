import React, { useRef, useEffect, useCallback } from "react";
import { TelemetryMessage } from "../api/types";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";

interface Props {
  telemetry: TelemetryMessage | null;
  width: number;
  height: number;
  onHoverTarget?: (target: { type: "zone" | "track"; data: any; x: number; y: number } | null) => void;
}

export const VectorOverlayCanvas: React.FC<Props> = ({
  telemetry,
  width,
  height,
  onHoverTarget,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const telemetryRef = useRef<TelemetryMessage | null>(telemetry);
  telemetryRef.current = telemetry;

  const isVisibleRef = useRef<boolean>(true);
  const animIdRef = useRef<number | null>(null);

  const {
    showZoneBoxes,
    showVehicleBoxes,
    showMotionTrails,
    showGhostOutlines,
    showSpeedVectors,
  } = useSessionStore(
    useShallow((s) => ({
      showZoneBoxes: s.showZoneBoxes,
      showVehicleBoxes: s.showVehicleBoxes,
      showMotionTrails: s.showMotionTrails,
      showGhostOutlines: s.showGhostOutlines,
      showSpeedVectors: s.showSpeedVectors,
    }))
  );

  const render = useCallback(() => {
    animIdRef.current = null;
    if (!isVisibleRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const msg = telemetryRef.current;
    if (!msg) {
      ctx.restore();
      return;
    }

    const scaleX = width / (msg.frame_size?.w || 1280);
    const scaleY = height / (msg.frame_size?.h || 720);

    // 1. Motion Trails
    if (showMotionTrails && msg.tracks) {
      msg.tracks.forEach((track) => {
        if (track.trail && track.trail.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(56, 189, 248, 0.4)"; // Sky blue
          ctx.lineWidth = 2;
          ctx.setLineDash([2, 4]);

          track.trail.forEach(([tx, ty], i) => {
            const sx = tx * scaleX;
            const sy = ty * scaleY;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    // 2. Vehicle Boxes, Ghost Outlines, and Speed Vectors
    if (msg.tracks) {
      msg.tracks.forEach((track) => {
        const [x1, y1, x2, y2] = track.bbox;
        const sx1 = x1 * scaleX;
        const sy1 = y1 * scaleY;
        const sw = (x2 - x1) * scaleX;
        const sh = (y2 - y1) * scaleY;

        if (track.suppressed) {
          if (showGhostOutlines) {
            // Ghost outline inside accident zone
            ctx.strokeStyle = "rgba(244, 63, 94, 0.5)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(sx1, sy1, sw, sh);
            ctx.setLineDash([]);
          }
        } else if (showVehicleBoxes) {
          // Normal vehicle box
          ctx.strokeStyle = "rgba(59, 130, 246, 0.85)"; // Blue
          ctx.lineWidth = 2;
          ctx.strokeRect(sx1, sy1, sw, sh);

          // Pill label
          const label = `#${track.track_id} ${track.cls} ${(track.conf * 100).toFixed(0)}%`;
          ctx.font = "bold 11px monospace";
          const textW = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.fillRect(sx1, Math.max(0, sy1 - 18), textW + 8, 16);
          ctx.fillStyle = "#38bdf8";
          ctx.fillText(label, sx1 + 4, Math.max(12, sy1 - 6));
        }

        // Speed Vector
        const speed = track.speed_px_s || 0;
        if (showSpeedVectors && speed > 5) {
          const cx = sx1 + sw / 2;
          const cy = sy1 + sh / 2;
          const vecLen = Math.min(40, speed * 0.15);
          ctx.beginPath();
          ctx.strokeStyle = "rgba(251, 191, 36, 0.75)"; // Amber
          ctx.lineWidth = 2;
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy - vecLen);
          ctx.stroke();
        }
      });
    }

    // 3. Zone Boxes with Corner Brackets
    if (showZoneBoxes && msg.zones) {
      msg.zones.forEach((zone) => {
        const [x1, y1, x2, y2] = zone.bbox;
        const sx1 = x1 * scaleX;
        const sy1 = y1 * scaleY;
        const sw = (x2 - x1) * scaleX;
        const sh = (y2 - y1) * scaleY;

        let strokeColor = "rgba(239, 68, 68, 0.95)"; // Active: intense red
        let fillColor = "rgba(239, 68, 68, 0.18)";
        if (zone.status === "MAINTAINED") {
          strokeColor = "rgba(244, 63, 94, 0.95)"; // Maintained/Held: vivid rose-red
          fillColor = "rgba(244, 63, 94, 0.15)";
        } else if (zone.status === "TENTATIVE") {
          strokeColor = "rgba(251, 146, 60, 0.85)"; // Tentative candidate: warning amber-orange
          fillColor = "rgba(251, 146, 60, 0.08)";
        }

        // Shaded fill
        ctx.fillStyle = fillColor;
        ctx.fillRect(sx1, sy1, sw, sh);

        // Full boundary
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx1, sy1, sw, sh);

        // Corner Brackets
        const bracketLen = Math.min(18, sw / 3, sh / 3);
        ctx.lineWidth = 3.5;

        // Top-Left
        ctx.beginPath();
        ctx.moveTo(sx1, sy1 + bracketLen);
        ctx.lineTo(sx1, sy1);
        ctx.lineTo(sx1 + bracketLen, sy1);
        ctx.stroke();

        // Top-Right
        ctx.beginPath();
        ctx.moveTo(sx1 + sw - bracketLen, sy1);
        ctx.lineTo(sx1 + sw, sy1);
        ctx.lineTo(sx1 + sw, sy1 + bracketLen);
        ctx.stroke();

        // Bottom-Left
        ctx.beginPath();
        ctx.moveTo(sx1, sy1 + sh - bracketLen);
        ctx.lineTo(sx1, sy1 + sh);
        ctx.lineTo(sx1 + bracketLen, sy1 + sh);
        ctx.stroke();

        // Bottom-Right
        ctx.beginPath();
        ctx.moveTo(sx1 + sw - bracketLen, sy1 + sh);
        ctx.lineTo(sx1 + sw, sy1 + sh);
        ctx.lineTo(sx1 + sw, sy1 + sh - bracketLen);
        ctx.stroke();

        // Pill Header
        const originLabel = zone.origin === "collision_heuristic" ? "Overlap Rule" : zone.origin === "both" ? "Dual Verified" : "Detector";
        const pillText = `ZONE #${zone.zone_id} [${zone.status}] ${(zone.conf * 100).toFixed(0)}% • ${originLabel}`;
        ctx.font = "bold 12px monospace";
        const tw = ctx.measureText(pillText).width;

        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.fillRect(sx1, Math.max(0, sy1 - 22), tw + 12, 20);
        ctx.fillStyle = zone.status === "ACTIVE" ? "#f87171" : "#fbbf24";
        ctx.fillText(pillText, sx1 + 6, Math.max(14, sy1 - 8));
      });
    }

    ctx.restore();

    // Only keep animating if an active zone is actively pulsing
    const hasPulsingAnimation = msg.zones && msg.zones.some((z) => z.status === "ACTIVE");
    if (hasPulsingAnimation && isVisibleRef.current) {
      animIdRef.current = requestAnimationFrame(render);
    }
  }, [
    width,
    height,
    showZoneBoxes,
    showVehicleBoxes,
    showMotionTrails,
    showGhostOutlines,
    showSpeedVectors,
  ]);

  const scheduleRender = useCallback(() => {
    if (animIdRef.current === null && isVisibleRef.current) {
      animIdRef.current = requestAnimationFrame(render);
    }
  }, [render]);

  // Schedule render on new telemetry or dimension changes
  useEffect(() => {
    scheduleRender();
  }, [telemetry, scheduleRender]);

  // IntersectionObserver to pause rendering when off-screen
  useEffect(() => {
    if (!canvasRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      isVisibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting) {
        scheduleRender();
      } else if (animIdRef.current) {
        cancelAnimationFrame(animIdRef.current);
        animIdRef.current = null;
      }
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [scheduleRender]);

  // Pause when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        isVisibleRef.current = false;
        if (animIdRef.current) {
          cancelAnimationFrame(animIdRef.current);
          animIdRef.current = null;
        }
      } else {
        isVisibleRef.current = true;
        scheduleRender();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [scheduleRender]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animIdRef.current) {
        cancelAnimationFrame(animIdRef.current);
        animIdRef.current = null;
      }
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onHoverTarget || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const msg = telemetryRef.current;
    if (!msg) {
      onHoverTarget(null);
      return;
    }

    const scaleX = width / (msg.frame_size?.w || 1280);
    const scaleY = height / (msg.frame_size?.h || 720);

    // Check zones first
    if (msg.zones) {
      for (const z of msg.zones) {
        const [x1, y1, x2, y2] = z.bbox;
        const sx1 = x1 * scaleX;
        const sy1 = y1 * scaleY;
        const sx2 = x2 * scaleX;
        const sy2 = y2 * scaleY;
        if (mx >= sx1 && mx <= sx2 && my >= sy1 && my <= sy2) {
          onHoverTarget({ type: "zone", data: z, x: mx, y: my });
          return;
        }
      }
    }

    // Check tracks
    if (msg.tracks) {
      for (const t of msg.tracks) {
        const [x1, y1, x2, y2] = t.bbox;
        const sx1 = x1 * scaleX;
        const sy1 = y1 * scaleY;
        const sx2 = x2 * scaleX;
        const sy2 = y2 * scaleY;
        if (mx >= sx1 && mx <= sx2 && my >= sy1 && my <= sy2) {
          onHoverTarget({ type: "track", data: t, x: mx, y: my });
          return;
        }
      }
    }

    onHoverTarget(null);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: `${width}px`, height: `${height}px` }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHoverTarget && onHoverTarget(null)}
      className="absolute inset-0 pointer-events-auto cursor-crosshair z-10"
    />
  );
};
