import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, X, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPanel });

type ReqStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

type ReqRow = {
  id: string;
  node_id: string;
  requester_id: string;
  requester_identity: string | null;
  node_name: string | null;
  location_hint: string | null;
  status: ReqStatus;
  requested_at: string;
  expires_at: string | null;
  request_reason: string | null;
  status_reason_code: string | null;
  status_reason_message: string | null;
  pending_expires_at: string | null;
};

function AdminPanel() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [approved, setApproved] = React.useState<ReqRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [decisionNotes, setDecisionNotes] = React.useState<Record<string, string>>({});
  const [busyRequest, setBusyRequest] = React.useState<string | null>(null);
  const [tokenTtlMinutes, setTokenTtlMinutes] = React.useState(10);
  const [pendingTimeoutMinutes, setPendingTimeoutMinutes] = React.useState(10);

  React.useEffect(() => {
    if (!isAdmin) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const load = React.useCallback(async () => {
    await supabase.rpc("expire_access_requests", { p_pending_timeout_minutes: pendingTimeoutMinutes });

    const { data: reqs, error } = await supabase
      .from("access_requests")
      .select("id,node_id,requester_id,requester_identity,node_name,location_hint,status,requested_at,expires_at,request_reason,status_reason_code,status_reason_message,pending_expires_at")
      .in("status", ["pending", "approved"])
      .order("requested_at", { ascending: false });

    if (error) {
      toast.error("Failed to load requests", { description: error.message });
      setLoading(false);
      return;
    }

    const all = (reqs ?? []) as ReqRow[];
    setPending(all.filter((r) => r.status === "pending"));
    setApproved(all.filter((r) => r.status === "approved"));
    setLoading(false);
  }, [pendingTimeoutMinutes]);

  React.useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  React.useEffect(() => {
    if (!isAdmin) return;

    const timer = window.setInterval(() => {
      load();
    }, 30_000);

    const ch = supabase
      .channel("admin-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_requests" }, (payload) => {
        const r = payload.new as ReqRow;
        toast.warning("New access request", {
          description: `${r.requester_identity ?? r.requester_id.slice(0, 8)} requested ${r.node_name ?? r.node_id.slice(0, 8)}${r.request_reason ? ` · ${r.request_reason}` : ""}`,
        });
        load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests" }, () => load())
      .subscribe();

    return () => {
      window.clearInterval(timer);
      supabase.removeChannel(ch);
    };
  }, [isAdmin, load]);

  async function decide(req: ReqRow, decision: "approved" | "denied" | "revoked") {
    setBusyRequest(req.id);
    const { error } = await supabase.rpc("admin_decide_access_request", {
      p_request_id: req.id,
      p_decision: decision,
      p_note: decisionNotes[req.id] ?? null,
      p_ttl_minutes: tokenTtlMinutes,
      p_single_use: true,
    });
    setBusyRequest(null);

    if (error) {
      toast.error("Decision failed", { description: error.message });
      return;
    }

    toast.success(`Request ${decision}`);
    setDecisionNotes((prev) => ({ ...prev, [req.id]: "" }));
    load();
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Realtime request review with explicit approval controls.</p>
      </div>

      <Card className="p-4">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Approved token TTL (minutes)
            <Input
              type="number"
              className="mt-1"
              min={5}
              max={30}
              value={tokenTtlMinutes}
              onChange={(e) => setTokenTtlMinutes(Math.max(5, Math.min(30, Number(e.target.value) || 10)))}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Pending timeout (minutes)
            <Input
              type="number"
              className="mt-1"
              min={1}
              max={120}
              value={pendingTimeoutMinutes}
              onChange={(e) => setPendingTimeoutMinutes(Math.max(1, Math.min(120, Number(e.target.value) || 10)))}
            />
          </label>
        </div>
      </Card>

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
              <div key={r.id} className="space-y-2 py-3">
                <div className="text-sm font-medium">{r.node_name ?? r.node_id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground">Requester: {r.requester_identity ?? r.requester_id.slice(0, 8)} · {r.location_hint ?? "location unavailable"}</div>
                <div className="text-xs text-muted-foreground">Reason: {r.request_reason ?? "No reason provided"}</div>
                {r.pending_expires_at && (
                  <div className="font-mono text-[10px] text-muted-foreground">Pending expires at {new Date(r.pending_expires_at).toLocaleTimeString()}</div>
                )}
                <Input
                  value={decisionNotes[r.id] ?? ""}
                  onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Optional note"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={busyRequest === r.id} onClick={() => decide(r, "denied")}>
                    <X className="size-4" /> Deny
                  </Button>
                  <Button size="sm" disabled={busyRequest === r.id} onClick={() => decide(r, "approved")}>
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
          <h2 className="text-sm font-semibold">Active approvals</h2>
          <Badge variant="outline" className="font-mono">{approved.length}</Badge>
        </div>
        {approved.length === 0 ? (
          <RouteEmptyState title="No active approvals." description="Approved sessions with valid TTL will show here." />
        ) : (
          <div className="divide-y divide-border">
            {approved.map((r) => (
              <div key={r.id} className="space-y-2 py-3">
                <div className="text-sm font-medium">{r.node_name ?? r.node_id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground">Requester: {r.requester_identity ?? r.requester_id.slice(0, 8)}</div>
                <div className="font-mono text-[10px] text-muted-foreground">Expires {r.expires_at ? new Date(r.expires_at).toLocaleTimeString() : "—"}</div>
                <Input
                  value={decisionNotes[r.id] ?? ""}
                  onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Optional revoke note"
                />
                <Button size="sm" variant="destructive" disabled={busyRequest === r.id} onClick={() => decide(r, "revoked")}>Revoke</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
