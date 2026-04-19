CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bootstrap_admin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.bootstrap_admin (email, password, role)
VALUES ('admin@remoteops.local', 'Admin@4455!', 'admin')
ON CONFLICT (email) DO NOTHING;
