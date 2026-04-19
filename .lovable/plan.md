
# Remote Desktop Management & File Access Dashboard

A secure IT-admin console for managing remote desktop nodes, with real auth/backend (Lovable Cloud) and a documented path to integrate a real streaming agent later.

## Tech & Backend
- **Lovable Cloud** for auth (email/password), Postgres, realtime, and RLS
- **Roles in dedicated `user_roles` table** (`admin`, `user`) — never on profiles
- **Realtime channels** for approval requests and node status changes
- Simulated remote filesystem (in-memory per node) — no real file storage
- Streaming viewer is a placeholder canvas; a separate `STREAMING.md` doc will explain how to plug in a real RDP/VNC/AnyDesk-style agent

## Data Model
- `profiles` (id, display_name, email)
- `user_roles` (user_id, role) + `has_role()` security definer fn
- `desktop_nodes` (id, name, remote_id, local_ip, os, status, last_seen, master_password_hash, owner_id)
- `access_requests` (id, node_id, requester_id, status: pending/approved/denied/expired, requested_at, decided_at, decided_by, session_token)
- `audit_log` (id, actor_id, action, target, metadata, created_at)

## Routes
- `/login`, `/signup` — auth
- `/` — Dashboard: node grid with status dot, OS icon, Remote ID (mono), Local IP, "Remote Access" / "Local Access" buttons
- `/nodes/:id` — Node detail: connection state, recent activity
- `/nodes/:id/files` — Simulated File Explorer (browse, create folder, "upload"/"download"/delete with role-gated permissions)
- `/nodes/:id/session` — Remote Desktop viewer: canvas placeholder + toolbar (Ctrl+Alt+Del, Fullscreen, Disconnect)
- `/admin` — Admin Panel: pending access requests with realtime toasts, approve/deny, manage nodes, set master passwords, view audit log
- `/security` — Security Settings: change own password, per-node master password (admin)
- `/settings` — profile + LAN-mode toggle

## Key Flows

### Two-tier connection
- LAN toggle (or auto-detect via simple client IP heuristic) → "Local Access" button connects directly (placeholder)
- Otherwise → "Request Remote Access" creates a `pending` `access_requests` row

### Admin approval (realtime)
- Admin Panel subscribes to `access_requests` inserts → toast notification + live pending list
- Approve → status `approved`, generates short-lived `session_token`, requester's pending screen flips to "Granted" and routes to `/nodes/:id/session`
- Deny → status `denied`, requester sees rejection
- Tokens expire after N minutes; expired sessions kick to dashboard

### File Explorer (simulated)
- Per-node tree kept in component state seeded with realistic folders (Documents, Downloads, System32/etc)
- Users: view + download; Admins: + upload, create folder, delete
- Lucide icons per file type (FileText, FileImage, FileCode, Folder, etc.)

### Remote viewer placeholder
- Canvas fills the viewport with animated grid + node info overlay ("Streaming agent not connected — see STREAMING.md")
- Working toolbar buttons (Fullscreen API, Disconnect returns to dashboard, Ctrl+Alt+Del shows toast)

## Design
- Dark slate/zinc base, cyan + emerald accents, subtle borders
- Monospace for Remote IDs and IPs
- Status dots: emerald (online), zinc (offline), amber (pending)
- Sidebar nav (collapsible) with sections: Dashboard, Nodes, Files, Admin, Security, Settings
- Responsive: sidebar collapses to icons on tablet, cards stack on mobile

## Security Notes (built-in)
- All tables RLS-enabled; users see only their own requests, admins see all
- Master passwords stored as hashes (bcrypt via server fn), never returned to client
- Audit log entries written on every approve/deny/file action
- Zod validation on all inputs (node names, IPs, passwords)

## Streaming Research Deliverable
A `STREAMING.md` in the repo summarizing realistic integration paths:
- Apache Guacamole (HTML5 RDP/VNC gateway via guacd)
- noVNC + websockify for VNC
- Custom WebRTC agent (signaling via Lovable Cloud)
- Why true AnyDesk-style P2P needs a native agent on each desktop
- How to wire approval-gated session tokens into each option

## Out of Scope (stated up front)
- Actual desktop streaming, real file I/O on remote machines, or installing agents — these require software running on the target desktops outside Lovable
