CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.desktop_nodes
  ADD COLUMN IF NOT EXISTS password_algo TEXT,
  ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_node_master_password(
  p_node_id UUID,
  p_password TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  error_code TEXT,
  password_algo TEXT,
  password_updated_at TIMESTAMPTZ,
  password_version INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  new_updated_at TIMESTAMPTZ;
  new_version INTEGER;
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'unauthenticated', NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
    RETURN;
  END IF;

  IF NOT public.has_role(current_uid, 'admin') THEN
    RETURN QUERY SELECT FALSE, 'forbidden', NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
    RETURN;
  END IF;

  IF p_password IS NULL OR length(btrim(p_password)) < 8 OR length(p_password) > 128 THEN
    RETURN QUERY SELECT FALSE, 'password_length_invalid', NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
    RETURN;
  END IF;

  UPDATE public.desktop_nodes
  SET master_password_hash = crypt(p_password, gen_salt('bf', 12)),
      password_algo = 'bcrypt',
      password_updated_at = now(),
      password_version = coalesce(password_version, 0) + 1,
      failed_attempts = 0,
      locked_until = NULL
  WHERE id = p_node_id
  RETURNING desktop_nodes.password_updated_at, desktop_nodes.password_version
  INTO new_updated_at, new_version;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'node_not_found', NULL::TEXT, NULL::TIMESTAMPTZ, NULL::INTEGER;
    RETURN;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'node_password_updated',
    p_node_id::TEXT,
    jsonb_build_object('password_algo', 'bcrypt', 'password_version', new_version)
  );

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'bcrypt'::TEXT, new_updated_at, new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_node_master_password(
  p_node_id UUID,
  p_password TEXT,
  p_context TEXT DEFAULT NULL
)
RETURNS TABLE (
  verified BOOLEAN,
  error_code TEXT,
  failed_attempts INTEGER,
  locked_until TIMESTAMPTZ,
  password_version INTEGER,
  password_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  node_rec public.desktop_nodes%ROWTYPE;
  new_attempts INTEGER;
  new_locked_until TIMESTAMPTZ;
  lockout_threshold CONSTANT INTEGER := 5;
  lockout_window CONSTANT INTERVAL := interval '15 minutes';
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'unauthenticated', NULL::INTEGER, NULL::TIMESTAMPTZ, NULL::INTEGER, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO node_rec
  FROM public.desktop_nodes
  WHERE id = p_node_id
  FOR UPDATE;

  IF node_rec.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'node_not_found', NULL::INTEGER, NULL::TIMESTAMPTZ, NULL::INTEGER, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF node_rec.master_password_hash IS NULL THEN
    RETURN QUERY SELECT FALSE, 'password_not_configured', node_rec.failed_attempts, node_rec.locked_until, node_rec.password_version, node_rec.password_updated_at;
    RETURN;
  END IF;

  IF node_rec.locked_until IS NOT NULL AND node_rec.locked_until > now() THEN
    INSERT INTO public.audit_log (actor_id, action, target, metadata)
    VALUES (
      current_uid,
      'node_password_verify_locked',
      p_node_id::TEXT,
      jsonb_build_object(
        'context', p_context,
        'failed_attempts', node_rec.failed_attempts,
        'locked_until', node_rec.locked_until
      )
    );

    RETURN QUERY SELECT FALSE, 'locked', node_rec.failed_attempts, node_rec.locked_until, node_rec.password_version, node_rec.password_updated_at;
    RETURN;
  END IF;

  IF crypt(coalesce(p_password, ''), node_rec.master_password_hash) = node_rec.master_password_hash THEN
    UPDATE public.desktop_nodes
    SET failed_attempts = 0,
        locked_until = NULL
    WHERE id = p_node_id;

    INSERT INTO public.audit_log (actor_id, action, target, metadata)
    VALUES (
      current_uid,
      'node_password_verify_success',
      p_node_id::TEXT,
      jsonb_build_object('context', p_context, 'password_version', node_rec.password_version)
    );

    RETURN QUERY SELECT TRUE, NULL::TEXT, 0, NULL::TIMESTAMPTZ, node_rec.password_version, node_rec.password_updated_at;
    RETURN;
  END IF;

  new_attempts := coalesce(node_rec.failed_attempts, 0) + 1;
  IF new_attempts >= lockout_threshold THEN
    new_locked_until := now() + lockout_window;
  ELSE
    new_locked_until := NULL;
  END IF;

  UPDATE public.desktop_nodes
  SET failed_attempts = new_attempts,
      locked_until = new_locked_until
  WHERE id = p_node_id;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'node_password_verify_failed',
    p_node_id::TEXT,
    jsonb_build_object(
      'context', p_context,
      'failed_attempts', new_attempts,
      'locked_until', new_locked_until
    )
  );

  RETURN QUERY SELECT FALSE, 'invalid_password', new_attempts, new_locked_until, node_rec.password_version, node_rec.password_updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_node_master_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_node_master_password(UUID, TEXT, TEXT) TO authenticated;
