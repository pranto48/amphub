import { supabase } from "@/integrations/supabase/client";

type AccessCheckArgs = {
  // UX-only preflight. Server RPC guard is the primary security boundary.
  requestId?: string;
  nodeId: string;
  userId?: string;
  local?: boolean;
};

export async function canAccessApprovedSession(args: AccessCheckArgs): Promise<boolean> {
  // Do not rely on this check for security decisions; every privileged action is re-validated in RPC.
  if (args.local) return true;
  if (!args.userId || !args.requestId) return false;

  const { data } = await supabase
    .from("access_requests")
    .select("id,status,expires_at,session_token")
    .eq("id", args.requestId)
    .eq("node_id", args.nodeId)
    .eq("requester_id", args.userId)
    .maybeSingle();

  if (!data || data.status !== "approved" || !data.session_token || !data.expires_at) return false;
  return new Date(data.expires_at).getTime() > Date.now();
}
