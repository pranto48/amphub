import {
  BaseRemoteStreamAdapter,
  type ConnectOptions,
  type ResizeDimensions,
  type StreamInputMessage,
} from "./remote-stream-adapter";
import type { ControlEnvelope } from "./protocol";
import { SupabaseSessionSignaling, type NegotiatedSession } from "./signaling";

export class MockStreamAdapter extends BaseRemoteStreamAdapter {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animationHandle: number | null = null;
  private statsHandle: number | null = null;
  private startedAt = 0;

  async connect(options: ConnectOptions) {
    this.setState("connecting");
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.startedAt = performance.now();

    if (!this.ctx) {
      this.setState("failed");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 280));
    this.setState("connected");
    this.startDrawing(options.nodeId);
    this.startStatsLoop();
  }

  async disconnect() {
    if (this.animationHandle) cancelAnimationFrame(this.animationHandle);
    if (this.statsHandle) window.clearInterval(this.statsHandle);
    this.animationHandle = null;
    this.statsHandle = null;

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.setState("disconnected");
  }

  async sendInput(message: StreamInputMessage) {
    if (message.type === "command" && message.command === "ctrl_alt_del") {
      this.setState("reconnecting");
      await new Promise((resolve) => setTimeout(resolve, 150));
      this.setState("connected");
    }
  }

  async resize(dimensions: ResizeDimensions) {
    if (!this.canvas) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(dimensions.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(dimensions.height * ratio));
    if (this.ctx) {
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
  }

  private startDrawing(nodeId: string) {
    const draw = () => {
      if (!this.ctx || !this.canvas) return;
      const t = (performance.now() - this.startedAt) / 1000;
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;

      this.ctx.fillStyle = "#07090f";
      this.ctx.fillRect(0, 0, width, height);

      const gradient = this.ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0b1223");
      gradient.addColorStop(1, "#1f2937");
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(18, 18, width - 36, height - 36);

      this.ctx.fillStyle = "#7dd3fc";
      this.ctx.font = "600 20px Inter, system-ui, sans-serif";
      this.ctx.fillText("Secure Remote Session (Mock Adapter)", 40, 54);

      this.ctx.fillStyle = "#a1a1aa";
      this.ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
      this.ctx.fillText(`Target: ${nodeId}`, 40, 82);
      this.ctx.fillText("Transport: mock://local-render-loop", 40, 104);

      const pulse = 40 + Math.sin(t * 2) * 16;
      this.ctx.fillStyle = "rgba(125, 211, 252, 0.85)";
      this.ctx.beginPath();
      this.ctx.arc(width - 80, 80, pulse, 0, Math.PI * 2);
      this.ctx.fill();

      this.markFrame();
      this.animationHandle = requestAnimationFrame(draw);
    };

    draw();
  }

  private startStatsLoop() {
    this.statsHandle = window.setInterval(() => {
      this.setTelemetry({
        latencyMs: 18 + Math.round(Math.random() * 24),
        fps: 56 + Math.round(Math.random() * 6),
      });
    }, 1000);
  }
}

abstract class SignaledBridgeAdapter extends BaseRemoteStreamAdapter {
  protected signaling = new SupabaseSessionSignaling();
  protected negotiated: NegotiatedSession | null = null;
  protected options: ConnectOptions | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;

  async connect(options: ConnectOptions) {
    this.options = options;
    this.setState("connecting");

    try {
      this.negotiated = await this.signaling.negotiate({
        nodeId: options.nodeId,
        requestId: options.requestId,
        sessionToken: options.sessionToken,
        local: options.local,
      });

      await this.signaling.joinControlChannel(this.negotiated.signalingRoom, {
        onControlMessage: (message) => this.onControlMessage(message),
        onStateChange: (next) => this.onControlState(next),
        onTelemetry: (stats) => this.setTelemetry(stats),
      });

      await this.signaling.announceHello({
        sessionId: this.negotiated.sessionId,
        requestId: options.requestId ?? this.negotiated.sessionId,
        capabilities: {
          adapters: ["webrtc", "rdp", "vnc"],
          controlChannel: "supabase-realtime",
          supportsKeyboard: true,
          supportsPointer: true,
          supportsClipboard: false,
        },
      });

      this.setState(this.negotiated.viewerState === "agent-offline" ? "failed" : "connected");
    } catch {
      this.setState("failed");
    }
  }

