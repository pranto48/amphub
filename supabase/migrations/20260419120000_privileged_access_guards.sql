CREATE OR REPLACE FUNCTION public.is_private_lan_ip(ip_text TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed_ip INET;
BEGIN
  IF ip_text IS NULL OR btrim(ip_text) = '' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    parsed_ip := ip_text::inet;
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;

  RETURN parsed_ip << inet '10.0.0.0/8'
    OR parsed_ip << inet '172.16.0.0/12'
    OR parsed_ip << inet '192.168.0.0/16'
    OR parsed_ip << inet '169.254.0.0/16';
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

  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id
    AND node_id = p_node_id;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_approved', 'denied', NULL::UUID;
    RETURN;
  END IF;

  IF req.requester_id <> current_uid THEN
    RETURN QUERY SELECT FALSE, 'not_request_owner', 'denied', req.id;
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

  RETURN QUERY SELECT TRUE, NULL::TEXT, 'approved_request', req.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_privileged_event(
  p_node_id UUID,
  p_action TEXT,
  p_request_id UUID DEFAULT NULL,
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
BEGIN
  SELECT * INTO auth_result
  FROM public.authorize_privileged_access(p_node_id, p_request_id, p_local)
  LIMIT 1;

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
        'local', p_local,
        'access_mode', auth_result.access_mode,
        'denial_reason', auth_result.denial_reason
      )
  )
  RETURNING id INTO inserted_id;

  RETURN QUERY SELECT coalesce(auth_result.authorized, FALSE), auth_result.denial_reason, inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_privileged_access(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_privileged_event(UUID, TEXT, UUID, BOOLEAN, JSONB) TO authenticated;
