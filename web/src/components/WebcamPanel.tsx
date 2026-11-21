import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { Camera, AlertCircle } from "lucide-react";

interface Props {
  onWebcamReady?: (videoEl: HTMLVideoElement) => void;
}

export const WebcamPanel: React.FC<Props> = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { status, sessionId } = useSessionStore();
  const webcamWsRef = useRef<WebSocket | null>(null);
  const captureTimerRef = useRef<NodeJS.Timeout | number | null>(null);

  // Load available camera devices
  const loadDevices = useCallback(async () => {
    try {
      const devList = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = devList.filter((d) => d.kind === "videoinput");
      setDevices(videoDevs);
      if (videoDevs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevs[0].deviceId);
      }
    } catch (err) {
      console.warn("Could not enumerate media devices:", err);
    }
  }, [selectedDeviceId]);

  // Start webcam feed
  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setHasPermission(true);
      await loadDevices();
    } catch (err: unknown) {
      setHasPermission(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Webcam access denied or unavailable: ${msg}`);
    }
  }, [selectedDeviceId, loadDevices]);

  useEffect(() => {
    startCamera();
    const videoEl = videoRef.current;
    return () => {
      // Stop all tracks on unmount
      if (videoEl && videoEl.srcObject) {
        const stream = videoEl.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startCamera]);

  // When session is running and source is webcam, open /api/sessions/{id}/webcam WebSocket
  // and send downscaled JPEG frames at ~12 FPS
  useEffect(() => {
    const isRunning = status === "running";
    if (!isRunning || !sessionId) {
      if (webcamWsRef.current) {
        webcamWsRef.current.close();
        webcamWsRef.current = null;
      }
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current as number);
        captureTimerRef.current = null;
      }
      return;
    }

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.VITE_WS_URL || `${wsProto}//${window.location.hostname}:8000`;
    const wsUrl = `${host}/api/sessions/${sessionId}/webcam`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    webcamWsRef.current = ws;

    const captureCanvas = document.createElement("canvas");
    const captureCtx = captureCanvas.getContext("2d");

    ws.onopen = () => {
      // Capture loop at ~12 FPS (~83ms)
      captureTimerRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !captureCtx) return;

        // Downscale to max width 960px preserving aspect ratio
        const srcW = video.videoWidth || 640;
        const srcH = video.videoHeight || 480;
        const maxW = 960;
        const scale = srcW > maxW ? maxW / srcW : 1.0;
        const targetW = Math.round(srcW * scale);
        const targetH = Math.round(srcH * scale);

        if (captureCanvas.width !== targetW || captureCanvas.height !== targetH) {
          captureCanvas.width = targetW;
          captureCanvas.height = targetH;
        }

        captureCtx.drawImage(video, 0, 0, targetW, targetH);
        captureCanvas.toBlob(
          (blob) => {
            if (blob && ws.readyState === WebSocket.OPEN) {
              blob.arrayBuffer().then((buf) => {
                ws.send(buf);
              });
            }
          },
          "image/jpeg",
          0.7
        );
      }, 83);
    };

    return () => {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current as number);
        captureTimerRef.current = null;
      }
      if (webcamWsRef.current) {
        webcamWsRef.current.close();
        webcamWsRef.current = null;
      }
    };
  }, [status, sessionId]);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Webcam Feed Configuration
          </span>
        </div>

        {devices.length > 0 && (
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {devices.map((dev, idx) => (
              <option key={dev.deviceId || idx} value={dev.deviceId}>
                {dev.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative aspect-video max-w-sm mx-auto bg-black rounded-lg overflow-hidden border border-slate-800">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        {hasPermission === false && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center">
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs font-semibold text-rose-300">Camera Permission Required</p>
            <button
              onClick={startCamera}
              className="mt-2 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-[11px] font-semibold text-white rounded"
            >
              Request Access
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="text-xs text-rose-400 flex items-center gap-1.5 justify-center">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <p className="text-[11px] text-slate-500 text-center">
        Frames are downscaled in-browser to max 960px width before streaming to the server.
      </p>
    </div>
  );
};
