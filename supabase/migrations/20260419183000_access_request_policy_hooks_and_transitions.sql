ALTER TABLE public.admin_access_policies
  ADD COLUMN IF NOT EXISTS role_node_restrictions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.is_access_request_transition_allowed(
  p_from_status TEXT,
  p_to_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_from_status = p_to_status THEN TRUE
    WHEN p_from_status = 'pending' AND p_to_status = ANY(ARRAY['approved', 'denied', 'expired']) THEN TRUE
    WHEN p_from_status = 'approved' AND p_to_status = ANY(ARRAY['revoked', 'expired']) THEN TRUE
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_access_request_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.is_access_request_transition_allowed(OLD.status, NEW.status)
  THEN
    RAISE EXCEPTION 'invalid_access_request_transition:%->%', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_requests_enforce_status_transition ON public.access_requests;
CREATE TRIGGER access_requests_enforce_status_transition
BEFORE UPDATE OF status ON public.access_requests
FOR EACH ROW
EXECUTE FUNCTION public.enforce_access_request_status_transition();

CREATE OR REPLACE FUNCTION public.evaluate_access_request_policy(
  p_request_id UUID,
  p_requested_ttl_minutes INTEGER DEFAULT 10
)
RETURNS TABLE (
  allowed BOOLEAN,
  denial_code TEXT,
  denial_message TEXT,
  effective_ttl_minutes INTEGER,
  context JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.access_requests%ROWTYPE;
  policy_row public.admin_access_policies%ROWTYPE;
  requester_role TEXT := 'user';
  requested_ttl INTEGER := GREATEST(5, LEAST(120, COALESCE(p_requested_ttl_minutes, 10)));
  role_ttl_limit INTEGER;
  now_clock TIME := (now() AT TIME ZONE 'UTC')::TIME;
  time_allowed BOOLEAN := TRUE;
  role_blocked_nodes JSONB := '[]'::jsonb;
  role_node_blocked BOOLEAN := FALSE;
  decision_context JSONB;
BEGIN
  SELECT * INTO req
  FROM public.access_requests
  WHERE id = p_request_id;

  IF req.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'request_not_found', 'Request does not exist', 0, jsonb_build_object('request_id', p_request_id);
    RETURN;
  END IF;

  SELECT COALESCE(ur.role, 'user') INTO requester_role
  FROM public.user_roles ur
  WHERE ur.user_id = req.requester_id
  LIMIT 1;

  SELECT * INTO policy_row
  FROM public.admin_access_policies
  ORDER BY updated_at DESC
  LIMIT 1;

  IF policy_row.id IS NULL THEN
    role_ttl_limit := requested_ttl;
    decision_context := jsonb_build_object(
      'policy_found', FALSE,
      'requester_role', requester_role,
      'requested_ttl_minutes', requested_ttl,
      'effective_ttl_minutes', requested_ttl,
      'node_id', req.node_id
    );
    RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT, requested_ttl, decision_context;
    RETURN;
  END IF;

  role_ttl_limit := GREATEST(
    5,
    LEAST(
      240,
      COALESCE((policy_row.max_session_duration_by_role ->> requester_role)::INTEGER, (policy_row.max_session_duration_by_role ->> 'user')::INTEGER, requested_ttl)
    )
  );

  IF policy_row.auto_deny_outside_business_hours THEN
    IF policy_row.business_hours_start <= policy_row.business_hours_end THEN
      time_allowed := now_clock BETWEEN policy_row.business_hours_start::TIME AND policy_row.business_hours_end::TIME;
    ELSE
      time_allowed := now_clock >= policy_row.business_hours_start::TIME OR now_clock <= policy_row.business_hours_end::TIME;
    END IF;
  END IF;

  IF policy_row.role_node_restrictions ? requester_role THEN
    role_blocked_nodes := COALESCE(policy_row.role_node_restrictions -> requester_role, '[]'::jsonb);
    role_node_blocked := role_blocked_nodes @> to_jsonb(ARRAY[req.node_id]::TEXT[]);
  END IF;

  decision_context := jsonb_build_object(
    'policy_found', TRUE,
    'policy_id', policy_row.id,
    'requester_role', requester_role,
    'node_id', req.node_id,
    'requested_ttl_minutes', requested_ttl,
    'role_ttl_limit_minutes', role_ttl_limit,
    'effective_ttl_minutes', LEAST(requested_ttl, role_ttl_limit),
    'auto_deny_outside_business_hours', policy_row.auto_deny_outside_business_hours,
    'business_hours_start', policy_row.business_hours_start,
    'business_hours_end', policy_row.business_hours_end,
    'time_window_allowed', time_allowed,
    'role_node_restrictions', policy_row.role_node_restrictions,
    'role_node_blocked', role_node_blocked
  );

  IF NOT time_allowed THEN
    RETURN QUERY SELECT FALSE, 'outside_business_hours', 'Request cannot be approved outside policy time window', LEAST(requested_ttl, role_ttl_limit), decision_context;
    RETURN;
  END IF;

  IF role_node_blocked THEN
    RETURN QUERY SELECT FALSE, 'role_node_restricted', 'Role is restricted from this node by policy', LEAST(requested_ttl, role_ttl_limit), decision_context;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, NULL::TEXT, LEAST(requested_ttl, role_ttl_limit), decision_context;
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
  effective_ttl INTEGER := GREATEST(5, LEAST(120, COALESCE(p_ttl_minutes, 10)));
  policy_eval RECORD;
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

  IF req.status IN ('denied', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'request_not_actionable';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT * INTO policy_eval
    FROM public.evaluate_access_request_policy(req.id, effective_ttl)
    LIMIT 1;

    effective_ttl := COALESCE(policy_eval.effective_ttl_minutes, effective_ttl);

    IF COALESCE(policy_eval.allowed, FALSE) = FALSE THEN
      UPDATE public.access_requests
      SET status = 'denied',
          decided_at = now(),
          decided_by = current_uid,
          session_token = NULL,
          expires_at = NULL,
          pending_expires_at = NULL,
          revoked_at = NULL,
          token_used_at = NULL,
          status_reason_code = COALESCE(policy_eval.denial_code, 'policy_denied'),
          status_reason_message = COALESCE(policy_eval.denial_message, 'Denied by policy hook')
      WHERE id = req.id
      RETURNING * INTO req;

      INSERT INTO public.audit_log (actor_id, action, target, event_type, metadata)
      VALUES (
        current_uid,
        'deny_access',
        req.node_id::text,
        'approval',
        jsonb_build_object(
          'request_id', req.id,
          'status', req.status,
          'decision_source', 'policy_hook',
          'policy_context', policy_eval.context
        )
      );

      RETURN req;
    END IF;

    UPDATE public.access_requests
    SET status = 'approved',
        decided_at = now(),
        decided_by = current_uid,
        session_token = public.generate_short_lived_session_token(),
        expires_at = now() + make_interval(mins => effective_ttl),
        pending_expires_at = NULL,
        revoked_at = NULL,
        token_single_use = COALESCE(p_single_use, TRUE),
        token_used_at = NULL,
        token_bound_node_id = req.node_id,
        token_bound_requester_id = req.requester_id,
        status_reason_code = 'approved',
        status_reason_message = 'Approved by administrator'
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
        status_reason_message = 'Request denied by administrator'
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
        status_reason_message = 'Approval revoked by administrator'
    WHERE id = req.id
    RETURNING * INTO req;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, event_type, metadata)
  VALUES (
    current_uid,
    CASE p_decision WHEN 'approved' THEN 'approve_access' WHEN 'denied' THEN 'deny_access' ELSE 'revoke_access' END,
    req.node_id::text,
    'approval',
    jsonb_build_object(
      'request_id', req.id,
      'status', req.status,
      'single_use', req.token_single_use,
      'policy_context', CASE WHEN p_decision = 'approved' THEN policy_eval.context ELSE NULL::jsonb END
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
  v_count INTEGER := 0;
  v_pending_timeout INTEGER := GREATEST(1, LEAST(120, COALESCE(p_pending_timeout_minutes, 10)));
BEGIN
  WITH expired_approved AS (
    UPDATE public.access_requests
    SET status = 'expired',
        session_token = NULL,
        token_used_at = COALESCE(token_used_at, now()),
        status_reason_code = 'approved_token_expired',
        status_reason_message = 'Approved session token expired before use'
    WHERE status = 'approved'
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    RETURNING id, node_id
  )
  INSERT INTO public.audit_log (action, target, event_type, metadata)
  SELECT 'expire_access', node_id::text, 'approval', jsonb_build_object('request_id', id, 'reason', 'approved_token_expired')
  FROM expired_approved;

  UPDATE public.access_requests
  SET pending_expires_at = requested_at + make_interval(mins => v_pending_timeout)
  WHERE status = 'pending'
    AND pending_expires_at IS NULL;

  WITH expired_pending AS (
    UPDATE public.access_requests
    SET status = 'expired',
        session_token = NULL,
        expires_at = NULL,
        pending_expires_at = NULL,
        status_reason_code = 'pending_timeout',
        status_reason_message = 'Request expired while waiting for admin decision'
    WHERE status = 'pending'
      AND pending_expires_at IS NOT NULL
      AND pending_expires_at <= now()
    RETURNING id, node_id, requester_id, status_reason_code, status_reason_message
  ), logged AS (
    INSERT INTO public.audit_log (action, target, event_type, metadata)
    SELECT
      'expire_access',
      node_id::text,
      'approval',
      jsonb_build_object(
        'request_id', id,
        'requester_id', requester_id,
        'reason', status_reason_code,
        'reason_message', status_reason_message,
        'ui_notify', TRUE
      )
    FROM expired_pending
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM expired_pending;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_access_request_policy(UUID, INTEGER) TO authenticated;
