import {
  BaseRemoteStreamAdapter,
  type ConnectOptions,
  type ResizeDimensions,
  type StreamInputMessage,
} from "./remote-stream-adapter";

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
      this.stats.latencyMs = 18 + Math.round(Math.random() * 24);
      this.stats.fps = 56 + Math.round(Math.random() * 6);
    }, 1000);
  }
}

export class WebRTCGatewayAdapter extends BaseRemoteStreamAdapter {
  async connect(_options: ConnectOptions) {
    this.setState("connecting");
    // Scaffold for STREAMING.md path #3:
    // 1. exchange SDP via signaling channel
    // 2. attach incoming video track to canvas (WebCodecs/WebGL path)
    // 3. start control/data channels for input + commands
    this.setState("failed");
  }

  async disconnect() {
    this.setState("disconnected");
  }

  async sendInput(_message: StreamInputMessage) {
    // TODO: write into RTCDataChannel command/input stream.
  }

  async resize(_dimensions: ResizeDimensions) {
    // TODO: notify remote encoder of viewport dimensions.
  }
}

export class RdpBridgeAdapter extends BaseRemoteStreamAdapter {
  async connect(_options: ConnectOptions) {
    this.setState("connecting");
    // Scaffold for STREAMING.md path #1:
    // integrate a Guacamole/bridge websocket tunnel and decode frames.
    this.setState("failed");
  }

  async disconnect() {
    this.setState("disconnected");
  }

  async sendInput(_message: StreamInputMessage) {
    // TODO: marshal keyboard/pointer/control to RDP bridge.
  }

  async resize(_dimensions: ResizeDimensions) {
    // TODO: send display update command to RDP bridge.
  }
}

export class VncBridgeAdapter extends BaseRemoteStreamAdapter {
  async connect(_options: ConnectOptions) {
    this.setState("connecting");
    // Scaffold for STREAMING.md path #2:
    // integrate noVNC/websockify websocket and pipe to canvas.
    this.setState("failed");
  }

  async disconnect() {
    this.setState("disconnected");
  }

  async sendInput(_message: StreamInputMessage) {
    // TODO: forward keyboard/pointer/control over VNC websocket protocol.
  }

  async resize(_dimensions: ResizeDimensions) {
    // TODO: request framebuffer resize/update.
  }
}
