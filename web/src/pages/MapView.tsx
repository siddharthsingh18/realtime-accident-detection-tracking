import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api/client";
import { CameraItem, IncidentItem } from "../api/types";
import { MAP_CONFIG } from "../config/mapConfig";
import { GlassCard } from "../components/ui/GlassCard";
import { StatusPill } from "../components/ui/StatusPill";

import {
  MapPin,
  Camera,
  AlertTriangle,
  Flame,
  Layers,
  Clock,
  Maximize2,
  Eye,
  Radio,
  WifiOff,
  Compass,
} from "lucide-react";

type TimeRangeFilter = "1h" | "24h" | "7d";

export const MapView: React.FC = () => {
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const fovLayerRef = useRef<L.LayerGroup | null>(null);
  const incidentsLayerRef = useRef<L.LayerGroup | null>(null);
  const heatLayerRef = useRef<L.LayerGroup | null>(null);

  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [historicalIncidents, setHistoricalIncidents] = useState<IncidentItem[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeRangeFilter>("24h");
  const [showCameras, setShowCameras] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showFovCones, setShowFovCones] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isTileOffline, setIsTileOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  // Store subscriptions
  const {
    cameraTelemetry,
    cameraStatus,
    effectsQuality,
    setAlertDrawerOpen,
  } = useSessionStore(
    useShallow((s) => ({
      cameraTelemetry: s.cameraTelemetry,
      cameraStatus: s.cameraStatus,
      effectsQuality: s.effectsQuality,
      setAlertDrawerOpen: s.setAlertDrawerOpen,
    }))
  );

  const isUserInteractingRef = useRef<boolean>(false);
  const lastEasedCameraRef = useRef<string | null>(null);

  // 1. Fetch Cameras and Historical Incidents
  const loadData = useCallback(async () => {
    try {
      const [cams, incs] = await Promise.all([
        api.getCameras(),
        api.getIncidents({ limit: 200 }),
      ]);
      setCameras(cams);
      setHistoricalIncidents(incs.items);
    } catch (err) {
      console.warn("Failed to load map data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const map = L.map(mapContainerRef.current, {
      center: MAP_CONFIG.defaultCenter,
      zoom: MAP_CONFIG.defaultZoom,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
      zoomControl: false,
      zoomAnimation: !reduceMotion && effectsQuality !== "off",
      attributionControl: false,
    });

    // Custom tactical zoom control on bottom right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Custom attribution control on bottom left
    L.control
      .attribution({ position: "bottomleft", prefix: false })
      .addAttribution(MAP_CONFIG.attribution)
      .addTo(map);

    // Dark Matter tile layer with fallback handler
    const tileLayer = L.tileLayer(MAP_CONFIG.tileUrl, {
      maxZoom: MAP_CONFIG.maxZoom,
      subdomains: "abcd",
    });

    tileLayer.on("tileerror", () => {
      setIsTileOffline(true);
    });

    tileLayer.addTo(map);

    // Layer groups for clean management
    fovLayerRef.current = L.layerGroup().addTo(map);
    heatLayerRef.current = L.layerGroup().addTo(map);
    incidentsLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);

    // Track user drag/zoom interactions to avoid stealing control
    map.on("dragstart", () => {
      isUserInteractingRef.current = true;
    });
    map.on("dragend", () => {
      setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 3000);
    });
    map.on("zoomstart", () => {
      isUserInteractingRef.current = true;
    });
    map.on("zoomend", () => {
      setTimeout(() => {
        isUserInteractingRef.current = false;
      }, 3000);
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [effectsQuality]);

  // Filter historical incidents by selected timeframe
  const filteredIncidents = useMemo(() => {
    const now = Date.now();
    const windowMs =
      timeFilter === "1h"
        ? 3600 * 1000
        : timeFilter === "24h"
        ? 24 * 3600 * 1000
        : 7 * 24 * 3600 * 1000;

    return historicalIncidents.filter((inc) => {
      const incTime = new Date(inc.confirmed_at).getTime();
      return !isNaN(incTime) && now - incTime <= windowMs;
    });
  }, [historicalIncidents, timeFilter]);

  // Helper: compute field-of-view cone polygon points from heading
  const computeFovPoints = useCallback(
    (lat: number, lng: number, heading: number, fovAngle = 55, distanceMeters = 140) => {
      // Rough meter-to-degree conversions for local projection
      const latOffsetPerMeter = 1 / 111111;
      const lngOffsetPerMeter = 1 / (111111 * Math.cos((lat * Math.PI) / 180));

      const halfFov = fovAngle / 2;
      const startAngle = (heading - halfFov) * (Math.PI / 180);
      const endAngle = (heading + halfFov) * (Math.PI / 180);
      const midAngle = heading * (Math.PI / 180);

      const p0: [number, number] = [lat, lng];
      const p1: [number, number] = [
        lat + Math.cos(startAngle) * distanceMeters * latOffsetPerMeter,
        lng + Math.sin(startAngle) * distanceMeters * lngOffsetPerMeter,
      ];
      const pArc: [number, number] = [
        lat + Math.cos(midAngle) * (distanceMeters * 1.08) * latOffsetPerMeter,
        lng + Math.sin(midAngle) * (distanceMeters * 1.08) * lngOffsetPerMeter,
      ];
      const p2: [number, number] = [
        lat + Math.cos(endAngle) * distanceMeters * latOffsetPerMeter,
        lng + Math.sin(endAngle) * distanceMeters * lngOffsetPerMeter,
      ];

      return [p0, p1, pArc, p2];
    },
    []
  );

  // 3. Render Markers, FOV Cones, Clusters, and Heatmap
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const markersGroup = markersLayerRef.current;
    const fovGroup = fovLayerRef.current;
    const incGroup = incidentsLayerRef.current;
    const heatGroup = heatLayerRef.current;

    if (!markersGroup || !fovGroup || !incGroup || !heatGroup) return;

    markersGroup.clearLayers();
    fovGroup.clearLayers();
    incGroup.clearLayers();
    heatGroup.clearLayers();

    const currentZoom = map.getZoom();
    const shouldCluster = currentZoom <= 12;

    // A. Render Cameras
    if (showCameras) {
      const validCameras = cameras.filter(
        (c) => typeof c.lat === "number" && typeof c.lng === "number"
      );

      if (shouldCluster && validCameras.length > 2) {
        // Group cameras into a cluster badge
        const clusterLat =
          validCameras.reduce((acc, c) => acc + (c.lat || 0), 0) / validCameras.length;
        const clusterLng =
          validCameras.reduce((acc, c) => acc + (c.lng || 0), 0) / validCameras.length;

        const hasAnyIncident = validCameras.some((c) => {
          const tel = cameraTelemetry[c.id];
          return tel && tel.confirmed_accidents > 0;
        });

        const clusterIcon = L.divIcon({
          className: "custom-cluster-icon",
          html: `
            <div class="flex items-center justify-center w-12 h-12 rounded-full border-2 font-mono text-xs font-bold shadow-2xl cursor-pointer ${
              hasAnyIncident
                ? "bg-rose-950/90 border-rose-500 text-rose-300 animate-pulse"
                : "bg-slate-900/90 border-cyan-400 text-cyan-300"
            }">
              <span>${validCameras.length} CAMS</span>
            </div>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 24],
        });

        const clusterMarker = L.marker([clusterLat, clusterLng], { icon: clusterIcon });
        clusterMarker.on("click", () => {
          map.setView([clusterLat, clusterLng], 14, { animate: effectsQuality !== "off" });
        });
        markersGroup.addLayer(clusterMarker);
      } else {
        // Render Individual Camera Markers
        validCameras.forEach((cam) => {
          const lat = cam.lat!;
          const lng = cam.lng!;
          const tel = cameraTelemetry[cam.id];
          const status = cameraStatus[cam.id] || "idle";
          const hasIncident = (tel?.confirmed_accidents ?? 0) > 0;
          const isRunning = status === "running";

          // 1. Draw Field of View (FOV) cone if heading is set
          if (showFovCones && typeof cam.heading === "number") {
            const fovCoords = computeFovPoints(lat, lng, cam.heading);
            const conePolygon = L.polygon(fovCoords, {
              color: hasIncident ? "#f43f5e" : isRunning ? "#06b6d4" : "#64748b",
              weight: 1.5,
              opacity: 0.6,
              fillColor: hasIncident ? "#f43f5e" : isRunning ? "#06b6d4" : "#64748b",
              fillOpacity: hasIncident ? 0.25 : 0.12,
              dashArray: isRunning ? undefined : "3, 6",
            });
            fovGroup.addLayer(conePolygon);
          }

          // 2. Camera Marker Icon
          const pulseClass =
            hasIncident && effectsQuality !== "off"
              ? "animate-ping"
              : isRunning && effectsQuality !== "off"
              ? "animate-pulse"
              : "";

          const iconHtml = `
            <div class="relative flex items-center justify-center cursor-pointer group" style="width: 38px; height: 38px;">
              ${
                hasIncident && effectsQuality !== "off"
                  ? `<div class="absolute inset-0 rounded-full bg-rose-500 opacity-75 ${pulseClass}"></div>`
                  : ""
              }
              <div class="relative w-9 h-9 rounded-xl border-2 flex items-center justify-center shadow-xl transition-transform duration-200 group-hover:scale-110 ${
                hasIncident
                  ? "bg-rose-950 border-rose-500 text-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.6)]"
                  : isRunning
                  ? "bg-slate-900 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                  : "bg-slate-900 border-slate-700 text-slate-400"
              }">
                ${
                  hasIncident
                    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>`
                }
              </div>
            </div>
          `;

          const cameraIcon = L.divIcon({
            className: "custom-cam-marker",
            html: iconHtml,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
            popupAnchor: [0, -22],
          });

          const marker = L.marker([lat, lng], { icon: cameraIcon });

          // Popup Content
          const popupHtml = `
            <div class="font-sans text-xs bg-slate-950 text-slate-200 p-3 rounded-xl border border-slate-800 shadow-2xl min-w-[210px]">
              <div class="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
                <span class="font-bold text-slate-100">${cam.name}</span>
                <span class="font-mono text-[10px] px-1.5 py-0.5 rounded ${
                  hasIncident
                    ? "bg-rose-950 text-rose-400 border border-rose-800 font-bold"
                    : isRunning
                    ? "bg-cyan-950 text-cyan-400 border border-cyan-800"
                    : "bg-slate-900 text-slate-400 border border-slate-700"
                }">${hasIncident ? "ALERT" : isRunning ? "LIVE" : "IDLE"}</span>
              </div>
              <div class="space-y-1 font-mono text-[11px] text-slate-400 mb-3">
                <div>Source: <span class="text-slate-300">${cam.source}</span></div>
                <div>Coords: <span class="text-slate-300">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
                ${typeof cam.heading === "number" ? `<div>Heading: <span class="text-slate-300">${cam.heading}°</span></div>` : ""}
                ${tel ? `<div>FPS: <span class="text-emerald-400 font-bold">${tel.fps.toFixed(1)}</span></div>` : ""}
                ${hasIncident ? `<div class="text-rose-400 font-bold">Confirmed Accidents: ${tel?.confirmed_accidents}</div>` : ""}
              </div>
              <button
                id="btn-open-focus-${cam.id}"
                class="w-full py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-md"
              >
                Open Live Focus View
              </button>
            </div>
          `;

          marker.bindPopup(popupHtml, {
            className: "custom-tactical-popup",
            closeButton: false,
          });

          marker.on("popupopen", () => {
            const btn = document.getElementById(`btn-open-focus-${cam.id}`);
            if (btn) {
              btn.onclick = () => {
                navigate(`/camera/${cam.id}`);
              };
            }
          });

          markersGroup.addLayer(marker);
        });
      }
    }

    // B. Render Historical & Recent Incident Markers
    if (showIncidents) {
      filteredIncidents.forEach((inc) => {
        // Map incident to camera coordinates
        const parentCam = cameras.find((c) => c.id === inc.camera_id);
        if (!parentCam || typeof parentCam.lat !== "number" || typeof parentCam.lng !== "number") {
          return;
        }

        // Slight jitter offset so multiple incidents on same camera do not completely overlap
        const jitterLat = parentCam.lat + (Math.sin(inc.zone_id * 12.3) * 0.0006);
        const jitterLng = parentCam.lng + (Math.cos(inc.zone_id * 8.7) * 0.0006);

        const isHighConf = inc.peak_conf >= 0.85;
        const isMedConf = inc.peak_conf >= 0.6;
        const color = isHighConf ? "#e11d48" : isMedConf ? "#f59e0b" : "#eab308";

        const incIconHtml = `
          <div class="relative flex items-center justify-center cursor-pointer group" style="width: 28px; height: 28px;">
            <div class="w-7 h-7 rounded-lg border flex items-center justify-center shadow-lg transition-transform group-hover:scale-125" style="background-color: rgba(15,23,42,0.95); border-color: ${color}; color: ${color};">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </div>
          </div>
        `;

        const incIcon = L.divIcon({
          className: "custom-inc-marker",
          html: incIconHtml,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -16],
        });

        const incMarker = L.marker([jitterLat, jitterLng], { icon: incIcon });

        const incPopupHtml = `
          <div class="font-sans text-xs bg-slate-950 text-slate-200 p-3 rounded-xl border border-rose-900/60 shadow-2xl min-w-[200px]">
            <div class="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
              <span class="font-bold text-rose-300 flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon></svg>
                Incident Alert
              </span>
              <span class="font-mono text-[10px] text-slate-400">${new Date(inc.confirmed_at).toLocaleTimeString()}</span>
            </div>
            <div class="space-y-1 font-mono text-[11px] text-slate-400 mb-2.5">
              <div>Camera: <span class="text-slate-200">${parentCam.name}</span></div>
              <div>Confidence: <span class="text-rose-400 font-bold">${(inc.peak_conf * 100).toFixed(0)}%</span></div>
              <div>Origin: <span class="text-slate-300 capitalize">${inc.origin.replace("_", " ")}</span></div>
              ${inc.verdict ? `<div>Verdict: <span class="text-amber-300 uppercase">${inc.verdict.replace("_", " ")}</span></div>` : ""}
            </div>
            <button
              id="btn-inspect-inc-${inc.id}"
              class="w-full py-1.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer"
            >
              Review Dossier
            </button>
          </div>
        `;

        incMarker.bindPopup(incPopupHtml, {
          className: "custom-tactical-popup",
          closeButton: false,
        });

        incMarker.on("popupopen", () => {
          const btn = document.getElementById(`btn-inspect-inc-${inc.id}`);
          if (btn) {
            btn.onclick = () => {
              navigate(`/incidents/${inc.id}`);
            };
          }
        });

        incGroup.addLayer(incMarker);
      });
    }

    // C. Render Incident Density Heatmap Layer
    if (showHeatmap && filteredIncidents.length > 0) {
      filteredIncidents.forEach((inc) => {
        const parentCam = cameras.find((c) => c.id === inc.camera_id);
        if (!parentCam || typeof parentCam.lat !== "number" || typeof parentCam.lng !== "number") return;

        const radiusMeters = 80 + inc.peak_conf * 120;
        const heatCircle = L.circle([parentCam.lat, parentCam.lng], {
          radius: radiusMeters,
          color: "#f43f5e",
          weight: 0,
          fillColor: "#f43f5e",
          fillOpacity: 0.18 + inc.peak_conf * 0.15,
        });
        heatGroup.addLayer(heatCircle);
      });
    }
  }, [
    cameras,
    filteredIncidents,
    showCameras,
    showIncidents,
    showFovCones,
    showHeatmap,
    cameraTelemetry,
    cameraStatus,
    effectsQuality,
    computeFovPoints,
    navigate,
  ]);

  // 4. Live Incident Easing / Pan: Pan to camera with active emergency if operator is not interacting
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || isUserInteractingRef.current) return;

    // Find any camera with active confirmed accidents
    const activeIncidentCam = cameras.find((c) => {
      const tel = cameraTelemetry[c.id];
      return tel && tel.confirmed_accidents > 0 && typeof c.lat === "number" && typeof c.lng === "number";
    });

    if (activeIncidentCam && activeIncidentCam.id !== lastEasedCameraRef.current) {
      lastEasedCameraRef.current = activeIncidentCam.id;
      const target: [number, number] = [activeIncidentCam.lat!, activeIncidentCam.lng!];

      if (effectsQuality === "off") {
        map.panTo(target);
      } else {
        map.flyTo(target, Math.max(map.getZoom(), 15), {
          duration: 1.2,
          easeLinearity: 0.25,
        });
      }
    }
  }, [cameras, cameraTelemetry, effectsQuality]);

  // 5. Fit All Cameras Helper
  const handleFitBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const validCoords: [number, number][] = cameras
      .filter((c) => typeof c.lat === "number" && typeof c.lng === "number")
      .map((c) => [c.lat!, c.lng!]);

    if (validCoords.length > 0) {
      const bounds = L.latLngBounds(validCoords);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
    }
  }, [cameras]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Top Header & Tactical Toolbar */}
      <GlassCard variant="cyan" glow={true} className="p-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-cyan-400" />
              <h2 className="text-sm sm:text-base font-extrabold font-display tracking-wider uppercase text-slate-100">
                TACTICAL GIS SURVEILLANCE RADAR
              </h2>
            </div>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Multi-camera geospatial telemetry, live incident beacons & historical density mapping.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Time Filter Pill (1h / 24h / 7d) */}
            <div className="flex items-center bg-slate-900/90 rounded-xl p-0.5 border border-slate-700/80 text-xs font-mono">
              <Clock className="w-3.5 h-3.5 text-slate-400 ml-2 mr-1" />
              {(["1h", "24h", "7d"] as TimeRangeFilter[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeFilter(tf)}
                  className={`px-2.5 py-1 rounded-lg transition uppercase font-semibold ${
                    timeFilter === tf
                      ? "bg-cyan-500 text-slate-950 font-bold shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Layer Toggles */}
            <button
              onClick={() => setShowFovCones(!showFovCones)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 transition ${
                showFovCones
                  ? "bg-cyan-950/80 text-cyan-300 border-cyan-500/60 shadow-[0_0_10px_rgba(6,182,212,0.25)]"
                  : "bg-slate-900/80 text-slate-400 border-slate-700 hover:text-white"
              }`}
              title="Toggle Field of View heading cones"
            >
              <Compass className="w-3.5 h-3.5" />
              <span>FOV</span>
            </button>

            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 transition ${
                showHeatmap
                  ? "bg-rose-950/80 text-rose-300 border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
                  : "bg-slate-900/80 text-slate-400 border-slate-700 hover:text-white"
              }`}
              title="Toggle incident spatial density heatmap"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Heatmap</span>
            </button>

            {/* Fit Bounds Button */}
            <button
              onClick={handleFitBounds}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-mono flex items-center gap-1.5 transition"
              title="Fit map view to all cameras"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fit Bounds</span>
            </button>

            {/* Open Alert Drawer Button */}
            <button
              onClick={() => setAlertDrawerOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg transition"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Review Alerts</span>
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Offline Tile Notification */}
      {isTileOffline && (
        <div className="p-3 bg-amber-950/80 border border-amber-600 text-amber-200 text-xs rounded-xl flex items-center justify-between shadow-lg font-mono">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-400" />
            <span>
              <strong>Offline Map Mode:</strong> Tile server unreachable or restricted by network policy. Markers are projected on the tactical grid.
            </span>
          </div>
          <button
            onClick={() => setIsTileOffline(false)}
            className="text-[11px] underline hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Map Stage */}
      <div className="relative w-full h-[620px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
        {/* Fallback Tactical Grid Pattern for Offline and Low Effects */}
        <div className="absolute inset-0 bg-grid-pattern opacity-25 pointer-events-none z-0" />

        {/* Map Container */}
        <div
          ref={mapContainerRef}
          className="w-full h-full relative z-10"
          style={{ background: "#0b1120" }}
        />

        {/* Floating Map Legend Overlay */}
        <div className="absolute top-4 left-4 z-20 pointer-events-auto bg-slate-950/90 border border-slate-800 p-3 rounded-xl shadow-2xl backdrop-blur-none space-y-2 text-xs font-mono max-w-xs">
          <div className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Geospatial Radar Legend</span>
          </div>
          <div className="space-y-1.5 text-[11px] text-slate-300">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              <span>Online CCTV Node ({cameras.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              <span>Active Confirmed Incident</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded bg-amber-500" />
              <span>Incident in {timeFilter} ({filteredIncidents.length})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default MapView;
