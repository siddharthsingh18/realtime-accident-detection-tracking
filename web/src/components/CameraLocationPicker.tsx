import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CameraItem } from "../api/types";
import { MAP_CONFIG } from "../config/mapConfig";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface Props {
  camera: CameraItem;
  onSaveLocation: (lat: number | null, lng: number | null, heading: number | null) => Promise<void>;
}

export function validateCoordinates(latStr: string, lngStr: string, headingStr: string): {
  valid: boolean;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  error?: string;
} {
  const trimmedLat = latStr.trim();
  const trimmedLng = lngStr.trim();
  const trimmedHeading = headingStr.trim();

  let lat: number | null = null;
  let lng: number | null = null;
  let heading: number | null = null;

  if (trimmedLat !== "" || trimmedLng !== "") {
    if (trimmedLat === "" || trimmedLng === "") {
      return { valid: false, lat: null, lng: null, heading: null, error: "Both latitude and longitude are required together." };
    }
    const parsedLat = parseFloat(trimmedLat);
    const parsedLng = parseFloat(trimmedLng);

    if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      return { valid: false, lat: null, lng: null, heading: null, error: "Latitude must be a valid number between -90.0 and 90.0." };
    }
    if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      return { valid: false, lat: null, lng: null, heading: null, error: "Longitude must be a valid number between -180.0 and 180.0." };
    }
    lat = parsedLat;
    lng = parsedLng;
  }

  if (trimmedHeading !== "") {
    const parsedHeading = parseFloat(trimmedHeading);
    if (isNaN(parsedHeading) || parsedHeading < 0 || parsedHeading > 360) {
      return { valid: false, lat, lng, heading: null, error: "Heading must be between 0° and 360°." };
    }
    heading = parsedHeading;
  }

  return { valid: true, lat, lng, heading };
}

export const CameraLocationPicker: React.FC<Props> = ({ camera, onSaveLocation }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [latInput, setLatInput] = useState<string>(camera.lat !== null && camera.lat !== undefined ? String(camera.lat) : "");
  const [lngInput, setLngInput] = useState<string>(camera.lng !== null && camera.lng !== undefined ? String(camera.lng) : "");
  const [headingInput, setHeadingInput] = useState<string>(camera.heading !== null && camera.heading !== undefined ? String(camera.heading) : "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync inputs when selected camera changes
  useEffect(() => {
    setLatInput(camera.lat !== null && camera.lat !== undefined ? String(camera.lat) : "");
    setLngInput(camera.lng !== null && camera.lng !== undefined ? String(camera.lng) : "");
    setHeadingInput(camera.heading !== null && camera.heading !== undefined ? String(camera.heading) : "");
    setValidationError(null);
    setSuccessMsg(null);
  }, [camera]);

  // Initialize or update interactive placement map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialCenter =
        typeof camera.lat === "number" && typeof camera.lng === "number"
          ? [camera.lat, camera.lng]
          : MAP_CONFIG.defaultCenter;

      const map = L.map(mapContainerRef.current, {
        center: initialCenter as [number, number],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer(MAP_CONFIG.tileUrl, {
        maxZoom: MAP_CONFIG.maxZoom,
        subdomains: "abcd",
      }).addTo(map);

      // Click to pick location
      map.on("click", (e: L.LeafletMouseEvent) => {
        const newLat = Number(e.latlng.lat.toFixed(6));
        const newLng = Number(e.latlng.lng.toFixed(6));
        setLatInput(String(newLat));
        setLngInput(String(newLng));
        setValidationError(null);

        if (markerRef.current) {
          markerRef.current.setLatLng([newLat, newLng]);
        } else {
          markerRef.current = L.marker([newLat, newLng]).addTo(map);
        }
      });

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    if (typeof camera.lat === "number" && typeof camera.lng === "number") {
      map.setView([camera.lat, camera.lng], 15);
      if (markerRef.current) {
        markerRef.current.setLatLng([camera.lat, camera.lng]);
      } else {
        markerRef.current = L.marker([camera.lat, camera.lng]).addTo(map);
      }
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
  }, [camera]);

  // Clean up map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleSave = async () => {
    setValidationError(null);
    setSuccessMsg(null);

    const result = validateCoordinates(latInput, lngInput, headingInput);
    if (!result.valid) {
      setValidationError(result.error || "Invalid coordinate values.");
      return;
    }

    setSaving(true);
    try {
      await onSaveLocation(result.lat, result.lng, result.heading);
      setSuccessMsg("Camera location and heading saved successfully.");
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setValidationError("Failed to save camera location to server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Interactive Leaflet Placement Map */}
      <div className="relative h-48 w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
        <div ref={mapContainerRef} className="w-full h-full" />
        <div className="absolute top-2 right-2 z-[400] bg-slate-900/90 border border-slate-700 px-2 py-1 rounded text-[10px] font-mono text-cyan-300 pointer-events-none">
          Click map to pin location
        </div>
      </div>

      {/* Coordinate and Heading Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
            Latitude (-90..90)
          </label>
          <input
            type="text"
            value={latInput}
            onChange={(e) => {
              setLatInput(e.target.value);
              setValidationError(null);
            }}
            placeholder="e.g. 28.6139"
            className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
            Longitude (-180..180)
          </label>
          <input
            type="text"
            value={lngInput}
            onChange={(e) => {
              setLngInput(e.target.value);
              setValidationError(null);
            }}
            placeholder="e.g. 77.2090"
            className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
            Heading (0°..360°)
          </label>
          <input
            type="text"
            value={headingInput}
            onChange={(e) => {
              setHeadingInput(e.target.value);
              setValidationError(null);
            }}
            placeholder="e.g. 45"
            className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 outline-none"
          />
        </div>
      </div>

      {validationError && (
        <div className="p-2 bg-rose-950/70 border border-rose-800 text-rose-300 text-xs rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-2 bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs rounded-lg shadow-md transition disabled:opacity-50 cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{saving ? "Saving..." : "Save Location & Heading"}</span>
        </button>
      </div>
    </div>
  );
};
