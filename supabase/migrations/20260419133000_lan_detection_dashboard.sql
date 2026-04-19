CREATE OR REPLACE FUNCTION public.lan_ipv4_subnet(ip_text TEXT, mask_bits INTEGER DEFAULT 24)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parsed_ip INET;
BEGIN
  IF ip_text IS NULL OR btrim(ip_text) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    parsed_ip := ip_text::inet;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF family(parsed_ip) <> 4 THEN
    RETURN NULL;
  END IF;

  IF NOT public.is_private_lan_ip(ip_text) THEN
    RETURN NULL;
  END IF;

  RETURN network(set_masklen(parsed_ip, mask_bits))::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_nodes_with_lan(
  p_requester_ip TEXT DEFAULT NULL,
  p_requester_hints TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  remote_id TEXT,
  local_ip TEXT,
  os TEXT,
  status TEXT,
  last_seen TIMESTAMPTZ,
  same_lan BOOLEAN,
  lan_detection_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_subnet TEXT := public.lan_ipv4_subnet(p_requester_ip);
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.name,
    n.remote_id,
    n.local_ip,
    n.os,
    n.status,
    n.last_seen,
    (
      requester_subnet IS NOT NULL
      AND public.lan_ipv4_subnet(n.local_ip) = requester_subnet
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(coalesce(p_requester_hints, ARRAY[]::TEXT[])) AS hint(ip_hint)
      WHERE public.lan_ipv4_subnet(ip_hint) IS NOT NULL
        AND public.lan_ipv4_subnet(n.local_ip) = public.lan_ipv4_subnet(ip_hint)
    ) AS same_lan,
    CASE
      WHEN requester_subnet IS NOT NULL
        AND public.lan_ipv4_subnet(n.local_ip) = requester_subnet
        THEN 'requester_ip_subnet'
      WHEN EXISTS (
        SELECT 1
        FROM unnest(coalesce(p_requester_hints, ARRAY[]::TEXT[])) AS hint(ip_hint)
        WHERE public.lan_ipv4_subnet(ip_hint) IS NOT NULL
          AND public.lan_ipv4_subnet(n.local_ip) = public.lan_ipv4_subnet(ip_hint)
      ) THEN 'requester_hint_subnet'
      ELSE NULL
    END AS lan_detection_source
  FROM public.desktop_nodes n
  ORDER BY n.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_access_mode_decision(
  p_node_id UUID,
  p_detected_same_lan BOOLEAN,
  p_manual_lan_mode BOOLEAN,
  p_effective_mode TEXT,
  p_detection_source TEXT DEFAULT NULL,
  p_requester_hints TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_override_differs BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  inserted_id UUID;
BEGIN
  IF current_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'access_mode_decision',
    p_node_id::TEXT,
    jsonb_build_object(
      'detected_same_lan', p_detected_same_lan,
      'manual_lan_mode', p_manual_lan_mode,
      'override_differs', p_override_differs,
      'effective_mode', p_effective_mode,
      'detection_source', p_detection_source,
      'requester_hints', coalesce(p_requester_hints, ARRAY[]::TEXT[])
    )
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lan_ipv4_subnet(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_nodes_with_lan(TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_access_mode_decision(UUID, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT[], BOOLEAN) TO authenticated;
