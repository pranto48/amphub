import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Check, X, ShieldAlert, Activity, ScrollText, Ban,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPanel });

type ReqStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

type ReqRow = {
  id: string;
  node_id: string;
  requester_id: string;
  status: ReqStatus;
  requested_at: string;
  expires_at: string | null;
};
type Audit = { id: string; action: string; target: string | null; created_at: string };

function AdminPanel() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [approved, setApproved] = React.useState<ReqRow[]>([]);
  const [audit, setAudit] = React.useState<Audit[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!isAdmin) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const load = React.useCallback(async () => {
    const [{ data: reqs }, { data: nodes }, { data: a }] = await Promise.all([
      supabase.from("access_requests").select("id,node_id,requester_id,status,requested_at,expires_at").in("status", ["pending", "approved"]).order("requested_at", { ascending: false }),
      supabase.from("desktop_nodes").select("id,name"),
      supabase.from("audit_log").select("id,action,target,created_at").order("created_at", { ascending: false }).limit(20),
    ]);
    const all = (reqs ?? []) as ReqRow[];
    setPending(all.filter((r) => r.status === "pending"));
    setApproved(all.filter((r) => r.status === "approved"));
    setNodeMap(Object.fromEntries((nodes ?? []).map((n: { id: string; name: string }) => [n.id, n.name])));
    setAudit((a ?? []) as Audit[]);
    setLoading(false);
  }, []);

  React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  React.useEffect(() => {
    if (!isAdmin) return;
    const cleanup = window.setInterval(() => {
      supabase.rpc("expire_access_requests");
      load();
    }, 60_000);

    const ch = supabase
      .channel("admin-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_requests" }, (payload) => {
        const r = payload.new as ReqRow;
        toast.warning("New access request", { description: `Node ${r.node_id.slice(0, 8)} awaiting approval` });
        setPending((p) => [r, ...p]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests" }, () => load())
      .subscribe();
    return () => {
      window.clearInterval(cleanup);
      supabase.removeChannel(ch);
    };
  }, [isAdmin, load]);

  async function decide(req: ReqRow, decision: "approved" | "denied" | "revoked") {
    const { data, error } = await supabase.rpc("admin_decide_access_request", {
      p_request_id: req.id,
      p_decision: decision,
      p_single_use: true,
      p_ttl_minutes: 10,
    });

    if (error) { toast.error(error.message); return; }

    const updated = (Array.isArray(data) ? data[0] : data) as ReqRow | null;
    if (updated?.status === "approved") {
      toast.success("Approved", { description: "Token issued with strict TTL." });
    } else if (updated?.status === "denied") {
      toast.success("Denied");
    } else {
      toast.success("Revoked", { description: "Session token has been invalidated." });
    }

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
          <RouteLoadingState label="Loading pending access requests" />
        ) : pending.length === 0 ? (
          <RouteEmptyState title="No pending requests." description="New approvals will appear here in real time." />
        ) : (
          <div className="divide-y divide-border">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    req · {r.id.slice(0, 8)} · {new Date(r.requested_at).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => decide(r, "denied")}>
                    <X className="size-4" /> Deny
                  </Button>
                  <Button size="sm" onClick={() => decide(r, "approved")}>
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
          <Ban className="size-4 text-destructive" />
          <h2 className="text-sm font-semibold">Active approvals</h2>
          <Badge variant="outline" className="font-mono">{approved.length}</Badge>
        </div>
        {approved.length === 0 ? (
          <RouteEmptyState title="No active approvals." description="Approved sessions with valid TTL will show here." />
        ) : (
          <div className="divide-y divide-border">
            {approved.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    req · {r.id.slice(0, 8)} · exp {r.expires_at ? new Date(r.expires_at).toLocaleTimeString() : "—"}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => decide(r, "revoked")}>
                  <Ban className="size-4" /> Revoke
                </Button>
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
          <RouteEmptyState title="No activity yet." description="Audit events will populate as actions occur." />
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
