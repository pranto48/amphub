-- RemoteOps local Postgres schema (mirrors the Supabase schema, no auth.* tables).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email        text,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS user_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS desktop_nodes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  remote_id            text NOT NULL,
  local_ip             text NOT NULL,
  os                   text NOT NULL DEFAULT 'windows',
  status               text NOT NULL DEFAULT 'offline',
  last_seen            timestamptz,
  master_password_hash text,
  owner_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id       uuid NOT NULL REFERENCES desktop_nodes(id) ON DELETE CASCADE,
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending',
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  session_token text,
  expires_at    timestamptz
);

CREATE TABLE IF NOT EXISTS session_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    text NOT NULL,
  status       text NOT NULL DEFAULT 'PENDING',
  metadata     jsonb DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  expires_at   timestamptz,
  token        text
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_access_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_deny_outside_business_hours boolean NOT NULL DEFAULT false,
  business_hours_start text NOT NULL DEFAULT '08:00',
  business_hours_end text NOT NULL DEFAULT '18:00',
  require_two_step_sensitive_nodes boolean NOT NULL DEFAULT false,
  sensitive_node_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  max_session_duration_by_role jsonb NOT NULL DEFAULT '{"user": 30, "admin": 120}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default policy row
INSERT INTO admin_access_policies (id) VALUES ('00000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;

-- Optional bootstrap admin user: admin@admin.com / password
-- Set BOOTSTRAP_DEFAULT_ADMIN=true only for first-time local/dev bootstrap.
\getenv bootstrap_default_admin BOOTSTRAP_DEFAULT_ADMIN
\if :{?bootstrap_default_admin}
\if :bootstrap_default_admin
-- bcrypt hash of "password" (cost 10)
INSERT INTO users (id, email, password_hash)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@admin.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy')
ON CONFLICT (email) DO NOTHING;

INSERT INTO profiles (id, email, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@admin.com', 'Administrator')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;
\endif
\endif

-- Seed custom admin user: admin@amphub.com / Interst0ff
INSERT INTO users (id, email, password_hash)
VALUES ('00000000-0000-0000-0000-000000000002', 'admin@amphub.com',
        '$2b$10$3UFknKDg56eCZn2oKJeE3OXBC6UFn2kOhw8c9zUdobRIXI3tEgB96')
ON CONFLICT (email) DO NOTHING;

INSERT INTO profiles (id, email, display_name)
VALUES ('00000000-0000-0000-0000-000000000002', 'admin@amphub.com', 'Admin')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role)
VALUES ('00000000-0000-0000-0000-000000000002', 'admin')
ON CONFLICT DO NOTHING;

-- Seed a few demo desktop nodes so the dashboard is populated
INSERT INTO desktop_nodes (name, remote_id, local_ip, os, status, last_seen) VALUES
  ('Workstation-01', 'RM-7421-A19F', '192.168.1.42',  'windows', 'online',  now()),
  ('LinuxBox-Dev',   'RM-3308-C71B', '192.168.1.55',  'linux',   'online',  now()),
  ('FileServer',     'RM-9013-E22D', '192.168.1.10',  'linux',   'offline', now() - interval '2 hours')
ON CONFLICT DO NOTHING;
