CREATE TABLE IF NOT EXISTS public.admin_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_deny_outside_business_hours BOOLEAN NOT NULL DEFAULT FALSE,
  business_hours_start TEXT NOT NULL DEFAULT '08:00',
  business_hours_end TEXT NOT NULL DEFAULT '18:00',
  require_two_step_sensitive_nodes BOOLEAN NOT NULL DEFAULT FALSE,
  sensitive_node_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  max_session_duration_by_role JSONB NOT NULL DEFAULT '{"user": 30, "admin": 120}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_access_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view admin access policies" ON public.admin_access_policies;
CREATE POLICY "Admins view admin access policies" ON public.admin_access_policies
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins mutate admin access policies" ON public.admin_access_policies;
CREATE POLICY "Admins mutate admin access policies" ON public.admin_access_policies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_admin_access_policy_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_access_policies_touch_updated_at ON public.admin_access_policies;
CREATE TRIGGER admin_access_policies_touch_updated_at
BEFORE UPDATE ON public.admin_access_policies
FOR EACH ROW
EXECUTE FUNCTION public.touch_admin_access_policy_updated_at();
