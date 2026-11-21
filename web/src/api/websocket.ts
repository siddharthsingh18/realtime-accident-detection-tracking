import { TelemetryMessage, TelemetryMessageSchema, PipelineSettings } from "./types";

export type TelemetryCallback = (telemetry: TelemetryMessage) => void;
export type FrameCallback = (frameData: Blob) => void;
export type StatusCallback = (status: "connecting" | "connected" | "disconnected" | "reconnecting" | "error", details?: string) => void;

export class StreamWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private onTelemetry: TelemetryCallback;
  private onFrame: FrameCallback;
  private onStatus: StatusCallback;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | number | null = null;
  private isIntentionallyClosed = false;

  constructor(
    sessionId: string,
    callbacks: {
      onTelemetry: TelemetryCallback;
      onFrame: FrameCallback;
      onStatus: StatusCallback;
    }
  ) {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = import.meta.env.VITE_WS_URL || `${wsProto}//${window.location.hostname}:8080`;
    this.url = `${host}/api/sessions/${sessionId}/stream`;
    this.onTelemetry = callbacks.onTelemetry;
    this.onFrame = callbacks.onFrame;
    this.onStatus = callbacks.onStatus;
  }

  public connect() {
    this.isIntentionallyClosed = false;
    this.onStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "blob";

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatus("connected");
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.status === "finished") {
              this.onStatus("disconnected", "Session finished");
              return;
            }
            const validated = TelemetryMessageSchema.parse(parsed);
            this.onTelemetry(validated);
          } catch (e) {
            console.error("Failed to parse telemetry frame:", e);
          }
        } else if (event.data instanceof Blob) {
          this.onFrame(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          this.onFrame(new Blob([event.data], { type: "image/jpeg" }));
        }
      };

      this.ws.onerror = (err) => {
        console.warn("WebSocket stream error:", err);
      };

      this.ws.onclose = (event) => {
        if (this.isIntentionallyClosed) {
          this.onStatus("disconnected");
          return;
        }

        if (event.code === 1000) {
          this.onStatus("disconnected", "Closed normally");
          return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 8000);
          this.reconnectAttempts++;
          this.onStatus("reconnecting", `Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, delay);
        } else {
          this.onStatus("error", "WebSocket connection lost after retries");
        }
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onStatus("error", `Failed to initialize WebSocket: ${msg}`);
    }
  }

  public send(msg: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public pause() {
    this.send({ type: "pause" });
  }

  public resume() {
    this.send({ type: "resume" });
  }

  public stop() {
    this.send({ type: "stop" });
  }

  public updateSettings(settings: Partial<PipelineSettings>) {
    this.send({ type: "settings", ...settings });
  }

  public close() {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer as number);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

