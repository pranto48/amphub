# Remote Session Wire Protocol Specification

Status: **Draft v1**  
Last updated: **2026-04-19**

This document defines the transport, message contracts, and reliability behavior for Amphub remote sessions.

## 1) Transport and Channel Separation

A remote session uses two independent channels that share the same `session_id` and negotiated key lifecycle.

### 1.1 Control channel (required)

- Transport: **WSS (TLS 1.3)**
- Endpoint: `/v1/remote/sessions/{session_id}/control`
- Format: UTF-8 JSON messages
- Purpose:
  - auth + hello / capability exchange
  - input events (keyboard/mouse)
  - control actions (Ctrl+Alt+Del, disconnect)
  - file APIs (list/upload/download/delete metadata and commands)
  - heartbeats, acks, backpressure, reconnect hints
  - audit event emission envelopes

### 1.2 Media channel (required, preferred WebRTC)

- Preferred transport: **WebRTC**
  - Video: SRTP media stream
  - Optional RTCDataChannel: ordered control feedback (`media_stats`, `frame_ack`)
- Fallback transport: **WSS binary frames**
  - Endpoint: `/v1/remote/sessions/{session_id}/media`
  - Format: binary `DesktopFrameEnvelope`

Control messages MUST continue to flow even when media transport is degraded.

## 2) TLS + Mutual Authentication

All channels MUST use TLS and mutual authentication:

1. Server presents X.509 cert signed by trusted CA; client validates hostname + chain.
2. Agent authenticates with either:
   - mTLS client certificate (`agent_cert_id`), or
   - short-lived agent token bound to device identity (`agent_token_id`).
3. Session token (`session_token`) is validated on control channel hello.
4. Server response returns `request_id`, `session_id`, and approved role/scopes.

### 2.1 Required identity bindings

- `session_id` ↔ `request_id` ↔ `node_id`
- `agent_id` MUST match the approved node target
- cert/token subject MUST map to `agent_id`

## 3) Session Key Negotiation + Rotation

Protocol-level encryption keying is independent from TLS transport keys.

### 3.1 Negotiation flow

1. Client sends `session.init` with ephemeral public key `client_epk`.
2. Server replies `session.init_ack` with `server_epk`, selected KDF + cipher suite.
3. Both derive `session_key` via ECDH + HKDF using transcript hash.
4. Server sends `session.key_confirm` containing key ID (`kid`) and `rotate_at`.

Recommended defaults:

- ECDH: X25519
- KDF: HKDF-SHA256
- Message AEAD: AES-256-GCM (or ChaCha20-Poly1305)

### 3.2 Rotation policy

Rotate key on first condition met:

- every 10 minutes, OR
- every 1 GiB encrypted payload, OR
- explicit `session.rotate_key` command.

A rotation uses fresh ephemeral keys and increments monotonic `kid_version`.

## 4) Message Contracts

All control messages share this envelope:

```json
{
  "v": 1,
  "type": "<message-type>",
  "session_id": "sess_123",
  "request_id": "req_123",
  "seq": 42,
  "ts": "2026-04-19T14:55:00.000Z",
  "payload": {}
}
```

### 4.1 Desktop stream frame envelope (media)

Binary payload header followed by encoded frame bytes:

- `v` (u8)
- `codec` (`h264` | `vp9` | `av1` | `jpeg`)
- `frame_id` (u64)
- `keyframe` (bool)
- `capture_ts_ms` (u64)
- `width` (u16), `height` (u16)
- `payload_len` (u32)
- `payload` (bytes)

Optional metadata side-channel (`media.stats`):

- `fps`, `bitrate_kbps`, `encode_ms`, `queue_depth`

### 4.2 Keyboard / mouse input events

- `input.key`
  - `key` (code), `pressed` (bool), `modifiers`
- `input.pointer_move`
  - `x`, `y`, `normalized` (bool)
- `input.pointer_button`
  - `button` (`left|middle|right`), `pressed`
- `input.pointer_wheel`
  - `dx`, `dy`

Input event rules:

- client includes strict increasing `seq`
- server emits `ack.input` with highest contiguous sequence
- stale/replayed `seq` MUST be dropped and audited

### 4.3 Control actions

- `control.ctrl_alt_del`
- `control.disconnect`
  - `reason` (`user_request|timeout|policy|network_error`)

Server responses:

- `control.accepted`
- `control.completed`
- `control.rejected` (`code`, `message`)

### 4.4 File APIs

All file operations are session-scoped and path-policy validated.

- `file.list`
  - request: `path`, `cursor?`, `limit?`
  - response: `entries[]`, `next_cursor?`
- `file.upload.begin`
  - request: `path`, `size`, `sha256`, `content_type?`
  - response: `upload_id`, `chunk_size`
- `file.upload.chunk`
  - request: `upload_id`, `offset`, `data` (base64/binary)
  - response: `ack_offset`
- `file.upload.commit`
  - request: `upload_id`
  - response: `file_id`, `etag`
- `file.download.begin`
  - request: `path`
  - response: `download_id`, `size`, `sha256`, `chunk_size`
- `file.download.chunk`
  - request: `download_id`, `offset`
  - response: `data`, `next_offset`, `eof`
- `file.delete`
  - request: `path`, `recursive?`
  - response: `deleted_count`

## 5) Backpressure, Reconnection, and Timeouts

### 5.1 Backpressure

When server/agent queues exceed threshold:

- emit `flow.pause` with `channel`, `reason`, `retry_after_ms`
- sender MUST stop non-critical traffic immediately
- sender resumes only after `flow.resume`

Media-specific behavior:

- drop intermediate delta frames when queue overloaded
- preserve latest keyframe cadence
- prioritize low latency over perfect frame delivery

File transfer behavior:

- sliding window chunk upload/download
- max in-flight chunks configurable (default: 8)
- adaptive chunk size (64 KiB → 1 MiB)

### 5.2 Reconnection

On transient disconnect:

1. Client enters `reconnecting` state.
2. Exponential backoff with jitter (250ms base, cap 10s).
3. Reconnect request includes `last_acked_seq`, `last_frame_id`, `kid`.
4. Server attempts session resume for up to `resume_ttl_ms` (default 60000).
5. If resume fails, emit `session.resume_rejected` and require full renegotiation.

### 5.3 Timeouts

- Control heartbeat interval: 5s
- Heartbeat timeout: 15s (3 missed heartbeats)
- Input command ack timeout: 2s
- File chunk ack timeout: 10s
- Key rotation grace timeout: 30s

Timeouts MUST generate audit events with machine-readable `timeout_type`.

## 6) Audit Stream Requirements

Every protocol-significant operation MUST be logged with both request and session identifiers.

Required fields:

- `event_id`, `event_ts`
- `request_id`, `session_id`, `node_id`, `agent_id`, `actor_id?`
- `channel` (`control|media`)
- `event_type`
- `status` (`ok|error|denied|timeout`)
- `seq?`, `frame_id?`, `kid?`
- `error_code?`, `error_message?`
- `remote_ip`, `user_agent?`

Minimum audited event types:

- `session_init`, `session_key_rotated`, `session_resumed`, `session_ended`
- `input_received`, `control_action`, `file_list`, `file_upload`, `file_download`, `file_delete`
- `flow_pause`, `flow_resume`, `timeout`, `auth_failure`, `policy_denied`

## 7) Versioning + Compatibility

- Every message carries `v` (protocol major).
- Unknown message types MUST return `error.unsupported_type` and be audited.
- Backward-compatible changes may add optional payload fields only.
