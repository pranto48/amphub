import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Check, X, ShieldAlert, Activity, ScrollText,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPanel });

type ReqRow = {
  id: string;
  node_id: string;
  requester_id: string;
  status: string;
  requested_at: string;
};
type Audit = { id: string; action: string; target: string | null; created_at: string };

function AdminPanel() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [audit, setAudit] = React.useState<Audit[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!isAdmin) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const load = React.useCallback(async () => {
    const [{ data: reqs }, { data: nodes }, { data: a }] = await Promise.all([
      supabase.from("access_requests").select("*").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase.from("desktop_nodes").select("id,name"),
      supabase.from("audit_log").select("id,action,target,created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    setPending((reqs ?? []) as ReqRow[]);
    setNodeMap(Object.fromEntries((nodes ?? []).map((n: { id: string; name: string }) => [n.id, n.name])));
    setAudit((a ?? []) as Audit[]);
    setLoading(false);
  }, []);

  React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  React.useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("admin-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_requests" }, (payload) => {
        const r = payload.new as ReqRow;
        toast.warning("New access request", { description: `Node ${r.node_id.slice(0, 8)} awaiting approval` });
        setPending((p) => [r, ...p]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, load]);

  async function decide(req: ReqRow, approve: boolean) {
    if (!user) return;
    const update = approve
      ? {
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_by: user.id,
          session_token: crypto.randomUUID().replace(/-/g, ""),
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }
      : { status: "denied", decided_at: new Date().toISOString(), decided_by: user.id };
    const { error } = await supabase.from("access_requests").update(update).eq("id", req.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("audit_log").insert({
      actor_id: user.id,
      action: approve ? "approve_access" : "deny_access",
      target: req.node_id,
      metadata: { request_id: req.id },
    });
    toast.success(approve ? "Approved" : "Denied");
    setPending((p) => p.filter((r) => r.id !== req.id));
    load();
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve incoming remote sessions and review activity.
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          <h2 className="text-sm font-semibold">Pending access requests</h2>
          <Badge variant="outline" className="font-mono">{pending.length}</Badge>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-4 animate-spin" /></div>
        ) : pending.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No pending requests.</div>
        ) : (
          <div className="divide-y divide-border">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    req · {r.id.slice(0, 8)} · {new Date(r.requested_at).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => decide(r, false)}>
                    <X className="size-4" /> Deny
                  </Button>
                  <Button size="sm" onClick={() => decide(r, true)}>
                    <Check className="size-4" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ScrollText className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Recent activity</h2>
        </div>
        {audit.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No activity yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2 text-xs">
                <Activity className="size-3 text-accent" />
                <span className="font-mono">{a.action}</span>
                <span className="font-mono text-muted-foreground">{a.target?.slice(0, 8) ?? "—"}</span>
                <span className="ml-auto font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
