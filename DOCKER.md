# RemoteOps — Docker Self-Hosted Deployment

This repository’s canonical Docker deployment for new users is the **`db + api + web`** stack defined in `docker-compose.yml`.

## Canonical mode (recommended)

Use this for all new installs.

### Services

- `api` — Node/Express + WebSocket backend on internal port `4000` (embedded SQLite database engine)
- `web` — Nginx serving the SPA and proxying `/api` + `/ws` to `api`

### Exposed ports

- `web`: `3355:80` (open app at `http://localhost:3355`)
- `api`: `7766:4000` (connection signaling service, exposed to host on `7766`)

### Startup command

```bash
docker compose up --build -d
```
### Mandatory production checklist (before first start)

1. Generate and export a strong JWT secret (at least 64 hex chars):
   ```bash
   export JWT_SECRET="$(openssl rand -hex 64)"
   ```
2. Ensure bootstrap admin is disabled:
   ```bash
   export BOOTSTRAP_DEFAULT_ADMIN=false
   ```
3. Confirm you are not using demo credentials (`admin@admin.com` / `password`) anywhere.
4. Start the stack only after variables are exported in your shell (or `.env` file used by Compose).


### Required environment variables

- `JWT_SECRET` (**required for production**)

Example:

```bash
JWT_SECRET="$(openssl rand -hex 64)" docker compose up --build -d
```

If you do not set `JWT_SECRET`, startup will fail because `docker-compose.yml` requires an explicit value.

## Deployment Modes

### 1) Canonical app stack (recommended)

- **Compose file(s):** `docker-compose.yml`
- **Command:**

```bash
docker compose -f docker-compose.yml up --build -d
```

### 2) Legacy Supabase image-tag pinning override (only for old custom stacks)

This repo also includes a compatibility override for older Supabase-heavy compose setups that are **not** the default deployment in this repository.

- **Compose file(s):**
  - your existing legacy compose file (must define `auth`, `rest`, `realtime`, `kong`)
  - `docker-compose.supabase-pins.yml`
- **Command:**

```bash
docker compose \
  -f <your-legacy-compose-file>.yml \
  -f docker-compose.supabase-pins.yml \
  up --build -d
```

## If you are following old docs

Older docs and examples in this project referred to a Supabase gateway + app setup with different ports/files.

- **Old app URL/port:** `http://localhost:8080`
- **New app URL/port:** `http://localhost:3355`
- **Old gateway URL/port:** `http://localhost:8000` (Kong/Supabase gateway)
- **New default:** no Kong gateway in the canonical stack, direct nginx + SQLite architecture
- **Old file assumptions:** a compose file including `db`, `api`, `web` using PostgreSQL
- **New canonical file:** `docker-compose.yml` with `api`, `web` using embedded SQLite

## Reset database

To wipe all data and reset the database:

```bash
rm -rf ./data/*
docker compose restart api
```

## Troubleshooting startup/readiness

- The stack uses health-gated startup ordering:
  - `db` must report healthy before `api` starts.
  - `api` must report healthy before `web` starts.
- `api` health is checked via `http://127.0.0.1:4000/api/health` inside the `api` container.
- This reduces early boot races where `web` comes up before backend readiness.

Useful checks:

```bash
docker compose ps
docker compose logs -f db api web
```

If `api` is repeatedly unhealthy, verify the application health endpoint:

```bash
docker compose exec api sh -lc 'wget -qO- http://127.0.0.1:4000/api/health && echo'
```
