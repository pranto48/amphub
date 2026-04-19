CREATE OR REPLACE FUNCTION public.authorize_privileged_access(
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

  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
    AND node_id = p_node_id;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF req.requester_id <> p_requester_id THEN
    RETURN QUERY SELECT FALSE, 'requester_mismatch', 'denied', req.id;
    RETURN;
  END IF;

  IF req.status <> 'approved' THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', req.id;
    RETURN;
  END IF;

  IF req.expires_at IS NULL OR req.expires_at <= now() THEN
    RETURN QUERY SELECT FALSE, 'expired_token', 'denied', req.id;
    RETURN;
  END IF;

  IF req.session_token IS NOT NULL AND (p_session_token IS NULL OR req.session_token <> p_session_token) THEN
    RETURN QUERY SELECT FALSE, 'session_token_mismatch', 'denied', req.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'approved_request', req.id;
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

  IF p_action = ANY(ARRAY['file_read', 'file_download', 'file_upload']) THEN
    role_allowed := TRUE;
  ELSIF p_action = ANY(ARRAY['file_create_folder', 'file_delete']) THEN
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

GRANT EXECUTE ON FUNCTION public.authorize_privileged_access(UUID, UUID, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_privileged_event(UUID, TEXT, UUID, UUID, TEXT, BOOLEAN, JSONB) TO authenticated;
