ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS request_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS status_reason_message TEXT,
  ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMPTZ;

UPDATE public.access_requests
SET pending_expires_at = COALESCE(pending_expires_at, requested_at + interval '10 minutes')
WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.admin_decide_access_request(
  p_request_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL,
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
  ttl_minutes INTEGER := GREATEST(5, LEAST(30, COALESCE(p_ttl_minutes, 10)));
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
        pending_expires_at = NULL,
        revoked_at = NULL,
        token_single_use = COALESCE(p_single_use, TRUE),
        token_used_at = NULL,
        token_bound_node_id = req.node_id,
        token_bound_requester_id = req.requester_id,
        status_reason_code = 'approved',
        status_reason_message = COALESCE(NULLIF(trim(p_note), ''), 'Approved by administrator')
    WHERE id = req.id
    RETURNING * INTO req;
  ELSIF p_decision = 'denied' THEN
    UPDATE public.access_requests
    SET status = 'denied',
        decided_at = now(),
        decided_by = current_uid,
        session_token = NULL,
        expires_at = NULL,
        pending_expires_at = NULL,
        revoked_at = NULL,
        token_used_at = NULL,
        status_reason_code = 'denied_by_admin',
        status_reason_message = COALESCE(NULLIF(trim(p_note), ''), 'Request denied by administrator')
    WHERE id = req.id
    RETURNING * INTO req;
  ELSE
    UPDATE public.access_requests
    SET status = 'revoked',
        decided_at = now(),
        decided_by = current_uid,
        revoked_at = now(),
        session_token = NULL,
        expires_at = NULL,
        pending_expires_at = NULL,
        status_reason_code = 'revoked_by_admin',
        status_reason_message = COALESCE(NULLIF(trim(p_note), ''), 'Approval revoked by administrator')
    WHERE id = req.id
    RETURNING * INTO req;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    CASE p_decision WHEN 'approved' THEN 'approve_access' WHEN 'denied' THEN 'deny_access' ELSE 'revoke_access' END,
    req.node_id::text,
    jsonb_build_object(
      'request_id', req.id,
      'status', req.status,
      'single_use', req.token_single_use,
      'note', p_note
    )
  );

  RETURN req;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_access_requests(
  p_pending_timeout_minutes INTEGER DEFAULT 10
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_pending_timeout INTEGER := GREATEST(1, LEAST(120, COALESCE(p_pending_timeout_minutes, 10)));
BEGIN
  UPDATE public.access_requests
  SET status = 'expired',
      session_token = NULL,
      token_used_at = COALESCE(token_used_at, now()),
      status_reason_code = 'approved_token_expired',
      status_reason_message = 'Approved session token expired before use'
  WHERE status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  UPDATE public.access_requests
  SET pending_expires_at = requested_at + make_interval(mins => v_pending_timeout)
  WHERE status = 'pending'
    AND pending_expires_at IS NULL;

  UPDATE public.access_requests
  SET status = 'expired',
      session_token = NULL,
      expires_at = NULL,
      pending_expires_at = NULL,
      status_reason_code = 'pending_timeout',
      status_reason_message = 'Request expired while waiting for admin decision'
  WHERE status = 'pending'
    AND pending_expires_at IS NOT NULL
    AND pending_expires_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_decide_access_request(UUID, TEXT, TEXT, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_access_requests(INTEGER) TO authenticated;
