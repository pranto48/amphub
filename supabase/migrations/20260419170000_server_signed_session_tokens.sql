-- Server-signed session tokens with scope claims, per-request nonce binding,
-- validation on privileged paths, rotation/single-use semantics, and audit trails.

CREATE OR REPLACE FUNCTION public.base64url_encode(input BYTEA)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT rtrim(replace(replace(encode(input, 'base64'), '+', '-'), '/', '_'), '=');
$$;

CREATE OR REPLACE FUNCTION public.base64url_decode(input TEXT)
RETURNS BYTEA
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT decode(
    replace(replace(input || repeat('=', (4 - length(input) % 4) % 4), '-', '+'), '_', '/'),
    'base64'
  );
$$;

CREATE OR REPLACE FUNCTION public.session_token_signing_key()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := nullif(current_setting('app.settings.session_token_signing_key', TRUE), '');
  IF v_key IS NULL THEN
    v_key := nullif(current_setting('app.settings.jwt_secret', TRUE), '');
  END IF;

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'session_token_signing_key_not_configured';
  END IF;

  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_signed_session_token(
  p_request_id UUID,
  p_scope TEXT[] DEFAULT ARRAY['view', 'control', 'files']
)
RETURNS TABLE (
  token TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  req public.access_requests%ROWTYPE;
  now_epoch BIGINT := extract(epoch FROM now())::BIGINT;
  exp_epoch BIGINT;
  claims JSONB;
  payload TEXT;
  signature TEXT;
  normalized_scope TEXT[];
BEGIN
  IF current_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req.requester_id <> current_uid OR req.token_bound_requester_id <> current_uid THEN
    RAISE EXCEPTION 'requester_mismatch';
  END IF;

  IF req.status <> 'approved' OR req.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'request_not_approved';
  END IF;

  IF req.expires_at IS NULL OR req.expires_at <= now() THEN
    UPDATE public.access_requests
    SET status = 'expired',
        session_token = NULL,
        token_used_at = COALESCE(token_used_at, now())
    WHERE id = req.id;

    RAISE EXCEPTION 'expired_token';
  END IF;

  normalized_scope := (
    SELECT array_agg(DISTINCT s)
    FROM unnest(COALESCE(p_scope, ARRAY['view', 'control', 'files'])) AS s
    WHERE s IN ('view', 'control', 'files')
  );

  IF normalized_scope IS NULL OR array_length(normalized_scope, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF req.session_token IS NULL THEN
    UPDATE public.access_requests
    SET session_token = public.generate_short_lived_session_token()
    WHERE id = req.id
    RETURNING * INTO req;
  END IF;

  exp_epoch := extract(epoch FROM req.expires_at)::BIGINT;

  claims := jsonb_build_object(
    'request_id', req.id,
    'requester_id', req.requester_id,
    'node_id', req.node_id,
    'iat', now_epoch,
    'exp', exp_epoch,
    'scope', to_jsonb(normalized_scope),
    'nonce', req.session_token
  );

  payload := public.base64url_encode(convert_to(claims::TEXT, 'UTF8'));
  signature := public.base64url_encode(hmac(payload, public.session_token_signing_key(), 'sha256'));

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'token_issue',
    req.node_id::TEXT,
    jsonb_build_object(
      'request_id', req.id,
      'requester_id', req.requester_id,
      'scope', normalized_scope,
      'expires_at', req.expires_at
    )
  );

  RETURN QUERY SELECT payload || '.' || signature, req.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_signed_session_token(
  p_signed_token TEXT,
  p_required_scope TEXT,
  p_rotate_if_reusable BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  authorized BOOLEAN,
  denial_reason TEXT,
  request_id UUID,
  requester_id UUID,
  node_id UUID,
  next_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  token_parts TEXT[];
  payload TEXT;
  sig TEXT;
  expected_sig TEXT;
  claims JSONB;
  req public.access_requests%ROWTYPE;
  scope_ok BOOLEAN;
  now_epoch BIGINT := extract(epoch FROM now())::BIGINT;
  refreshed_nonce TEXT;
  refreshed_claims JSONB;
  refreshed_payload TEXT;
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'not_authorized', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF p_required_scope NOT IN ('view', 'control', 'files') THEN
    RETURN QUERY SELECT FALSE, 'invalid_scope', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  token_parts := regexp_split_to_array(COALESCE(p_signed_token, ''), '\\.');
  IF array_length(token_parts, 1) <> 2 THEN
    RETURN QUERY SELECT FALSE, 'malformed_token', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  payload := token_parts[1];
  sig := token_parts[2];
  expected_sig := public.base64url_encode(hmac(payload, public.session_token_signing_key(), 'sha256'));

  IF sig <> expected_sig THEN
    RETURN QUERY SELECT FALSE, 'invalid_signature', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  claims := convert_from(public.base64url_decode(payload), 'UTF8')::jsonb;

  IF claims->>'request_id' IS NULL OR claims->>'requester_id' IS NULL OR claims->>'node_id' IS NULL THEN
    RETURN QUERY SELECT FALSE, 'missing_claims', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF COALESCE((claims->>'exp')::BIGINT, 0) <= now_epoch THEN
    RETURN QUERY SELECT FALSE, 'expired_token', (claims->>'request_id')::UUID, (claims->>'requester_id')::UUID, (claims->>'node_id')::UUID, NULL::TEXT;
    RETURN;
  END IF;

  scope_ok := EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(claims->'scope', '[]'::jsonb)) AS s(val)
    WHERE s.val = p_required_scope
  );
  IF NOT scope_ok THEN
    RETURN QUERY SELECT FALSE, 'insufficient_scope', (claims->>'request_id')::UUID, (claims->>'requester_id')::UUID, (claims->>'node_id')::UUID, NULL::TEXT;
    RETURN;
  END IF;

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = (claims->>'request_id')::UUID
  FOR UPDATE;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_found', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF req.requester_id <> current_uid OR req.token_bound_requester_id <> current_uid THEN
    RETURN QUERY SELECT FALSE, 'requester_mismatch', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.node_id <> (claims->>'node_id')::UUID OR req.token_bound_node_id <> req.node_id THEN
    RETURN QUERY SELECT FALSE, 'token_binding_mismatch', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.status = 'revoked' OR req.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'revoked_token', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.status <> 'approved' THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.expires_at IS NULL OR req.expires_at <= now() THEN
    UPDATE public.access_requests
    SET status = 'expired',
        session_token = NULL,
        token_used_at = COALESCE(token_used_at, now())
    WHERE id = req.id;

    RETURN QUERY SELECT FALSE, 'expired_token', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.session_token IS NULL OR req.session_token <> COALESCE(claims->>'nonce', '') THEN
    RETURN QUERY SELECT FALSE, 'session_token_mismatch', req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  IF req.token_single_use THEN
    IF req.token_used_at IS NOT NULL THEN
      RETURN QUERY SELECT FALSE, 'token_already_used', req.id, req.requester_id, req.node_id, NULL::TEXT;
      RETURN;
    END IF;

    UPDATE public.access_requests
    SET token_used_at = now(),
        session_token = NULL
    WHERE id = req.id;

    INSERT INTO public.audit_log (actor_id, action, target, metadata)
    VALUES (
      current_uid,
      'token_use',
      req.node_id::TEXT,
      jsonb_build_object('request_id', req.id, 'scope', p_required_scope, 'single_use', TRUE)
    );

    RETURN QUERY SELECT TRUE, NULL::TEXT, req.id, req.requester_id, req.node_id, NULL::TEXT;
    RETURN;
  END IF;

  UPDATE public.access_requests
  SET token_used_at = now(),
      session_token = CASE WHEN p_rotate_if_reusable THEN public.generate_short_lived_session_token() ELSE session_token END
  WHERE id = req.id
  RETURNING session_token INTO refreshed_nonce;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'token_use',
    req.node_id::TEXT,
    jsonb_build_object('request_id', req.id, 'scope', p_required_scope, 'single_use', FALSE, 'rotated', p_rotate_if_reusable)
  );

  IF p_rotate_if_reusable THEN
    refreshed_claims := jsonb_build_object(
      'request_id', req.id,
      'requester_id', req.requester_id,
      'node_id', req.node_id,
      'iat', now_epoch,
      'exp', extract(epoch FROM req.expires_at)::BIGINT,
      'scope', claims->'scope',
      'nonce', refreshed_nonce
    );

    refreshed_payload := public.base64url_encode(convert_to(refreshed_claims::TEXT, 'UTF8'));
    next_token := refreshed_payload || '.' || public.base64url_encode(hmac(refreshed_payload, public.session_token_signing_key(), 'sha256'));
  ELSE
    next_token := p_signed_token;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, req.id, req.requester_id, req.node_id, next_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_privileged_access(
  p_node_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_requester_id UUID DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL,
  p_required_scope TEXT DEFAULT 'view',
  p_local BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  authorized BOOLEAN,
  denial_reason TEXT,
  access_mode TEXT,
  matched_request_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  token_result RECORD;
  node_ip TEXT;
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF p_requester_id IS NULL OR p_requester_id <> current_uid THEN
    RETURN QUERY SELECT FALSE, 'requester_mismatch', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF p_local THEN
    SELECT local_ip INTO node_ip
    FROM public.desktop_nodes
    WHERE id = p_node_id;

    IF node_ip IS NULL OR NOT public.is_private_lan_ip(node_ip) THEN
      RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
      RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, NULL::TEXT, 'local_lan', NULL::UUID;
    RETURN;
  END IF;

  IF p_request_id IS NULL OR p_session_token IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO token_result
  FROM public.validate_signed_session_token(p_session_token, p_required_scope, TRUE)
  LIMIT 1;

  IF NOT COALESCE(token_result.authorized, FALSE) THEN
    RETURN QUERY SELECT FALSE, token_result.denial_reason, 'denied', p_request_id;
    RETURN;
  END IF;

  IF token_result.request_id <> p_request_id OR token_result.node_id <> p_node_id THEN
    RETURN QUERY SELECT FALSE, 'token_binding_mismatch', 'denied', p_request_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'approved_request', p_request_id;
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
  required_scope TEXT := 'view';
BEGIN
  IF p_action LIKE 'session_%' THEN
    required_scope := 'control';
  ELSIF p_action LIKE 'file_%' THEN
    required_scope := 'files';
  END IF;

  SELECT * INTO auth_result
  FROM public.authorize_privileged_access(
    p_node_id,
    p_request_id,
    p_requester_id,
    p_session_token,
    required_scope,
    p_local
  )
  LIMIT 1;

  IF p_action = ANY(ARRAY['file_read', 'file_download', 'file_upload']) THEN
    role_allowed := TRUE;
  ELSIF p_action = ANY(ARRAY['file_create_folder', 'file_delete']) THEN
    role_allowed := actor_is_admin;
  ELSE
    role_allowed := TRUE;
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
        'required_scope', required_scope,
        'local', p_local,
        'access_mode', auth_result.access_mode,
        'denial_reason', auth_result.denial_reason
      )
  )
  RETURNING id INTO inserted_id;

  RETURN QUERY SELECT coalesce(auth_result.authorized, FALSE), auth_result.denial_reason, inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_decide_access_request(
  p_request_id UUID,
  p_decision TEXT,
  p_single_use BOOLEAN DEFAULT TRUE,
  p_ttl_minutes INTEGER DEFAULT 10
)
RETURNS public.access_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  req public.access_requests%ROWTYPE;
  ttl_minutes INTEGER := GREATEST(5, LEAST(15, COALESCE(p_ttl_minutes, 10)));
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_decision NOT IN ('approved', 'denied', 'revoked') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF req.status IN ('denied', 'expired') THEN
    RAISE EXCEPTION 'request_not_actionable';
  END IF;

  IF p_decision = 'approved' THEN
    UPDATE public.access_requests
    SET status = 'approved',
        decided_at = now(),
        decided_by = current_uid,
        session_token = public.generate_short_lived_session_token(),
        expires_at = now() + make_interval(mins => ttl_minutes),
        revoked_at = NULL,
        token_single_use = COALESCE(p_single_use, TRUE),
        token_used_at = NULL,
        token_bound_node_id = req.node_id,
        token_bound_requester_id = req.requester_id
    WHERE id = req.id
    RETURNING * INTO req;
  ELSIF p_decision = 'denied' THEN
    UPDATE public.access_requests
    SET status = 'denied',
        decided_at = now(),
        decided_by = current_uid,
        session_token = NULL,
        expires_at = NULL,
        revoked_at = NULL,
        token_used_at = NULL
    WHERE id = req.id
    RETURNING * INTO req;
  ELSE
    UPDATE public.access_requests
    SET status = 'revoked',
        decided_at = now(),
        decided_by = current_uid,
        revoked_at = now(),
        session_token = NULL,
        expires_at = NULL
    WHERE id = req.id
    RETURNING * INTO req;

    INSERT INTO public.audit_log (actor_id, action, target, metadata)
    VALUES (
      current_uid,
      'token_revoke',
      req.node_id::TEXT,
      jsonb_build_object('request_id', req.id, 'reason', 'admin_decision_revoke')
    );
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    CASE p_decision WHEN 'approved' THEN 'approve_access' WHEN 'denied' THEN 'deny_access' ELSE 'revoke_access' END,
    req.node_id::text,
    jsonb_build_object('request_id', req.id, 'status', req.status, 'single_use', req.token_single_use)
  );

  RETURN req;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_session_token(
  p_request_id UUID,
  p_reason TEXT DEFAULT 'admin_panel_revoke'
)
RETURNS public.access_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  req public.access_requests%ROWTYPE;
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.access_requests
  SET status = CASE WHEN status = 'approved' THEN 'revoked' ELSE status END,
      revoked_at = COALESCE(revoked_at, now()),
      session_token = NULL,
      expires_at = NULL,
      decided_at = COALESCE(decided_at, now()),
      decided_by = COALESCE(decided_by, current_uid)
  WHERE id = p_request_id
  RETURNING * INTO req;

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'token_revoke',
    req.node_id::TEXT,
    jsonb_build_object('request_id', req.id, 'reason', COALESCE(NULLIF(btrim(p_reason), ''), 'admin_panel_revoke'))
  );

  RETURN req;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_signed_session_token(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_signed_session_token(TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_privileged_access(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_privileged_event(UUID, TEXT, UUID, UUID, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_session_token(UUID, TEXT) TO authenticated;
