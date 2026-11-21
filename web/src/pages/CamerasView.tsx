import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { CameraItem } from "../api/types";
import { useSessionStore } from "../store/useSessionStore";
import {
  Camera,
  MapPin,
  Info,
} from "lucide-react";

export const CamerasView: React.FC = () => {
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [selectedCam, setSelectedCam] = useState<CameraItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Ignore region drawing state
  const [points, setPoints] = useState<[number, number][]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { cameraTelemetry } = useSessionStore();

  const fetchCameras = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCameras();
      setCameras(data);
      if (data.length > 0 && !selectedCam) {
        setSelectedCam(data[0]);
        setPoints(data[0].ignore_region as any || []);
      }
    } catch (e) {
      console.warn("Could not load cameras:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedCam]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const handleSelectCamera = (cam: CameraItem) => {
    setSelectedCam(cam);
    setPoints(cam.ignore_region as any || []);
  };

  // Draw polygon on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background simulated road grid
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    if (points.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(244, 63, 94, 0.25)";

      points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });

      if (points.length >= 3) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();

      // Draw vertices
      points.forEach(([px, py]) => {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#f43f5e";
        ctx.stroke();
      });
    }
  }, [points]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    if (points.length >= 8) {
      return; // Cap at 8 points
    }
    setPoints([...points, [x, y]]);
  };

  const handleSaveIgnoreRegion = async () => {
    if (!selectedCam) return;
    try {
      const updated = await api.updateCamera(selectedCam.id, {
        ignore_region: points,
      });
      setSelectedCam(updated);
      setCameras((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      alert("Ignore region saved successfully.");
    } catch (err) {
      console.error("Failed to save ignore region:", err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-2xl backdrop-blur flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-extrabold uppercase tracking-wide">
              CCTV Camera Inventory & Ignore Regions
            </h2>
          </div>
          <p className="text-[11px] text-slate-400">
            Configure camera feeds, GPS pins, and draw exclusion zones to filter out false alarms.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: Camera List */}
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Registered Cameras ({cameras.length})
          </div>

          {loading && (
            <div className="p-4 text-xs font-mono text-slate-500">Loading cameras...</div>
          )}

          {cameras.map((cam) => {
            const isSelected = selectedCam?.id === cam.id;
            const tel = cameraTelemetry[cam.id];
            const isAlert = tel && tel.confirmed_accidents > 0;

            return (
              <div
                key={cam.id}
                onClick={() => handleSelectCamera(cam)}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start justify-between ${
                  isSelected
                    ? "bg-slate-800/90 border-emerald-500 shadow-lg ring-1 ring-emerald-500"
                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-850"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isAlert ? "bg-red-500 animate-ping" : "bg-emerald-400"
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-100">{cam.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    ID: {cam.id} • Source: {cam.source}
                  </div>
                  {cam.notes && <p className="text-[11px] text-slate-500">{cam.notes}</p>}
                </div>

                <span className="font-mono text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-400 uppercase">
                  {cam.ignore_region?.length ? `${cam.ignore_region.length} pts ROI` : "Full Frame"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right: Ignore Region Polygon Editor & Offline Map (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Ignore Region Polygon Editor: {selectedCam?.name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Click on the grid to add polygon vertices. Detections inside are discarded server-side.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPoints([])}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
                >
                  Clear Points
                </button>
                <button
                  onClick={handleSaveIgnoreRegion}
                  disabled={points.length > 0 && points.length < 3}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg disabled:opacity-50"
                >
                  Save Region
                </button>
              </div>
            </div>

            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 cursor-crosshair">
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                onClick={handleCanvasClick}
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex justify-between items-center text-[11px] font-mono text-slate-400">
              <span>Points defined: {points.length} (minimum 3 for polygon)</span>
              <span>Coordinates scaled to frame resolution server-side</span>
            </div>
          </div>

          {/* Local Coordinate Camera Grid Map */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <span>Stationary CCTV Network Placement Map</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-500">Offline Coordinate Grid</span>
            </div>

            <div className="h-44 bg-slate-950 rounded-xl border border-slate-800 relative overflow-hidden flex items-center justify-center p-4">
              {cameras.map((c, i) => {
                const tel = cameraTelemetry[c.id];
                const isAlert = tel && tel.confirmed_accidents > 0;
                // Position pins across grid
                const left = 20 + (i % 3) * 30;
                const top = 25 + Math.floor(i / 3) * 45;

                return (
                  <div
                    key={c.id}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer group"
                  >
                    <div
                      className={`p-1.5 rounded-full shadow-lg ${
                        isAlert
                          ? "bg-red-600 text-white animate-bounce"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[10px] font-mono bg-slate-900/90 text-slate-300 px-1.5 py-0.5 rounded mt-1 border border-slate-700 whitespace-nowrap">
                      {c.name}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span>Fixed CCTV cameras recommended. Moving cameras (dashcams, drones) require homography calibration.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
