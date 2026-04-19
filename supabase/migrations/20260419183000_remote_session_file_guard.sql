-- Reusable guard for all remote session/file operations.
-- Security boundary is enforced server-side via RPC and not by client-side UX checks.

CREATE OR REPLACE FUNCTION public.guard_session_file_access(
  p_node_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_requester_id UUID DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL,
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
    RETURN QUERY SELECT FALSE, 'unauthenticated', 'denied', NULL::UUID;
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
      RETURN QUERY SELECT FALSE, 'untrusted_lan_mode', 'denied', NULL::UUID;
      RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, NULL::TEXT, 'trusted_lan', NULL::UUID;
    RETURN;
  END IF;

  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'missing_request_id', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF p_session_token IS NULL OR btrim(p_session_token) = '' THEN
    RETURN QUERY SELECT FALSE, 'missing_request_token', 'denied', p_request_id;
    RETURN;
  END IF;

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
    AND node_id = p_node_id
  FOR UPDATE;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_found', 'denied', p_request_id;
    RETURN;
  END IF;

  IF req.requester_id <> current_uid
    OR req.requester_id <> p_requester_id
    OR req.token_bound_requester_id <> p_requester_id
    OR req.token_bound_node_id <> p_node_id THEN
    RETURN QUERY SELECT FALSE, 'requester_node_mismatch', 'denied', req.id;
    RETURN;
  END IF;

  IF req.status = 'revoked' OR req.revoked_at IS NOT NULL THEN
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
        token_used_at = COALESCE(token_used_at, now()),
        status_reason_code = COALESCE(status_reason_code, 'approved_token_expired'),
        status_reason_message = COALESCE(status_reason_message, 'Approved session token expired before use')
    WHERE id = req.id;

    RETURN QUERY SELECT FALSE, 'expired_token', 'denied', req.id;
    RETURN;
  END IF;

  IF req.session_token IS NULL OR req.session_token <> p_session_token THEN
    RETURN QUERY SELECT FALSE, 'invalid_request_token', 'denied', req.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'approved_request', req.id;
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
BEGIN
  -- Scope is currently enforced by action-level policy in record_privileged_event;
  -- this reusable guard enforces requester binding + LAN trust + token validity.
  RETURN QUERY
  SELECT g.authorized, g.denial_reason, g.access_mode, g.matched_request_id
  FROM public.guard_session_file_access(
    p_node_id,
    p_request_id,
    p_requester_id,
    p_session_token,
    p_local
  ) AS g;
END;
$$;

-- Integration checks for direct API guard behavior.
DO $$
DECLARE
  result_row RECORD;
  actor UUID := '11111111-1111-4111-8111-111111111111';
  other_actor UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT * INTO result_row
  FROM public.record_privileged_event(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID,
    'session_start',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID,
    NULL,
    NULL,
    FALSE,
    '{}'::JSONB
  )
  LIMIT 1;

  IF COALESCE(result_row.authorized, FALSE) OR result_row.denial_reason <> 'unauthenticated' THEN
    RAISE EXCEPTION 'integration_check_failed: unauthenticated direct API call should be denied';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', actor::TEXT, true);

  SELECT * INTO result_row
  FROM public.record_privileged_event(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID,
    'file_download',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID,
    actor,
    NULL,
    FALSE,
    '{}'::JSONB
  )
  LIMIT 1;

  IF COALESCE(result_row.authorized, FALSE) OR result_row.denial_reason <> 'missing_request_token' THEN
    RAISE EXCEPTION 'integration_check_failed: missing token direct API call should be denied';
  END IF;

  SELECT * INTO result_row
  FROM public.record_privileged_event(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::UUID,
    'file_download',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::UUID,
    other_actor,
    'bogus-token',
    FALSE,
    '{}'::JSONB
  )
  LIMIT 1;

  IF COALESCE(result_row.authorized, FALSE) OR result_row.denial_reason <> 'requester_mismatch' THEN
    RAISE EXCEPTION 'integration_check_failed: requester mismatch direct API call should be denied';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.guard_session_file_access(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_privileged_access(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
