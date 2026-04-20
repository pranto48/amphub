ALTER TABLE public.desktop_nodes
  ADD COLUMN IF NOT EXISTS verify_window_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verify_window_count INTEGER NOT NULL DEFAULT 0;

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
  rate_window CONSTANT INTERVAL := interval '5 minutes';
  rate_limit_count CONSTANT INTEGER := 10;
  next_window_started_at TIMESTAMPTZ;
  next_window_count INTEGER;
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

  IF node_rec.verify_window_started_at IS NULL OR node_rec.verify_window_started_at + rate_window < now() THEN
    next_window_started_at := now();
    next_window_count := 1;
  ELSE
    next_window_started_at := node_rec.verify_window_started_at;
    next_window_count := coalesce(node_rec.verify_window_count, 0) + 1;
  END IF;

  UPDATE public.desktop_nodes
  SET verify_window_started_at = next_window_started_at,
      verify_window_count = next_window_count
  WHERE id = p_node_id;

  IF next_window_count > rate_limit_count THEN
    new_locked_until := greatest(coalesce(node_rec.locked_until, now()), now() + interval '5 minutes');

    UPDATE public.desktop_nodes
    SET locked_until = new_locked_until
    WHERE id = p_node_id;

    INSERT INTO public.audit_log (actor_id, action, target, metadata)
    VALUES (
      current_uid,
      'node_password_verify_rate_limited',
      p_node_id::TEXT,
      jsonb_build_object(
        'context', p_context,
        'verify_window_count', next_window_count,
        'verify_window_started_at', next_window_started_at,
        'locked_until', new_locked_until
      )
    );

    RETURN QUERY SELECT FALSE, 'rate_limited', node_rec.failed_attempts, new_locked_until, node_rec.password_version, node_rec.password_updated_at;
    RETURN;
  END IF;

  PERFORM pg_sleep(0.35);

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
      jsonb_build_object(
        'context', p_context,
        'password_version', node_rec.password_version,
        'verify_window_count', next_window_count,
        'verify_window_started_at', next_window_started_at
      )
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
      'locked_until', new_locked_until,
      'verify_window_count', next_window_count,
      'verify_window_started_at', next_window_started_at
    )
  );

  RETURN QUERY SELECT FALSE, 'invalid_password', new_attempts, new_locked_until, node_rec.password_version, node_rec.password_updated_at;
END;
$$;
