import React, { useRef, useEffect } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { AlertTriangle, PlayCircle, Eye, EyeOff } from "lucide-react";

interface Props {
  latestFrame: Blob | null;
}

export const VideoStage: React.FC<Props> = ({ latestFrame }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { status, telemetry, showClientBboxOverlay, toggleBboxOverlay, error } =
    useSessionStore();

  const currentBitmapRef = useRef<ImageBitmap | null>(null);

  // Render incoming Blob frame onto canvas
  useEffect(() => {
    if (!latestFrame) return;

    let isCancelled = false;

    createImageBitmap(latestFrame)
      .then((bitmap) => {
        if (isCancelled) {
          bitmap.close();
          return;
        }

        // Close previously held bitmap to free GPU/memory
        if (currentBitmapRef.current) {
          currentBitmapRef.current.close();
        }
        currentBitmapRef.current = bitmap;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Auto-adjust canvas resolution to match source video
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        requestAnimationFrame(() => {
          ctx.drawImage(bitmap, 0, 0);

          // Optional Client-side Bounding Box Overlay (defaults to off)
          if (showClientBboxOverlay && telemetry?.zones) {
            telemetry.zones.forEach((zone) => {
              const [x1, y1, x2, y2] = zone.bbox;
              const w = x2 - x1;
              const h = y2 - y1;

              ctx.lineWidth = 3;
              if (zone.status === "ACTIVE") {
                ctx.strokeStyle = "rgba(239, 68, 68, 0.9)"; // Red
                ctx.fillStyle = "rgba(239, 68, 68, 0.2)";
              } else if (zone.status === "MAINTAINED") {
                ctx.strokeStyle = "rgba(245, 158, 11, 0.9)"; // Amber
                ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
              } else {
                ctx.strokeStyle = "rgba(148, 163, 184, 0.7)"; // Tentative
                ctx.fillStyle = "rgba(148, 163, 184, 0.1)";
              }

              ctx.strokeRect(x1, y1, w, h);
              ctx.fillRect(x1, y1, w, h);

              // Pill label
              const label = `Client Overlay: Zone #${zone.zone_id} (${Math.round(
                zone.conf * 100
              )}%)`;
              ctx.font = "bold 14px monospace";
              const textWidth = ctx.measureText(label).width;
              ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
              ctx.fillRect(x1, Math.max(0, y1 - 24), textWidth + 12, 22);
              ctx.fillStyle = "#ffffff";
              ctx.fillText(label, x1 + 6, Math.max(16, y1 - 8));
            });
          }
        });
      })
      .catch((err) => {
        // Can fail if Blob is aborted or invalid
        console.debug("Frame bitmap decode skipped:", err);
      });

    return () => {
      isCancelled = true;
    };
  }, [latestFrame, showClientBboxOverlay, telemetry]);

  // Cleanup bitmap on unmount
  useEffect(() => {
    return () => {
      if (currentBitmapRef.current) {
        currentBitmapRef.current.close();
        currentBitmapRef.current = null;
      }
    };
  }, []);

  const hasFrame = latestFrame !== null;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center group"
    >
      {/* Video Canvas */}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-contain ${
          hasFrame ? "block" : "hidden"
        }`}
      />

      {/* Idle placeholder */}
      {!hasFrame && (status === "idle" || status === "finished") && (
        <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
          <PlayCircle className="w-16 h-16 stroke-1 text-slate-600 mb-3" />
          <p className="text-base font-semibold text-slate-300">
            {status === "finished" ? "Stream Finished" : "Video Feed Inactive"}
          </p>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            {status === "finished"
              ? "All frames processed. Select another source or click Start to re-run."
              : "Select an input source above and press Start Stream to begin real-time detection."}
          </p>
        </div>
      )}

      {/* Connecting overlay */}
      {status === "connecting" && (
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-semibold text-slate-200">
            Initializing AI Pipeline...
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Loading YOLOv8 models & allocating tracking session
          </p>
        </div>
      )}

      {/* Paused banner overlay */}
      {status === "paused" && (
        <div className="absolute top-4 left-4 z-20 bg-amber-950/80 border border-amber-600/70 text-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase backdrop-blur flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>PAUSED (Press Space to Resume)</span>
        </div>
      )}

      {/* Error state overlay */}
      {status === "error" && (
        <div className="absolute inset-0 bg-rose-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
          <AlertTriangle className="w-12 h-12 text-rose-400 mb-2" />
          <p className="text-sm font-bold text-rose-200">Stream Error Occurred</p>
          <p className="text-xs text-rose-300/80 mt-1 max-w-md font-mono bg-black/40 p-2 rounded border border-rose-900">
            {error || "Pipeline terminated unexpectedly. Check server logs."}
          </p>
        </div>
      )}

      {/* HUD overlay tools on hover (Client overlay toggle) */}
      {hasFrame && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 flex items-center gap-2">
          <button
            onClick={toggleBboxOverlay}
            className={`px-2.5 py-1 rounded text-xs font-medium backdrop-blur border flex items-center gap-1.5 transition ${
              showClientBboxOverlay
                ? "bg-indigo-600/80 text-white border-indigo-400"
                : "bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
            title="Toggle client-side bounding box overlay"
          >
            {showClientBboxOverlay ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>Client Overlay: {showClientBboxOverlay ? "ON" : "OFF"}</span>
          </button>
        </div>
      )}
    </div>
  );
};

