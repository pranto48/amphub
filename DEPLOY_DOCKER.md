# Deploy with Docker

For new users, the canonical deployment is the **`db + api + web`** stack in `docker-compose.yml`.

## Services

- `db` — PostgreSQL 16
- `api` — Express/WebSocket backend
- `web` — Nginx frontend/reverse proxy

## Exposed ports

- `http://localhost:8080` → `web` (`8080:80`)
- `api` and `db` are internal-only in the default compose network

## Startup command

```bash
docker compose up --build -d
```

## Required environment variables

- `JWT_SECRET` (required in production)

Example:

```bash
JWT_SECRET="$(openssl rand -hex 64)" docker compose up --build -d
```

## Deployment Modes

### Canonical mode (recommended)

- **Compose file(s):** `docker-compose.yml`
- **Command:**

```bash
docker compose -f docker-compose.yml up --build -d
```

### Legacy Supabase pinning mode (compatibility only)

Use this only if you maintain an older compose stack that includes `auth`, `rest`, `realtime`, and `kong` services.

- **Compose file(s):**
  - your legacy compose file
  - `docker-compose.supabase-pins.yml`
- **Command:**

```bash
docker compose \
  -f <your-legacy-compose-file>.yml \
  -f docker-compose.supabase-pins.yml \
  up --build -d
```

## If you are following old docs

- **Old app port:** `4455`
- **New app port:** `8080`
- **Old Supabase/Kong port:** `8000`
- **New canonical mode:** no Supabase gateway service exposed
- **Old stack naming:** `app` + Supabase services
- **New stack naming:** `db` + `api` + `web`
