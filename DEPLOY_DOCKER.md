# Docker Deployment (Fully Self-Hosted Supabase + App)

This project now runs against a **fully self-hosted Supabase stack** in Docker, so auth, realtime notifications, and data reads are local (no cloud Supabase dependency).

## Architecture Decision

- ✅ Selected: **Self-hosted Supabase stack**.
- ❌ Not selected: custom API rewrite to replace all `supabase-js` route usage.

Keeping the existing Supabase client integration avoids a large route-by-route refactor while still removing cloud runtime dependencies.

## Services

- **app**: Amphub web app on `http://localhost:4455`
- **kong**: local Supabase gateway on `http://localhost:8000`
- **auth** (`supabase/gotrue`): authentication service
- **rest** (`postgrest`): Postgres-backed API for table/RPC reads/writes
- **realtime** (`supabase/realtime`): websocket change notifications
- **db**: local PostgreSQL database on `localhost:5433`

## Startup Ordering + Health Checks

`docker-compose.yml` defines health checks for every stack component and `depends_on` conditions so startup waits for dependencies:

- `db` must be healthy before `auth`, `rest`, `realtime`.
- `auth`, `rest`, `realtime` must be healthy before `kong`.
- `kong` and `db` must be healthy before `app`.

## Environment Wiring

The app points to the local gateway by default:

- `VITE_SUPABASE_URL=http://kong:8000`
- `SUPABASE_URL=http://kong:8000`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<local anon key>`
- `SUPABASE_PUBLISHABLE_KEY=<local anon key>`
- `SUPABASE_SERVICE_ROLE_KEY=<local service role key>`

You can override any of these with host environment variables when needed.

## Quick Start

```bash
docker compose up --build -d
```

Then open:

- App: `http://localhost:4455`
- Supabase gateway: `http://localhost:8000`

## Notes

If you run a local/self-hosted Supabase gateway, set these to that endpoint/key.

## Troubleshooting: `supabase/gotrue:latest` manifest unknown

If you are running an older/full Supabase self-host docker compose stack and see:

```
manifest for supabase/gotrue:latest not found
```

it means that `latest` is not a valid tag for `supabase/gotrue`.

### Fix options

1. **Quick one-line patch in your compose file**

```bash
sed -i 's|supabase/gotrue:latest|supabase/gotrue:v2.186.0|g' docker-compose.yml
```

2. **Use the pinned override file in this repo** (for stacks that have `auth`, `rest`, `realtime`, `kong` services):

```bash
docker compose --profile prod \
  -f docker-compose.yml \
  -f docker-compose.supabase-pins.yml \
  up --build -d
```

3. **Pull tag explicitly to verify**

```bash
docker pull supabase/gotrue:v2.186.0
```

> Note: the default `docker-compose.yml` in this repo runs only `app` + `db` and does not require `supabase/gotrue` directly.
