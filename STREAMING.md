# Real Streaming Integration Paths

The remote-session viewer in this app is a **placeholder**. Actual desktop streaming requires software running on each target desktop. This document outlines viable integration paths and how to wire them into the approval-gated session token flow already implemented.

> Protocol details now live in **`REMOTE_PROTOCOL.md`** (channel model, auth, key rotation, backpressure/reconnect, and audit requirements).

## 1. Apache Guacamole (recommended for RDP/VNC)

- Run `guacd` and `guacamole-client` (or the headless `guacamole-common-js` API) in Docker alongside the central server.
- For each approved `access_request`, mint a Guacamole connection config with the node's local IP / RDP credentials and return a one-time JWT.
- Replace the `<canvas>` placeholder in `_authenticated.nodes.$id.session.tsx` with `Guacamole.Client` bound to a WebSocket tunnel.
- Pros: handles RDP, VNC, SSH; HTML5 native; mature.
- Cons: requires Java backend (`guacd` is C, the web app is Java).

## 2. noVNC + websockify (pure VNC)

- Install a VNC server on each target (TigerVNC on Linux, TightVNC on Windows).
- Run `websockify` to bridge VNC TCP to WebSocket.
- Embed `noVNC`'s `RFB` client in the session route.
- Token issued at approval time becomes the WebSocket auth header.

## 3. Custom WebRTC agent (AnyDesk-style)

- Build a small native agent (Rust/Go/C++) that captures the desktop and streams via WebRTC.
- Use Lovable Cloud / Supabase Realtime as the **signaling** channel (offer/answer/ICE).
- Approval issues an ephemeral signaling room ID + auth token.
- Pros: true P2P, low latency, encrypted.
- Cons: substantial native engineering; per-OS capture quirks.

## 4. Why "AnyDesk-style" requires a native agent

Browsers cannot capture a remote machine's screen. The Remote ID flow only works if a process running **on the target desktop** registers with the central server, holds an outbound WebSocket, and streams frames on demand. Lovable/Supabase can host the rendezvous + auth, but the capture/encode loop must run natively.

## Wiring the existing approval flow

The DB already issues a `session_token` and `expires_at` when an admin approves a request. Any of the integrations above should:

1. Validate `session_token` against `access_requests` server-side (via a TanStack server function or edge function).
2. Confirm `expires_at > now()`.
3. Mint a downstream auth artifact (Guacamole JWT, noVNC password, WebRTC room token).
4. Return a short-lived URL/token to the client, which the viewer component uses to connect.

This keeps approval enforcement centralized and lets you swap streaming backends without touching the access-control logic.
