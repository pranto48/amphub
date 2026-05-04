# RemoteOps — Docker Self-Hosted Deployment

This repository’s canonical Docker deployment for new users is the **`db + api + web`** stack defined in `docker-compose.yml`.

## Canonical mode (recommended)

Use this for all new installs.

### Services

- `db` — PostgreSQL 16 with schema/bootstrap from `server/init.sql`
- `api` — Node/Express + WebSocket backend on internal port `4000`
- `web` — Nginx serving the SPA and proxying `/api` + `/ws` to `api`

### Exposed ports

- `web`: `8080:80` (open app at `http://localhost:8080`)
- `db`: no host port published (internal to compose network)
- `api`: no host port published (internal to compose network, exposed to `web` as `4000`)

### Startup command

```bash
docker compose up --build -d
```

### Required environment variables

- `JWT_SECRET` (**required for production**)

Example:

```bash
JWT_SECRET="$(openssl rand -hex 64)" docker compose up --build -d
```

If you do not set `JWT_SECRET`, compose uses the insecure default `please-change-me` from `docker-compose.yml`.

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

- **Old app URL/port:** `http://localhost:4455`
- **New app URL/port:** `http://localhost:8080`
- **Old gateway URL/port:** `http://localhost:8000` (Kong/Supabase gateway)
- **New default:** no Kong gateway in the canonical stack
- **Old file assumptions:** a compose file including `app`, `kong`, `auth`, `rest`, `realtime`
- **New canonical file:** `docker-compose.yml` with `db`, `api`, `web`

## Reset database

To wipe all data and re-run `server/init.sql`:

```bash
docker compose down -v
docker compose up --build -d
```
