-- Add banned_until column to desktop_nodes table if it doesn't exist
ALTER TABLE public.desktop_nodes
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ DEFAULT NULL;

-- Enforce ban checks before creating access requests
CREATE OR REPLACE FUNCTION public.check_node_banned_before_request()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.desktop_nodes
    WHERE id = NEW.node_id AND banned_until > now()
  ) THEN
    RAISE EXCEPTION 'This client is currently banned from remote connections';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_node_banned_trigger ON public.access_requests;
CREATE TRIGGER check_node_banned_trigger
  BEFORE INSERT ON public.access_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.check_node_banned_before_request();

-- Update enforce_desktop_node_remote_id_rules trigger function to allow admin override
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
    AND coalesce(rotate_override, 'off') <> 'on'
    AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'remote_id is immutable after enrollment; use admin_rotate_remote_id';
  END IF;

  RETURN NEW;
END;
$$;
