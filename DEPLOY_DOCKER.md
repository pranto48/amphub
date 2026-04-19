# Docker Deployment (Port 4455 + Local Database)

This project now includes a Docker setup that exposes the app on port **4455** and provisions a local PostgreSQL database container.

## Services

- **app**: RemoteOps web app, exposed on `http://localhost:4455`
- **db**: Local PostgreSQL database on `localhost:5433`

## Quick Start

```bash
docker compose up --build -d
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
