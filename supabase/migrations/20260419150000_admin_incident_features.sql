ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS requester_identity TEXT,
  ADD COLUMN IF NOT EXISTS node_name TEXT,
  ADD COLUMN IF NOT EXISTS location_hint TEXT;

CREATE OR REPLACE FUNCTION public.hydrate_access_request_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.requester_identity IS NULL THEN
    SELECT COALESCE(p.display_name, p.email, NEW.requester_id::text)
      INTO NEW.requester_identity
    FROM public.profiles p
    WHERE p.id = NEW.requester_id;
  END IF;

  IF NEW.node_name IS NULL THEN
    SELECT n.name
      INTO NEW.node_name
    FROM public.desktop_nodes n
    WHERE n.id = NEW.node_id;
  END IF;

  NEW.location_hint := NULLIF(btrim(COALESCE(NEW.location_hint, '')), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_requests_hydrate_context ON public.access_requests;
CREATE TRIGGER access_requests_hydrate_context
BEFORE INSERT OR UPDATE ON public.access_requests
FOR EACH ROW EXECUTE FUNCTION public.hydrate_access_request_context();

UPDATE public.access_requests ar
SET requester_identity = COALESCE(p.display_name, p.email, ar.requester_id::text),
    node_name = n.name
FROM public.profiles p, public.desktop_nodes n
WHERE p.id = ar.requester_id
  AND n.id = ar.node_id
  AND (ar.requester_identity IS NULL OR ar.node_name IS NULL);

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS event_type TEXT;

CREATE OR REPLACE FUNCTION public.classify_audit_action(p_action TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_action IS NULL THEN RETURN 'other'; END IF;

  IF p_action LIKE 'auth_%' OR p_action LIKE 'login%' OR p_action LIKE 'logout%' OR p_action LIKE 'signup%' THEN
    RETURN 'auth';
  ELSIF p_action LIKE '%access%' OR p_action LIKE 'approve_%' OR p_action LIKE 'deny_%' OR p_action LIKE 'revoke_%' THEN
    RETURN 'approval';
  ELSIF p_action LIKE 'file_%' OR p_action LIKE '%upload%' OR p_action LIKE '%download%' OR p_action LIKE '%delete%' THEN
    RETURN 'file_ops';
  ELSIF p_action LIKE 'session_%' OR p_action LIKE '%remote%' OR p_action LIKE '%ctrl_alt_del%' OR p_action LIKE '%terminate%' THEN
    RETURN 'remote_control';
  END IF;

  RETURN 'other';
END;
$$;

UPDATE public.audit_log
SET event_type = public.classify_audit_action(action)
WHERE event_type IS NULL;

ALTER TABLE public.audit_log
  ALTER COLUMN event_type SET DEFAULT 'other';

CREATE OR REPLACE FUNCTION public.set_audit_event_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.event_type := public.classify_audit_action(NEW.action);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_set_event_type ON public.audit_log;
CREATE TRIGGER audit_log_set_event_type
BEFORE INSERT OR UPDATE OF action ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.set_audit_event_type();

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type_created_at ON public.audit_log(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.active_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.access_requests(id) ON DELETE SET NULL,
  node_id UUID NOT NULL REFERENCES public.desktop_nodes(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  terminated_at TIMESTAMPTZ,
  terminated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  termination_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view active sessions" ON public.active_sessions;
CREATE POLICY "Admins view active sessions" ON public.active_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update active sessions" ON public.active_sessions;
CREATE POLICY "Admins update active sessions" ON public.active_sessions
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_active_sessions_live ON public.active_sessions(ended_at, terminated_at, started_at DESC);

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
  merged_metadata JSONB;
BEGIN
  SELECT * INTO auth_result
  FROM public.authorize_privileged_access(p_node_id, p_request_id, p_local)
  LIMIT 1;

  IF coalesce(auth_result.authorized, FALSE) THEN
    action_name := p_action;
  ELSE
    action_name := p_action || '_denied';
  END IF;

  merged_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'request_id', p_request_id,
      'local', p_local,
      'access_mode', auth_result.access_mode,
      'denial_reason', auth_result.denial_reason
    );

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    action_name,
    p_node_id::TEXT,
    merged_metadata
  )
  RETURNING id INTO inserted_id;

  IF coalesce(auth_result.authorized, FALSE) AND p_action = 'session_start' THEN
    INSERT INTO public.active_sessions (request_id, node_id, requester_id, metadata)
    VALUES (p_request_id, p_node_id, current_uid, merged_metadata);
  ELSIF p_action = 'session_heartbeat' THEN
    UPDATE public.active_sessions
    SET last_seen_at = now()
    WHERE node_id = p_node_id
      AND requester_id = current_uid
      AND ended_at IS NULL
      AND terminated_at IS NULL;
  ELSIF p_action = 'session_end' THEN
    UPDATE public.active_sessions
    SET ended_at = now(),
        last_seen_at = now(),
        metadata = metadata || jsonb_build_object('end_source', coalesce(p_metadata->>'source', 'session_end'))
    WHERE node_id = p_node_id
      AND requester_id = current_uid
      AND ended_at IS NULL
      AND terminated_at IS NULL;
  END IF;

  RETURN QUERY SELECT coalesce(auth_result.authorized, FALSE), auth_result.denial_reason, inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_terminate_session(
  p_session_id UUID,
  p_reason TEXT DEFAULT 'admin_terminate'
)
RETURNS public.active_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  session_row public.active_sessions%ROWTYPE;
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO session_row
  FROM public.active_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF session_row.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  UPDATE public.active_sessions
  SET terminated_at = now(),
      terminated_by = current_uid,
      termination_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'admin_terminate'),
      last_seen_at = now()
  WHERE id = p_session_id
  RETURNING * INTO session_row;

  IF session_row.request_id IS NOT NULL THEN
    UPDATE public.access_requests
    SET status = CASE WHEN status = 'approved' THEN 'revoked' ELSE status END,
        revoked_at = COALESCE(revoked_at, now()),
        session_token = NULL,
        expires_at = NULL,
        decided_at = COALESCE(decided_at, now()),
        decided_by = COALESCE(decided_by, current_uid)
    WHERE id = session_row.request_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'session_terminate',
    session_row.node_id::text,
    jsonb_build_object(
      'session_id', session_row.id,
      'request_id', session_row.request_id,
      'reason', session_row.termination_reason
    )
  );

  RETURN session_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.export_incident_review(
  p_format TEXT DEFAULT 'json',
  p_event_type TEXT DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  result_text TEXT;
BEGIN
  IF current_uid IS NULL OR NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF lower(p_format) = 'csv' THEN
    WITH rows AS (
      SELECT created_at, event_type, action, target, actor_id::text AS actor_id, metadata::text AS metadata
      FROM public.audit_log
      WHERE (p_event_type IS NULL OR event_type = p_event_type)
        AND (p_from IS NULL OR created_at >= p_from)
        AND (p_to IS NULL OR created_at <= p_to)
      ORDER BY created_at DESC
    )
    SELECT 'created_at,event_type,action,target,actor_id,metadata' || E'\n' ||
      COALESCE(string_agg(
        format('%s,%s,%s,%s,%s,%s',
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          quote_nullable(event_type),
          quote_nullable(action),
          quote_nullable(target),
          quote_nullable(actor_id),
          quote_nullable(replace(metadata, E'\n', ' '))
        ), E'\n'
      ), '')
    INTO result_text
    FROM rows;
  ELSE
    WITH rows AS (
      SELECT id, created_at, event_type, action, target, actor_id, metadata
      FROM public.audit_log
      WHERE (p_event_type IS NULL OR event_type = p_event_type)
        AND (p_from IS NULL OR created_at >= p_from)
        AND (p_to IS NULL OR created_at <= p_to)
      ORDER BY created_at DESC
    )
    SELECT coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)::text
    INTO result_text
    FROM rows;
  END IF;

  RETURN result_text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_privileged_event(UUID, TEXT, UUID, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_terminate_session(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_incident_review(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
