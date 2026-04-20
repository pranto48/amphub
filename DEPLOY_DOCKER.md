# Docker Deployment (Port 4455 + Local Database)

This project now includes a Docker setup that exposes the app on port **4455** and provisions a local PostgreSQL database container.

## Services

- **app**: RemoteOps web app, exposed on `http://localhost:4455`
- **db**: Local PostgreSQL database on `localhost:5433`

## Quick Start

```bash
docker compose up --build -d
```

If you previously built with an older Dockerfile, rebuild without cache:

```bash
docker compose build --no-cache app
docker compose up -d
```

Then open:
- App: `http://localhost:4455`

## Default Local Bootstrap Admin (database bootstrap table)

For initial installer/local bootstrap workflows, the local DB seeds:
- **Email**: `admin@remoteops.local`
- **Password**: `Admin@4455!`

Stored in table: `public.bootstrap_admin`.

> Change credentials immediately for any non-local environment.

## Environment Variables

The app requires Supabase API settings. In `docker-compose.yml`, these default to local placeholders:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

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
