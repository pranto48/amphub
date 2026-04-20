CREATE TABLE IF NOT EXISTS public.remote_stream_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.access_requests(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.desktop_nodes(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signaling_room TEXT NOT NULL UNIQUE,
  control_token TEXT NOT NULL,
  media_endpoint TEXT NOT NULL,
  preferred_adapter TEXT NOT NULL DEFAULT 'webrtc' CHECK (preferred_adapter IN ('webrtc', 'rdp', 'vnc')),
  viewer_state TEXT NOT NULL DEFAULT 'ready' CHECK (viewer_state IN ('ready', 'agent-offline')),
  latency_ms INTEGER,
  fps INTEGER,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.remote_stream_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own remote stream sessions"
ON public.remote_stream_sessions
FOR ALL
TO authenticated
USING (requester_id = auth.uid())
WITH CHECK (requester_id = auth.uid());

CREATE OR REPLACE FUNCTION public.session_stream_negotiate(
  p_node_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL
)
RETURNS TABLE(
  authorized BOOLEAN,
  denial_reason TEXT,
  session_id UUID,
  signaling_room TEXT,
  control_token TEXT,
  media_endpoint TEXT,
  preferred_adapter TEXT,
  viewer_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_row RECORD;
  req public.access_requests%ROWTYPE;
  stream public.remote_stream_sessions%ROWTYPE;
BEGIN
  SELECT *
  INTO auth_row
  FROM public.authorize_privileged_access(p_node_id, p_request_id, auth.uid(), p_session_token, FALSE)
  LIMIT 1;

  IF auth_row IS NULL OR auth_row.authorized IS DISTINCT FROM TRUE THEN
    RETURN QUERY SELECT FALSE, COALESCE(auth_row.denial_reason, 'not_authorized'), NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF auth_row.matched_request_id IS NOT NULL THEN
    SELECT * INTO req FROM public.access_requests WHERE id = auth_row.matched_request_id;
  END IF;

  INSERT INTO public.remote_stream_sessions (
    request_id,
    node_id,
    requester_id,
    signaling_room,
    control_token,
    media_endpoint,
    preferred_adapter,
    viewer_state,
    last_heartbeat_at
  ) VALUES (
    auth_row.matched_request_id,
    p_node_id,
    auth.uid(),
    'stream-' || replace(gen_random_uuid()::text, '-', ''),
    encode(gen_random_bytes(24), 'hex'),
    '/v1/remote/sessions/' || replace(gen_random_uuid()::text, '-', '') || '/media',
    'webrtc',
    CASE WHEN EXISTS (SELECT 1 FROM public.desktop_nodes n WHERE n.id = p_node_id AND n.status = 'online') THEN 'ready' ELSE 'agent-offline' END,
    now()
  )
  RETURNING * INTO stream;

  RETURN QUERY SELECT TRUE, NULL::TEXT, stream.id, stream.signaling_room, stream.control_token, stream.media_endpoint, stream.preferred_adapter, stream.viewer_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.session_stream_heartbeat(
  p_node_id UUID,
  p_session_id UUID,
  p_request_id UUID DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL,
  p_fps INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_row RECORD;
BEGIN
  SELECT *
  INTO auth_row
  FROM public.authorize_privileged_access(p_node_id, p_request_id, auth.uid(), NULL, FALSE)
  LIMIT 1;

  IF auth_row IS NULL OR auth_row.authorized IS DISTINCT FROM TRUE THEN
    RETURN FALSE;
  END IF;

  UPDATE public.remote_stream_sessions
  SET
    latency_ms = COALESCE(p_latency_ms, latency_ms),
    fps = COALESCE(p_fps, fps),
    last_heartbeat_at = now(),
    updated_at = now()
  WHERE id = p_session_id
    AND node_id = p_node_id
    AND requester_id = auth.uid();

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_stream_negotiate(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.session_stream_heartbeat(UUID, UUID, UUID, INTEGER, INTEGER) TO authenticated;
