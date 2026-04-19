# Docker Deployment (Port 4455 + Local Database)

This project includes a Docker setup that exposes the app on port **4455** and provisions a local PostgreSQL database container.

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

## Admin bootstrap (single source of truth)

Admin credentials are sourced **only** from the DB container environment variables:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

The startup script at `docker/postgres/init/00-bootstrap-auth.sh` uses those values to:

1. Create/locate the admin account in `auth.users` (Supabase Auth/local equivalent).
2. Ensure the account has `admin` in `public.user_roles`.
3. Mark seed completion in `public.bootstrap_seeds` with key `auth_admin_v1` so it does not re-run on every restart.

> If `auth.users` is not present (for example, non-Supabase Postgres), the auth bootstrap is skipped.

## Credential rotation

1. Update `BOOTSTRAP_ADMIN_EMAIL` and/or `BOOTSTRAP_ADMIN_PASSWORD` in your deployment secret source (`.env`, CI secret store, or orchestrator secret).
2. Rotate the password for the existing auth user in Supabase Auth (Dashboard or admin API) to the new value.
3. Restart the stack:

```bash
docker compose up -d
```

4. Verify login with the new credentials and verify role assignment:

```sql
select user_id, role from public.user_roles where role = 'admin';
```

## Environment Variables

The app requires Supabase API settings. In `docker-compose.yml`, these default to local placeholders:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

If you run a local/self-hosted Supabase gateway, set these to that endpoint/key.
