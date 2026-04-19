export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export type StreamInputMessage =
  | { type: "command"; command: "ctrl_alt_del" }
  | { type: "key"; key: string; pressed: boolean }
  | { type: "pointer"; x: number; y: number; button?: number; pressed?: boolean };

export interface StreamStats {
  latencyMs: number | null;
  fps: number | null;
  lastFrameAt: number | null;
}

export interface ConnectOptions {
  canvas: HTMLCanvasElement;
  nodeId: string;
  local: boolean;
  requestId?: string;
  sessionToken?: string;
}

export interface ResizeDimensions {
  width: number;
  height: number;
}

export interface RemoteStreamAdapter {
  connect(options: ConnectOptions): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  sendInput(message: StreamInputMessage): Promise<void>;
  resize(dimensions: ResizeDimensions): Promise<void>;
  getStats(): StreamStats;
}

export abstract class BaseRemoteStreamAdapter implements RemoteStreamAdapter {
  protected state: ConnectionState = "disconnected";
  protected stats: StreamStats = {
    latencyMs: null,
    fps: null,
    lastFrameAt: null,
  };

  constructor(
    protected readonly onStateChange?: (state: ConnectionState) => void,
    protected readonly onFrame?: () => void,
  ) {}

  protected setState(next: ConnectionState) {
    this.state = next;
    this.onStateChange?.(next);
  }

  protected markFrame() {
    this.stats.lastFrameAt = Date.now();
    this.onFrame?.();
  }

  getStats() {
    return { ...this.stats };
  }

  abstract connect(options: ConnectOptions): Promise<void>;

  abstract disconnect(reason?: string): Promise<void>;

  abstract sendInput(message: StreamInputMessage): Promise<void>;

  abstract resize(dimensions: ResizeDimensions): Promise<void>;
}
