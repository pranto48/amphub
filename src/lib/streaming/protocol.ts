export const REMOTE_PROTOCOL_VERSION = 1;

export type RemoteChannel = "control" | "media";

export type ControlMessageType =
  | "session.init"
  | "session.init_ack"
  | "session.key_confirm"
  | "session.rotate_key"
  | "session.resume"
  | "session.resume_rejected"
  | "heartbeat"
  | "ack.input"
  | "flow.pause"
  | "flow.resume"
  | "input.key"
  | "input.pointer_move"
  | "input.pointer_button"
  | "input.pointer_wheel"
  | "control.ctrl_alt_del"
  | "control.disconnect"
  | "control.accepted"
  | "control.completed"
  | "control.rejected"
  | "media.stats"
  | "file.list"
  | "file.upload.begin"
  | "file.upload.chunk"
  | "file.upload.commit"
  | "file.download.begin"
  | "file.download.chunk"
  | "file.delete"
  | "error.unsupported_type";

export interface ControlEnvelope<TPayload = unknown> {
  v: typeof REMOTE_PROTOCOL_VERSION;
  type: ControlMessageType;
  session_id: string;
  request_id: string;
  seq: number;
  ts: string;
  payload: TPayload;
}

export interface DesktopFrameEnvelope {
  v: number;
  codec: "h264" | "vp9" | "av1" | "jpeg";
  frameId: bigint;
  keyframe: boolean;
  captureTsMs: number;
  width: number;
  height: number;
  payload: Uint8Array;
}

export interface SessionTransportSecurity {
  tls: "1.3";
  mutualAuth: "mtls" | "token";
  serverValidation: true;
  agentCredentialId: string;
}

export interface KeyRotationPolicy {
  rotateAfterMs: number;
  rotateAfterBytes: number;
  graceTimeoutMs: number;
}

export const DEFAULT_KEY_ROTATION_POLICY: KeyRotationPolicy = {
  rotateAfterMs: 10 * 60 * 1000,
  rotateAfterBytes: 1024 * 1024 * 1024,
  graceTimeoutMs: 30_000,
};

export interface ReliabilityPolicy {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  inputAckTimeoutMs: number;
  fileChunkAckTimeoutMs: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  resumeTtlMs: number;
}

export const DEFAULT_RELIABILITY_POLICY: ReliabilityPolicy = {
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 15_000,
  inputAckTimeoutMs: 2_000,
  fileChunkAckTimeoutMs: 10_000,
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 10_000,
  resumeTtlMs: 60_000,
};

export interface AuditProtocolEvent {
  event_id: string;
  event_ts: string;
  request_id: string;
  session_id: string;
  node_id: string;
  agent_id: string;
  actor_id?: string;
  channel: RemoteChannel;
  event_type: string;
  status: "ok" | "error" | "denied" | "timeout";
  seq?: number;
  frame_id?: string;
  kid?: string;
  error_code?: string;
  error_message?: string;
}


export interface StreamCapabilities {
  adapters: Array<"webrtc" | "rdp" | "vnc">;
  controlChannel: "supabase-realtime" | "wss";
  supportsKeyboard: boolean;
  supportsPointer: boolean;
  supportsClipboard: boolean;
}
