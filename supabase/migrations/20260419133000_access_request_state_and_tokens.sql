-- Explicit request states + token lifecycle metadata
ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS token_single_use BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS token_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_bound_node_id UUID,
  ADD COLUMN IF NOT EXISTS token_bound_requester_id UUID;

UPDATE public.access_requests
SET token_bound_node_id = node_id,
    token_bound_requester_id = requester_id
WHERE token_bound_node_id IS NULL
   OR token_bound_requester_id IS NULL;

ALTER TABLE public.access_requests
  ALTER COLUMN token_bound_node_id SET NOT NULL,
  ALTER COLUMN token_bound_requester_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'access_requests_status_valid'
      AND conrelid = 'public.access_requests'::regclass
  ) THEN
    ALTER TABLE public.access_requests
      ADD CONSTRAINT access_requests_status_valid
      CHECK (status IN ('pending', 'approved', 'denied', 'revoked', 'expired'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_access_requests_status_expires
  ON public.access_requests(status, expires_at);

CREATE OR REPLACE FUNCTION public.generate_short_lived_session_token()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT translate(trim(trailing '=' FROM encode(gen_random_bytes(18), 'base64')), '+/', '-_');
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

CREATE OR REPLACE FUNCTION public.expire_access_requests()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.access_requests
  SET status = 'expired',
      session_token = NULL,
      token_used_at = COALESCE(token_used_at, now())
  WHERE status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_privileged_access(
  p_node_id UUID,
  p_request_id UUID DEFAULT NULL,
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
  req public.access_requests%ROWTYPE;
  node_ip TEXT;
BEGIN
  IF current_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
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

  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  PERFORM public.expire_access_requests();

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
    AND node_id = p_node_id
  FOR UPDATE;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF req.requester_id <> current_uid OR req.token_bound_requester_id <> current_uid THEN
    RETURN QUERY SELECT FALSE, 'not_request_owner', 'denied', req.id;
    RETURN;
  END IF;

  IF req.token_bound_node_id <> p_node_id THEN
    RETURN QUERY SELECT FALSE, 'token_binding_mismatch', 'denied', req.id;
    RETURN;
  END IF;

  IF req.status = 'revoked' THEN
    RETURN QUERY SELECT FALSE, 'revoked_token', 'denied', req.id;
    RETURN;
  END IF;

  IF req.status <> 'approved' THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', req.id;
    RETURN;
  END IF;

  IF req.expires_at IS NULL OR req.expires_at <= now() THEN
    UPDATE public.access_requests
    SET status = 'expired',
        session_token = NULL,
        token_used_at = COALESCE(token_used_at, now())
    WHERE id = req.id;

    RETURN QUERY SELECT FALSE, 'expired_token', 'denied', req.id;
    RETURN;
  END IF;

  IF req.token_single_use AND req.token_used_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'token_already_used', 'denied', req.id;
    RETURN;
  END IF;

  IF req.token_single_use THEN
    UPDATE public.access_requests
    SET token_used_at = now()
    WHERE id = req.id;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'approved_request', req.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_short_lived_session_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_access_request(UUID, TEXT, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_access_requests() TO authenticated;