  async disconnect(reason = "user_disconnect") {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.negotiated && this.options) {
      await this.signaling.sendControl({
        type: "control.disconnect",
        sessionId: this.negotiated.sessionId,
        requestId: this.options.requestId ?? this.negotiated.sessionId,
        payload: { reason },
      });
    }

    await this.signaling.close();
    this.negotiated = null;
    this.setState("disconnected");
  }

  async sendInput(message: StreamInputMessage) {
    if (!this.negotiated || !this.options) return;
    if (message.type === "command") {
      const type = message.command === "ctrl_alt_del" ? "control.ctrl_alt_del" : "control.disconnect";
      await this.signaling.sendControl({
        type,
        sessionId: this.negotiated.sessionId,
        requestId: this.options.requestId ?? this.negotiated.sessionId,
        payload: {},
      });
      return;
    }

    if (message.type === "key") {
      await this.signaling.sendControl({
        type: "input.key",
        sessionId: this.negotiated.sessionId,
        requestId: this.options.requestId ?? this.negotiated.sessionId,
        payload: { key: message.key, pressed: message.pressed },
      });
      return;
    }

    if (message.type === "wheel") {
      await this.signaling.sendControl({
        type: "input.pointer_wheel",
        sessionId: this.negotiated.sessionId,
        requestId: this.options.requestId ?? this.negotiated.sessionId,
        payload: { dx: message.dx, dy: message.dy },
      });
      return;
    }

    await this.signaling.sendControl({
      type: "input.pointer_move",
      sessionId: this.negotiated.sessionId,
      requestId: this.options.requestId ?? this.negotiated.sessionId,
      payload: { x: message.x, y: message.y, button: message.button, pressed: message.pressed },
    });
  }

  async resize(dimensions: ResizeDimensions) {
    if (!this.negotiated || !this.options) return;
    await this.signaling.sendControl({
      type: "flow.resume",
      sessionId: this.negotiated.sessionId,
      requestId: this.options.requestId ?? this.negotiated.sessionId,
      payload: dimensions,
    });
  }

  private onControlMessage(message: ControlEnvelope) {
    if (message.type === "media.stats") {
      const payload = message.payload as { latencyMs?: number; fps?: number };
      this.setTelemetry({ latencyMs: payload.latencyMs ?? null, fps: payload.fps ?? null });
      this.markFrame();
    }
  }

  private onControlState(next: "disconnected" | "connecting" | "connected" | "reconnecting" | "failed") {
    this.setState(next);
    if (!this.options || !this.negotiated) return;

    if (next === "reconnecting") {
      const backoff = Math.min(10_000, 250 * 2 ** this.reconnectAttempts);
      this.reconnectAttempts += 1;
      if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => {
        if (!this.options) return;
        void this.connect(this.options);
      }, backoff);
      return;
    }

    if (next === "connected") {
      this.reconnectAttempts = 0;
      void this.signaling.heartbeat({
        nodeId: this.options.nodeId,
        sessionId: this.negotiated.sessionId,
        requestId: this.options.requestId,
        latencyMs: this.stats.latencyMs ?? undefined,
        fps: this.stats.fps ?? undefined,
      });
    }
  }
}

export class WebRTCGatewayAdapter extends SignaledBridgeAdapter {}

export class RdpBridgeAdapter extends SignaledBridgeAdapter {}

export class VncBridgeAdapter extends SignaledBridgeAdapter {}
