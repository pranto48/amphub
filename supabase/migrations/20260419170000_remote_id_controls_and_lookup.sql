CREATE OR REPLACE FUNCTION public.normalize_remote_id(p_remote_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF p_remote_id IS NULL OR btrim(p_remote_id) = '' THEN
    RAISE EXCEPTION 'remote_id is required';
  END IF;

  digits := regexp_replace(p_remote_id, '[^0-9]', '', 'g');
  IF length(digits) <> 9 THEN
    RAISE EXCEPTION 'remote_id must contain exactly 9 digits';
  END IF;

  RETURN substring(digits FROM 1 FOR 3)
    || '-'
    || substring(digits FROM 4 FOR 3)
    || '-'
    || substring(digits FROM 7 FOR 3);
END;
$$;

UPDATE public.desktop_nodes
SET remote_id = public.normalize_remote_id(remote_id)
WHERE remote_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'desktop_nodes_remote_id_format_chk'
      AND conrelid = 'public.desktop_nodes'::regclass
  ) THEN
    ALTER TABLE public.desktop_nodes
      ADD CONSTRAINT desktop_nodes_remote_id_format_chk
      CHECK (remote_id ~ '^\d{3}-\d{3}-\d{3}$');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_desktop_node_remote_id_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rotate_override TEXT := current_setting('app.allow_remote_id_rotate', true);
BEGIN
  NEW.remote_id := public.normalize_remote_id(NEW.remote_id);

  IF TG_OP = 'UPDATE'
    AND NEW.remote_id IS DISTINCT FROM OLD.remote_id
    AND coalesce(rotate_override, 'off') <> 'on' THEN
    RAISE EXCEPTION 'remote_id is immutable after enrollment; use admin_rotate_remote_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_desktop_nodes_remote_id_rules ON public.desktop_nodes;
CREATE TRIGGER enforce_desktop_nodes_remote_id_rules
  BEFORE INSERT OR UPDATE ON public.desktop_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_desktop_node_remote_id_rules();

CREATE OR REPLACE FUNCTION public.lookup_node_by_remote_id(p_remote_id TEXT)
RETURNS TABLE (
  node_id UUID,
  status TEXT,
  remote_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canonical_remote_id TEXT := public.normalize_remote_id(p_remote_id);
BEGIN
  RETURN QUERY
  SELECT n.id, n.status, n.remote_id
  FROM public.desktop_nodes n
  WHERE n.remote_id = canonical_remote_id
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_rotate_remote_id(
  p_node_id UUID,
  p_agent_rebind_token TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  node_id UUID,
  old_remote_id TEXT,
  new_remote_id TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_uid UUID := auth.uid();
  existing_remote_id TEXT;
  generated_remote_id TEXT;
  current_status TEXT;
  attempt_count INTEGER := 0;
BEGIN
  IF current_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(current_uid, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_agent_rebind_token IS NULL OR btrim(p_agent_rebind_token) = '' THEN
    RAISE EXCEPTION 'agent rebind token is required to rotate remote_id';
  END IF;

  SELECT n.remote_id, n.status
  INTO existing_remote_id, current_status
  FROM public.desktop_nodes n
  WHERE n.id = p_node_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'node not found';
  END IF;

  LOOP
    attempt_count := attempt_count + 1;
    IF attempt_count > 50 THEN
      RAISE EXCEPTION 'failed to generate a unique remote_id after % attempts', attempt_count;
    END IF;

    generated_remote_id :=
      lpad((floor(random() * 1000))::INT::TEXT, 3, '0')
      || '-'
      || lpad((floor(random() * 1000))::INT::TEXT, 3, '0')
      || '-'
      || lpad((floor(random() * 1000))::INT::TEXT, 3, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.desktop_nodes d
      WHERE d.remote_id = generated_remote_id
    );
  END LOOP;

  PERFORM set_config('app.allow_remote_id_rotate', 'on', true);

  UPDATE public.desktop_nodes
  SET remote_id = generated_remote_id
  WHERE id = p_node_id;

  INSERT INTO public.audit_log (actor_id, action, target, metadata)
  VALUES (
    current_uid,
    'admin_rotate_remote_id',
    p_node_id::TEXT,
    jsonb_build_object(
      'old_remote_id', existing_remote_id,
      'new_remote_id', generated_remote_id,
      'reason', p_reason,
      'agent_rebind_token', p_agent_rebind_token
    )
  );

  RETURN QUERY
  SELECT p_node_id, existing_remote_id, generated_remote_id, current_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_remote_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_node_by_remote_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rotate_remote_id(UUID, TEXT, TEXT) TO authenticated;
