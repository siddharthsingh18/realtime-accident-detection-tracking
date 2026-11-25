import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { CameraItem } from "../api/types";
import { useSessionStore } from "../store/useSessionStore";
import { GlassCard } from "../components/ui/GlassCard";
import {
  Camera,
  MapPin,
  Info,
  Trash2,
  Undo2,
  ShieldAlert,
  Crosshair,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;
const VERTEX_RADIUS = 7;
const HIT_RADIUS = 12;

type EditorMode = "ignore" | "detection";

export const CamerasView: React.FC = () => {
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [selectedCam, setSelectedCam] = useState<CameraItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Polygon editor state (stored in canvas pixel coordinates [0..CANVAS_WIDTH, 0..CANVAS_HEIGHT])
  const [points, setPoints] = useState<[number, number][]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<EditorMode>("ignore");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraTelemetry = useSessionStore((s) => s.cameraTelemetry);

  // Convert incoming coordinates (normalized [0..1] or legacy pixels) to canvas pixels
  const parseIncomingPoints = useCallback((raw: any[]): [number, number][] => {
    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
    const isNormalized = raw.every(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number(p[0]) >= 0 &&
        Number(p[0]) <= 1.0 &&
        Number(p[1]) >= 0 &&
        Number(p[1]) <= 1.0
    );

    return raw.map((p) => {
      const px = Number(p[0]);
      const py = Number(p[1]);
      if (isNormalized) {
        return [
          Math.round(px * CANVAS_WIDTH),
          Math.round(py * CANVAS_HEIGHT),
        ];
      }
      return [Math.round(px), Math.round(py)];
    });
  }, []);

  const fetchCameras = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCameras();
      setCameras(data);
      if (data.length > 0 && !selectedCam) {
        setSelectedCam(data[0]);
        setPoints(parseIncomingPoints(data[0].ignore_region as any || []));
      }
    } catch (e) {
      console.warn("Could not load cameras:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedCam, parseIncomingPoints]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const handleSelectCamera = (cam: CameraItem) => {
    setSelectedCam(cam);
    setPoints(parseIncomingPoints(cam.ignore_region as any || []));
    setSelectedIndex(null);
    setHoverIndex(null);
    setSaveStatus(null);
  };

  // Find nearest vertex index within hit radius
  const getVertexAtPosition = (
    x: number,
    y: number
  ): number | null => {
    for (let i = 0; i < points.length; i++) {
      const [vx, vy] = points[i];
      const dist = Math.hypot(vx - x, vy - y);
      if (dist <= HIT_RADIUS) {
        return i;
      }
    }
    return null;
  };

  // Draw polygon, grid, and interactive vertex handles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Dark road canvas background with grid
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#1e293b";
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

    // 2. Horizon and lane perspective guides
    ctx.strokeStyle = "#334155";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.45);
    ctx.lineTo(canvas.width, canvas.height * 0.45);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Render Polygon
    if (points.length > 0) {
      const strokeColor = mode === "ignore" ? "#f43f5e" : "#10b981";
      const fillColor =
        mode === "ignore"
          ? "rgba(244, 63, 94, 0.28)"
          : "rgba(16, 185, 129, 0.28)";

      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.fillStyle = fillColor;

      points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });

      if (points.length >= 3) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();

      // Hatch pattern for ignore region to visually designate exclusion
      if (mode === "ignore" && points.length >= 3) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgba(244, 63, 94, 0.20)";
        ctx.lineWidth = 1.5;
        for (let i = -canvas.height; i < canvas.width + canvas.height; i += 20) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + canvas.height, canvas.height);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 4. Render Vertex Handles
      points.forEach(([px, py], i) => {
        const isHovered = hoverIndex === i;
        const isSelected = selectedIndex === i;
        const isBeingDragged = isDragging && dragIndex === i;

        // Outer glow on hover or drag
        if (isHovered || isSelected || isBeingDragged) {
          ctx.beginPath();
          ctx.arc(px, py, VERTEX_RADIUS + 5, 0, Math.PI * 2);
          ctx.fillStyle = isSelected
            ? "rgba(59, 130, 246, 0.45)"
            : "rgba(244, 63, 94, 0.35)";
          ctx.fill();
        }

        // Vertex Circle
        ctx.beginPath();
        ctx.arc(px, py, VERTEX_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#3b82f6" : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Label Pill: P1, P2...
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px monospace";
        const label = `P${i + 1}`;
        ctx.fillText(label, px + 9, py - 6);
      });
    }
  }, [points, hoverIndex, selectedIndex, isDragging, dragIndex, mode]);

  // Canvas Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    // Left click only
    if (e.button !== 0) return;

    const hit = getVertexAtPosition(x, y);
    if (hit !== null) {
      // Begin dragging existing vertex
      setIsDragging(true);
      setDragIndex(hit);
      setSelectedIndex(hit);
    } else {
      // Add new vertex (limit up to 12 vertices)
      if (points.length >= 12) {
        alert("Maximum 12 vertices allowed for exclusion polygon.");
        return;
      }
      const newPoints: [number, number][] = [...points, [x, y]];
      setPoints(newPoints);
      setSelectedIndex(newPoints.length - 1);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(CANVAS_WIDTH, Math.round(e.clientX - rect.left)));
    const y = Math.max(0, Math.min(CANVAS_HEIGHT, Math.round(e.clientY - rect.top)));

    if (isDragging && dragIndex !== null) {
      // Move dragged vertex
      const updated = [...points];
      updated[dragIndex] = [x, y];
      setPoints(updated);
    } else {
      // Hover detection
      const hit = getVertexAtPosition(x, y);
      setHoverIndex(hit);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragIndex(null);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);

    const hit = getVertexAtPosition(x, y);
    if (hit !== null) {
      // Right-click deletes targeted vertex
      deleteVertex(hit);
    }
  };

  const deleteVertex = (idx: number) => {
    const updated = points.filter((_, i) => i !== idx);
    setPoints(updated);
    if (selectedIndex === idx) {
      setSelectedIndex(null);
    } else if (selectedIndex !== null && selectedIndex > idx) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleUndo = () => {
    if (points.length > 0) {
      setPoints(points.slice(0, -1));
      setSelectedIndex(null);
    }
  };

  const handleClear = () => {
    setPoints([]);
    setSelectedIndex(null);
    setHoverIndex(null);
  };

  // Quick presets for common road CCTV false alarm zones
  const applyPreset = (presetType: "overhead" | "left_sidewalk" | "right_shoulder" | "center_median") => {
    switch (presetType) {
      case "overhead":
        // Top 25% overhead sign / gantry
        setPoints([
          [0, 0],
          [CANVAS_WIDTH, 0],
          [CANVAS_WIDTH, Math.round(CANVAS_HEIGHT * 0.28)],
          [0, Math.round(CANVAS_HEIGHT * 0.28)],
        ]);
        break;
      case "left_sidewalk":
        // Left peripheral sidewalk / walkway
        setPoints([
          [0, 0],
          [Math.round(CANVAS_WIDTH * 0.22), 0],
          [Math.round(CANVAS_WIDTH * 0.28), CANVAS_HEIGHT],
          [0, CANVAS_HEIGHT],
        ]);
        break;
      case "right_shoulder":
        // Right shoulder / parking lane
        setPoints([
          [Math.round(CANVAS_WIDTH * 0.78), 0],
          [CANVAS_WIDTH, 0],
          [CANVAS_WIDTH, CANVAS_HEIGHT],
          [Math.round(CANVAS_WIDTH * 0.72), CANVAS_HEIGHT],
        ]);
        break;
      case "center_median":
        // Central concrete divider / barrier
        setPoints([
          [Math.round(CANVAS_WIDTH * 0.44), Math.round(CANVAS_HEIGHT * 0.40)],
          [Math.round(CANVAS_WIDTH * 0.56), Math.round(CANVAS_HEIGHT * 0.40)],
          [Math.round(CANVAS_WIDTH * 0.58), CANVAS_HEIGHT],
          [Math.round(CANVAS_WIDTH * 0.42), CANVAS_HEIGHT],
        ]);
        break;
    }
    setSelectedIndex(null);
  };

  const handleSaveRegion = async () => {
    if (!selectedCam) return;
    try {
      // Normalize canvas coordinates to floats [0.0000 .. 1.0000]
      const normalizedCoordinates = points.map(([x, y]) => [
        Number((x / CANVAS_WIDTH).toFixed(4)),
        Number((y / CANVAS_HEIGHT).toFixed(4)),
      ]);

      const updated = await api.updateCamera(selectedCam.id, {
        ignore_region: normalizedCoordinates,
      });

      setSelectedCam(updated);
      setCameras((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSaveStatus("Saved & normalized to [0..1]!");
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      console.error("Failed to save ignore region:", err);
      alert("Failed to save region to server.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassCard className="p-4 flex items-center justify-between" glowColor="cyan">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-100">
              CCTV Camera Inventory & Interactive ROI Editor
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Draw, edit, and drag polygon vertices on frame canvas. Coordinates are normalized to survive any resolution change.
          </p>
        </div>
      </GlassCard>

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

                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-400 uppercase">
                    {cam.ignore_region?.length ? `${cam.ignore_region.length} pts ROI` : "Full Frame"}
                  </span>
                  {cam.id === "cam_01" && (
                    <span className="font-mono text-[9px] bg-emerald-950/60 border border-emerald-800 text-emerald-400 px-1.5 py-0.5 rounded">
                      Calibrated km/h
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Interactive Polygon Editor Canvas */}
        <div className="lg:col-span-2 space-y-4">
          <GlassCard className="p-4 shadow-xl space-y-3" glowColor="cyan">
            {/* Top Editor Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <span>Interactive ROI Polygon Editor:</span>
                  <span className="text-emerald-400">{selectedCam?.name}</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Left-click to add/drag vertices • Right-click on vertex to delete
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setMode("ignore")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition ${
                    mode === "ignore"
                      ? "bg-rose-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Ignore Region</span>
                </button>
                <button
                  onClick={() => setMode("detection")}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition ${
                    mode === "detection"
                      ? "bg-emerald-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Detection Zone</span>
                </button>
              </div>
            </div>

            {/* Canvas Viewport */}
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center select-none">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
                className="w-full h-full object-contain cursor-crosshair"
                style={{
                  cursor: isDragging
                    ? "grabbing"
                    : hoverIndex !== null
                    ? "grab"
                    : "crosshair",
                }}
              />

              {/* Status pill overlay */}
              <div className="absolute top-2 left-2 flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                    mode === "ignore"
                      ? "bg-rose-950/90 border-rose-800 text-rose-300"
                      : "bg-emerald-950/90 border-emerald-800 text-emerald-300"
                  }`}
                >
                  {mode === "ignore" ? "Exclusion Zone (Alerts Suppressed)" : "Detection Zone (ROI)"}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-black/80 border border-slate-800 text-slate-300">
                  {points.length} vertices
                </span>
              </div>
            </div>

            {/* Presets and Editor Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-mono text-slate-500 mr-1">Presets:</span>
                <button
                  onClick={() => applyPreset("overhead")}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded font-medium transition"
                >
                  Overhead Sign
                </button>
                <button
                  onClick={() => applyPreset("left_sidewalk")}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded font-medium transition"
                >
                  Left Sidewalk
                </button>
                <button
                  onClick={() => applyPreset("right_shoulder")}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded font-medium transition"
                >
                  Right Shoulder
                </button>
                <button
                  onClick={() => applyPreset("center_median")}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded font-medium transition"
                >
                  Median Barrier
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleUndo}
                  disabled={points.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg disabled:opacity-40 transition"
                  title="Undo last vertex"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
                {selectedIndex !== null && (
                  <button
                    onClick={() => deleteVertex(selectedIndex)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/80 border border-rose-800 hover:bg-rose-900 text-rose-300 text-xs font-semibold rounded-lg transition"
                    title="Delete selected vertex"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete P{selectedIndex + 1}</span>
                  </button>
                )}
                <button
                  onClick={handleClear}
                  disabled={points.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg disabled:opacity-40 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
                <button
                  onClick={handleSaveRegion}
                  disabled={points.length > 0 && points.length < 3}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md disabled:opacity-50 transition"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Save Normalized Polygon</span>
                </button>
              </div>
            </div>

            {saveStatus && (
              <div className="p-2 bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs rounded-lg flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{saveStatus}</span>
              </div>
            )}

            {/* Normalized Coordinates Inspector Table */}
            {points.length > 0 && (
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-mono uppercase text-slate-400">
                  <span>Polygon Vertex List (Canvas & Normalized Coordinates)</span>
                  <span>Normalized: [0.0000, 1.0000]</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {points.map(([px, py], i) => {
                    const normX = (px / CANVAS_WIDTH).toFixed(3);
                    const normY = (py / CANVAS_HEIGHT).toFixed(3);
                    const isSelected = selectedIndex === i;
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedIndex(i)}
                        className={`p-1.5 rounded border text-[11px] font-mono cursor-pointer flex items-center justify-between transition ${
                          isSelected
                            ? "bg-blue-950/80 border-blue-500 text-blue-200"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <span className="font-bold text-slate-300">P{i + 1}:</span>
                        <span>
                          [{normX}, {normY}]
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteVertex(i);
                          }}
                          className="text-slate-500 hover:text-rose-400 ml-1"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </GlassCard>

          {/* CCTV Placement Map */}
          <GlassCard className="p-4 space-y-3" glowColor="cyan">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <span>Stationary CCTV Network Placement Map</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-500">Offline Coordinate Grid</span>
            </div>

            <div className="h-40 bg-slate-950 rounded-xl border border-slate-800 relative overflow-hidden flex items-center justify-center p-4">
              {cameras.map((c, i) => {
                const tel = cameraTelemetry[c.id];
                const isAlert = tel && tel.confirmed_accidents > 0;
                const left = 20 + (i % 3) * 30;
                const top = 25 + Math.floor(i / 3) * 45;

                return (
                  <div
                    key={c.id}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer group"
                    onClick={() => handleSelectCamera(c)}
                  >
                    <div
                      className={`p-1.5 rounded-full shadow-lg ${
                        isAlert
                          ? "bg-red-600 text-white animate-bounce"
                          : selectedCam?.id === c.id
                          ? "bg-emerald-500 text-white ring-2 ring-emerald-400"
                          : "bg-slate-700 text-slate-200"
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
              <span>
                Coordinates saved as normalized percentages [0.0..1.0] survive video transcoding and camera aspect ratio scaling.
              </span>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
};
