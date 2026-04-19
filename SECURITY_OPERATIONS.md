# Security Operations Runbook

## 1) Password hashing and verification
- Node master passwords are set only through `public.set_node_master_password`, which uses server-side bcrypt (`pgcrypto/crypt`) and never stores plaintext.
- Verification goes through `public.verify_node_master_password`, which tracks failed attempts and enforces lockout windows.

## 2) Rate limiting + brute-force lockout
- Global security throttle state is stored in `public.security_throttle`.
- Core guard function: `public.security_throttle_guard(scope, actor_key, max_attempts, window_seconds, lockout_seconds)`.
- Applied scopes:
  - `login` via `public.guard_auth_login_attempt` + `public.mark_auth_login_success`
  - `access_request` via `public.guard_access_request_submission`
  - `remote_id_probe` via `public.guard_remote_id_probe`

## 3) RBAC enforcement for sensitive operations
- `public.record_privileged_event` enforces strict role checks:
  - `file_upload`, `file_create_folder`, `file_delete` => admin only
  - remote control/session control actions => admin only
  - `file_read`/`file_download` remain approval-gated and available to authenticated requesters

## 4) Secret management for agent/signing keys
- Keys are persisted encrypted at rest in `public.secret_material`.
- Use:
  - `public.set_secret_material(secret_name, purpose, plaintext, key_version)`
  - `public.get_secret_material(secret_name)`
- Encryption key is read from PostgreSQL runtime setting `app.settings.secrets_kek` (server setting), not plaintext app env variables in application code.
- Rotate keys by updating `key_version` and re-running `set_secret_material`.

## 5) Monitoring + alerting
- Alerts table: `public.security_alerts`.
- Auto-raise alerts from throttle guard for:
  - lockouts (`category=lockout`, `severity=high`)
  - request/auth storms (`category=auth_storm`, `severity=critical`)
- Review in admin tooling or query directly:
  ```sql
  select * from public.security_alerts where status = 'open' order by created_at desc;
  ```

## 6) Backup and restore plan (DB + key material)

### Backup cadence
- **Hourly WAL/archive** (PITR capable).
- **Daily full logical backup** (schema + data).
- **Daily encrypted export** of `public.secret_material` metadata/ciphertext.
- Retention recommendations:
  - 35 days online
  - 12 monthly snapshots offline

### Backup commands (example)
```bash
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > backups/amphub-$(date +%F).dump
psql "$DATABASE_URL" -c "copy (select secret_name,purpose,key_version,encode(encrypted_value, 'base64'),updated_at from public.secret_material) to stdout with csv header" > backups/secret_material-$(date +%F).csv
```

### Restore drill
1. Restore latest base backup to staging.
2. Apply WAL/PITR target timestamp.
3. Validate core tables (`access_requests`, `desktop_nodes`, `audit_log`, `secret_material`).
4. Set `app.settings.secrets_kek` on restored instance.
5. Validate decryption of one canary secret with `public.get_secret_material`.
6. Run smoke tests for login, request creation, and privileged file actions.

### Recovery objectives
- **RPO target:** <= 1 hour.
- **RTO target:** <= 4 hours.
- Run quarterly restore tests and document outcomes.
