CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.security_throttle (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, actor_key)
);

ALTER TABLE public.security_throttle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view throttle state" ON public.security_throttle;
CREATE POLICY "Admins view throttle state" ON public.security_throttle
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  category TEXT NOT NULL,
  alert_key TEXT,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view security alerts" ON public.security_alerts;
CREATE POLICY "Admins view security alerts" ON public.security_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update security alerts" ON public.security_alerts;
CREATE POLICY "Admins update security alerts" ON public.security_alerts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_security_alerts_status_created ON public.security_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_throttle_scope_updated ON public.security_throttle(scope, updated_at DESC);

CREATE OR REPLACE FUNCTION public.raise_security_alert(
  p_severity TEXT,
  p_category TEXT,
  p_alert_key TEXT,
  p_summary TEXT,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.security_alerts (severity, category, alert_key, summary, details)
  VALUES (p_severity, p_category, p_alert_key, p_summary, COALESCE(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    auth.uid(),
    'security_alert_raised',
    p_alert_key,
    jsonb_build_object(
      'severity', p_severity,
      'category', p_category,
      'summary', p_summary,
      'details', COALESCE(p_details, '{}'::jsonb)
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.security_throttle_guard(
  p_scope TEXT,
  p_actor_key TEXT,
  p_max_attempts INTEGER,
  p_window_seconds INTEGER,
  p_lockout_seconds INTEGER,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  allowed BOOLEAN,
  denial_reason TEXT,
  attempt_count INTEGER,
  locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  now_ts TIMESTAMPTZ := now();
  row_rec public.security_throttle%ROWTYPE;
  max_attempts INTEGER := GREATEST(1, COALESCE(p_max_attempts, 5));
  window_seconds INTEGER := GREATEST(30, COALESCE(p_window_seconds, 300));
  lockout_seconds INTEGER := GREATEST(30, COALESCE(p_lockout_seconds, 900));
  storm_count INTEGER;
BEGIN
  IF p_scope IS NULL OR btrim(p_scope) = '' OR p_actor_key IS NULL OR btrim(p_actor_key) = '' THEN
    RETURN QUERY SELECT FALSE, 'invalid_key', 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO row_rec
  FROM public.security_throttle
  WHERE scope = p_scope
    AND actor_key = p_actor_key
  FOR UPDATE;

  IF row_rec.scope IS NULL THEN
    INSERT INTO public.security_throttle (scope, actor_key, attempt_count, window_started_at, last_attempt_at)
    VALUES (p_scope, p_actor_key, 1, now_ts, now_ts)
    RETURNING * INTO row_rec;
  ELSE
    IF row_rec.locked_until IS NOT NULL AND row_rec.locked_until > now_ts THEN
      UPDATE public.security_throttle
      SET last_attempt_at = now_ts,
          updated_at = now_ts
      WHERE scope = p_scope
        AND actor_key = p_actor_key
      RETURNING * INTO row_rec;

      RETURN QUERY SELECT FALSE, 'locked', row_rec.attempt_count, row_rec.locked_until;
      RETURN;
    END IF;

    IF row_rec.window_started_at <= now_ts - make_interval(secs => window_seconds) THEN
      row_rec.attempt_count := 0;
      row_rec.window_started_at := now_ts;
    END IF;

    row_rec.attempt_count := row_rec.attempt_count + 1;
    row_rec.last_attempt_at := now_ts;

    IF row_rec.attempt_count >= max_attempts THEN
      row_rec.locked_until := now_ts + make_interval(secs => lockout_seconds);
    ELSE
      row_rec.locked_until := NULL;
    END IF;

    UPDATE public.security_throttle
    SET attempt_count = row_rec.attempt_count,
        window_started_at = row_rec.window_started_at,
        last_attempt_at = row_rec.last_attempt_at,
        locked_until = row_rec.locked_until,
        updated_at = now_ts
    WHERE scope = p_scope
      AND actor_key = p_actor_key
    RETURNING * INTO row_rec;
  END IF;

  IF row_rec.locked_until IS NOT NULL THEN
    PERFORM public.raise_security_alert(
      'high',
      'lockout',
      p_scope || ':' || p_actor_key,
      format('Lockout triggered in %s for actor %s', p_scope, p_actor_key),
      COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'scope', p_scope,
          'actor_key', p_actor_key,
          'attempt_count', row_rec.attempt_count,
          'locked_until', row_rec.locked_until
        )
    );

    RETURN QUERY SELECT FALSE, 'locked', row_rec.attempt_count, row_rec.locked_until;
    RETURN;
  END IF;

  SELECT count(*) INTO storm_count
  FROM public.security_throttle
  WHERE scope = p_scope
    AND updated_at >= now_ts - interval '3 minutes'
    AND attempt_count >= GREATEST(3, max_attempts - 1);

  IF storm_count >= 15 THEN
    PERFORM public.raise_security_alert(
      'critical',
      'auth_storm',
      p_scope || ':storm',
      format('Suspicious %s request storm detected', p_scope),
      jsonb_build_object('scope', p_scope, 'actor_count', storm_count)
    );
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, row_rec.attempt_count, row_rec.locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.security_throttle_reset(
  p_scope TEXT,
  p_actor_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.security_throttle
  SET attempt_count = 0,
      window_started_at = now(),
      last_attempt_at = now(),
      locked_until = NULL,
      updated_at = now()
  WHERE scope = p_scope
    AND actor_key = p_actor_key;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_auth_login_attempt(
  p_identifier TEXT,
  p_client_fingerprint TEXT DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  denial_reason TEXT,
  attempt_count INTEGER,
  locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_identifier TEXT := lower(NULLIF(btrim(COALESCE(p_identifier, '')), ''));
  key_id TEXT;
BEGIN
  key_id := COALESCE(normalized_identifier, 'unknown') || '|' || COALESCE(NULLIF(btrim(COALESCE(p_client_fingerprint, '')), ''), 'anon');

  RETURN QUERY
  SELECT *
  FROM public.security_throttle_guard(
    'login',
    key_id,
    6,
    300,
    900,
    jsonb_build_object('identifier', normalized_identifier, 'fingerprint', p_client_fingerprint)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_auth_login_success(
  p_identifier TEXT,
  p_client_fingerprint TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_identifier TEXT := lower(NULLIF(btrim(COALESCE(p_identifier, '')), ''));
  key_id TEXT;
BEGIN
  key_id := COALESCE(normalized_identifier, 'unknown') || '|' || COALESCE(NULLIF(btrim(COALESCE(p_client_fingerprint, '')), ''), 'anon');
  RETURN public.security_throttle_reset('login', key_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_access_request_submission(
  p_node_id UUID,
  p_requester_id UUID,
  p_client_fingerprint TEXT DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  denial_reason TEXT,
  attempt_count INTEGER,
  locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  actor_key TEXT;
BEGIN
  IF current_uid IS NULL OR current_uid <> p_requester_id THEN
    RETURN QUERY SELECT FALSE, 'requester_mismatch', 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  actor_key := p_requester_id::TEXT || ':' || p_node_id::TEXT || '|' || COALESCE(NULLIF(btrim(COALESCE(p_client_fingerprint, '')), ''), 'anon');

  RETURN QUERY
  SELECT *
  FROM public.security_throttle_guard(
    'access_request',
    actor_key,
    8,
    600,
    1200,
    jsonb_build_object('node_id', p_node_id, 'requester_id', p_requester_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_remote_id_probe(
  p_remote_id TEXT,
  p_client_fingerprint TEXT DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  denial_reason TEXT,
  attempt_count INTEGER,
  locked_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  actor_key TEXT;
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'unauthenticated', 0, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  actor_key := current_uid::TEXT || '|' || COALESCE(NULLIF(btrim(COALESCE(p_client_fingerprint, '')), ''), 'anon');

  RETURN QUERY
  SELECT *
  FROM public.security_throttle_guard(
    'remote_id_probe',
    actor_key,
    12,
    300,
    900,
    jsonb_build_object('remote_id', p_remote_id)
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.secret_material (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  key_version TEXT NOT NULL DEFAULT 'v1',
  encrypted_value BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ
);

ALTER TABLE public.secret_material ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view secret material metadata" ON public.secret_material;
CREATE POLICY "Admins view secret material metadata" ON public.secret_material
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_secret_material(
  p_secret_name TEXT,
  p_purpose TEXT,
  p_plaintext TEXT,
  p_key_version TEXT DEFAULT 'v1'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  kek TEXT := current_setting('app.settings.secrets_kek', true);
  v_id UUID;
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF kek IS NULL OR btrim(kek) = '' THEN
    RAISE EXCEPTION 'secrets_kek_not_configured';
  END IF;

  INSERT INTO public.secret_material (secret_name, purpose, key_version, encrypted_value, rotated_at, updated_at)
  VALUES (
    p_secret_name,
    p_purpose,
    COALESCE(NULLIF(btrim(p_key_version), ''), 'v1'),
    pgp_sym_encrypt(COALESCE(p_plaintext, ''), kek),
    now(),
    now()
  )
  ON CONFLICT (secret_name)
  DO UPDATE SET
    purpose = EXCLUDED.purpose,
    key_version = EXCLUDED.key_version,
    encrypted_value = EXCLUDED.encrypted_value,
    rotated_at = now(),
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'secret_material_rotated',
    p_secret_name,
    jsonb_build_object('purpose', p_purpose, 'key_version', p_key_version)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_secret_material(
  p_secret_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  kek TEXT := current_setting('app.settings.secrets_kek', true);
  v_val TEXT;
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF kek IS NULL OR btrim(kek) = '' THEN
    RAISE EXCEPTION 'secrets_kek_not_configured';
  END IF;

  SELECT pgp_sym_decrypt(encrypted_value, kek)
    INTO v_val
  FROM public.secret_material
  WHERE secret_name = p_secret_name;

  RETURN v_val;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_privileged_event(
  p_node_id UUID,
  p_action TEXT,
  p_request_id UUID DEFAULT NULL,
  p_requester_id UUID DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL,
  p_local BOOLEAN DEFAULT FALSE,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  authorized BOOLEAN,
  denial_reason TEXT,
  event_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_result RECORD;
  current_uid UUID := auth.uid();
  inserted_id UUID;
  action_name TEXT;
  actor_is_admin BOOLEAN := public.has_role(current_uid, 'admin');
  role_allowed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO auth_result
  FROM public.authorize_privileged_access(p_node_id, p_request_id, p_requester_id, p_session_token, p_local)
  LIMIT 1;

  IF p_action = ANY(ARRAY['file_read', 'file_download']) THEN
    role_allowed := TRUE;
  ELSIF p_action = ANY(ARRAY['file_upload', 'file_create_folder', 'file_delete']) THEN
    role_allowed := actor_is_admin;
  ELSIF p_action = ANY(ARRAY['session_start', 'session_heartbeat', 'session_end', 'session_terminate', 'remote_control', 'send_ctrl_alt_del']) THEN
    role_allowed := actor_is_admin;
  END IF;

  IF NOT role_allowed THEN
    auth_result.authorized := FALSE;
    auth_result.denial_reason := COALESCE(auth_result.denial_reason, 'insufficient_role');
  END IF;

  IF coalesce(auth_result.authorized, FALSE) THEN
    action_name := p_action;
  ELSE
    action_name := p_action || '_denied';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    action_name,
    p_node_id::TEXT,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'request_id', p_request_id,
        'requester_id', p_requester_id,
        'session_token_present', p_session_token IS NOT NULL,
        'local', p_local,
        'access_mode', auth_result.access_mode,
        'denial_reason', auth_result.denial_reason
      )
  )
  RETURNING id INTO inserted_id;

  RETURN QUERY SELECT coalesce(auth_result.authorized, FALSE), auth_result.denial_reason, inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.raise_security_alert(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_throttle_guard(TEXT, TEXT, INTEGER, INTEGER, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.security_throttle_reset(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_auth_login_attempt(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_auth_login_success(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_access_request_submission(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_remote_id_probe(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_secret_material(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_secret_material(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_privileged_event(UUID, TEXT, UUID, UUID, TEXT, BOOLEAN, JSONB) TO authenticated;
