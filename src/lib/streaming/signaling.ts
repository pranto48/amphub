import { supabase } from "@/integrations/supabase/client";
import type { ConnectionState, StreamStats } from "./remote-stream-adapter";
import { REMOTE_PROTOCOL_VERSION, type ControlEnvelope, type StreamCapabilities } from "./protocol";

export type NegotiatedSession = {
  sessionId: string;
  signalingRoom: string;
  controlToken: string;
  mediaEndpoint: string;
  preferredAdapter: "webrtc" | "rdp" | "vnc";
  viewerState: "ready" | "agent-offline";
};

export class SupabaseSessionSignaling {
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private seq = 0;

  async negotiate(args: { nodeId: string; requestId?: string; sessionToken?: string; local: boolean }) {
    if (args.local) {
      return {
        sessionId: `local-${args.nodeId}`,
        signalingRoom: `local-${args.nodeId}`,
        controlToken: "local",
        mediaEndpoint: "mock://canvas",
        preferredAdapter: "webrtc",
        viewerState: "ready",
      } satisfies NegotiatedSession;
    }

    const { data, error } = await supabase.rpc("session_stream_negotiate", {
      p_node_id: args.nodeId,
      p_request_id: args.requestId ?? null,
      p_session_token: args.sessionToken ?? null,
    });

    if (error) throw new Error(error.message);
    const row = data?.[0];
    if (!row?.authorized) throw new Error(row?.denial_reason ?? "session_not_authorized");

    return {
      sessionId: row.session_id,
      signalingRoom: row.signaling_room,
      controlToken: row.control_token,
      mediaEndpoint: row.media_endpoint,
      preferredAdapter: row.preferred_adapter,
      viewerState: row.viewer_state,
    } satisfies NegotiatedSession;
  }

  async joinControlChannel(
    room: string,
    handlers: {
      onControlMessage: (message: ControlEnvelope) => void;
      onStateChange: (next: ConnectionState) => void;
      onTelemetry: (stats: Partial<StreamStats>) => void;
    },
  ) {
    this.channel = supabase.channel(`stream:${room}`, { config: { broadcast: { self: false } } });

    this.channel
      .on("broadcast", { event: "control" }, ({ payload }) => {
        handlers.onControlMessage(payload as ControlEnvelope);
      })
      .on("broadcast", { event: "telemetry" }, ({ payload }) => {
        handlers.onTelemetry(payload as Partial<StreamStats>);
      })
      .on("presence", { event: "sync" }, () => {
        handlers.onStateChange("connected");
      });

    await this.channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        handlers.onStateChange("connected");
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handlers.onStateChange("reconnecting");
      }
      if (status === "CLOSED") {
        handlers.onStateChange("disconnected");
      }
    });
  }

  async sendControl<T>(args: {
    type: ControlEnvelope<T>["type"];
    sessionId: string;
    requestId: string;
    payload: T;
  }) {
    if (!this.channel) return;
    const envelope: ControlEnvelope<T> = {
      v: REMOTE_PROTOCOL_VERSION,
      type: args.type,
      session_id: args.sessionId,
      request_id: args.requestId,
      seq: ++this.seq,
      ts: new Date().toISOString(),
      payload: args.payload,
    };

    await this.channel.send({ type: "broadcast", event: "control", payload: envelope });
  }

  async announceHello(args: { sessionId: string; requestId: string; capabilities: StreamCapabilities }) {
    await this.sendControl({
      type: "session.init",
      sessionId: args.sessionId,
      requestId: args.requestId,
      payload: { capabilities: args.capabilities },
    });
  }

  async heartbeat(args: { nodeId: string; sessionId: string; requestId?: string; latencyMs?: number; fps?: number }) {
    await supabase.rpc("session_stream_heartbeat", {
      p_node_id: args.nodeId,
      p_session_id: args.sessionId,
      p_request_id: args.requestId ?? null,
      p_latency_ms: args.latencyMs ?? null,
      p_fps: args.fps ?? null,
    });
  }

  async close() {
    if (!this.channel) return;
    await this.channel.unsubscribe();
    this.channel = null;
  }
}
