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

- The gateway routes are defined in `docker/kong/kong.yml` for:
  - `/auth/v1/*`
  - `/rest/v1/*`
  - `/realtime/v1/*`
- Existing app code in `src/integrations/supabase/client.ts` and route files continues to work unchanged, now against local services.
