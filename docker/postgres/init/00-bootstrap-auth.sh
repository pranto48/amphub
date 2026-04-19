#!/usr/bin/env bash
set -euo pipefail

: "${BOOTSTRAP_ADMIN_EMAIL:=admin@remoteops.local}"
: "${BOOTSTRAP_ADMIN_PASSWORD:=Admin@4455!}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v bootstrap_admin_email="$BOOTSTRAP_ADMIN_EMAIL" \
  -v bootstrap_admin_password="$BOOTSTRAP_ADMIN_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.bootstrap_seeds (
  name TEXT PRIMARY KEY,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_seed_name CONSTANT TEXT := 'auth_admin_v1';
  v_admin_email TEXT := :'bootstrap_admin_email';
  v_admin_password TEXT := :'bootstrap_admin_password';
  v_admin_user_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bootstrap_seeds WHERE name = v_seed_name) THEN
    RAISE NOTICE 'Admin auth seed already applied (%).', v_seed_name;
    RETURN;
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'auth.users does not exist; skipping admin auth bootstrap.';
    RETURN;
  END IF;

  SELECT id
    INTO v_admin_user_id
    FROM auth.users
   WHERE email = v_admin_email
   LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    v_admin_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      v_admin_user_id,
      'authenticated',
      'authenticated',
      v_admin_email,
      crypt(v_admin_password, gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      '{}'::jsonb,
      now(),
      now()
    );
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_admin_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.bootstrap_seeds (name)
  VALUES (v_seed_name)
  ON CONFLICT (name) DO NOTHING;
END
$$;
SQL
