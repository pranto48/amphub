# RemoteOps — Docker self-hosted deployment

This repo can run in two modes:

| Mode       | Backend                | When                         |
|------------|------------------------|------------------------------|
| `supabase` | Lovable Cloud (default)| In the Lovable preview       |
| `rest`     | Express + Postgres + WS| Self-hosted via `docker compose` |

The mode is controlled at **build time** by `VITE_BACKEND_MODE`. The Lovable
preview keeps using Supabase. The Docker image is built with `rest`.

## Quick start (Docker)

```bash
git clone <this-repo>
cd <this-repo>
docker compose up --build -d
```

Then open **http://localhost:8080**.

Default admin account (created automatically by `server/init.sql`):

- **Email:** `admin@admin.com`
- **Password:** `password`

> ⚠️ Change this immediately after first login from **Security → Change your password**.

The compose stack starts three services:

- `db`  — Postgres 16, schema and seed loaded from `server/init.sql`
- `api` — Node/Express + WebSocket server on internal port 4000
- `web` — Nginx serving the built SPA on host port **8080**, proxying `/api` and `/ws` to `api`

### Configuration

Set a strong JWT secret in production:

```bash
JWT_SECRET="$(openssl rand -hex 64)" docker compose up -d
```

To reset the database (wipes all data and re-runs `init.sql`):

```bash
docker compose down -v
docker compose up --build -d
```

### Architecture

```
 ┌────────┐    /api/*    ┌─────┐      ┌────┐
 │ Nginx  │ ───────────► │ API │ ───► │ DB │
 │ (web)  │    /ws       └─────┘      └────┘
 └────────┘ ───────────► (WebSocket)
       ▲
       │ static SPA
       │
   user browser
```

### Endpoints (server)

| Method | Path                                  | Description                           |
|--------|---------------------------------------|---------------------------------------|
| POST   | `/api/auth/signup`                    | Create user (default role `user`)     |
| POST   | `/api/auth/login`                     | Returns JWT                           |
| GET    | `/api/auth/me`                        | Current user                          |
| GET    | `/api/auth/role`                      | `{ isAdmin }`                         |
| POST   | `/api/auth/password`                  | Update own password                   |
| GET    | `/api/profiles/:id`                   | Read profile                          |
| PATCH  | `/api/profiles/:id`                   | Update display name (own only)        |
| GET    | `/api/nodes`                          | List desktop nodes                    |
| GET    | `/api/nodes/:id`                      | Single node                           |
| POST   | `/api/nodes/:id/master-password`      | Admin: set master password hash       |
| GET    | `/api/access-requests?status=pending` | Admin: pending requests               |
| POST   | `/api/access-requests`                | Create access request                 |
| GET    | `/api/access-requests/:id`            | Single request                        |
| POST   | `/api/access-requests/:id/decision`   | Admin: `{ approve: true \| false }`   |
| GET    | `/api/audit?limit=20`                 | Admin: audit log                      |
| WS     | `/ws?token=<jwt>`                     | Realtime push                         |

Realtime payloads:

```json
{ "table": "access_requests", "type": "INSERT" | "UPDATE", "row": { ... } }
{ "table": "desktop_nodes",   "type": "INSERT" | "UPDATE" | "DELETE", "row": { ... } }
```

## Why your previous `docker compose` failed

You tried to run a self-hosted Supabase stack which pulls `supabase/gotrue:latest`
— that image tag does not exist (Supabase tags by version, not `latest`).
This Compose file does not use Supabase images at all; the Postgres + Express
backend is fully self-contained.

## Streaming

The remote desktop viewer is still a placeholder. See `STREAMING.md` for paths
to plug in a real RDP/VNC/WebRTC agent.
