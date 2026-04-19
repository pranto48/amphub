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
type Severity = "info" | "warning" | "success" | "error";
type AuditFilter = "all" | "auth" | "approval" | "file_ops" | "remote_control";

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
};

type ActiveSession = {
  id: string;
  node_id: string;
  requester_id: string | null;
  request_id: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  terminated_at: string | null;
};

type Audit = {
  id: string;
  action: string;
  event_type: string | null;
  target: string | null;
  actor_id: string | null;
  created_at: string;
};

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  createdAt: string;
};

function AdminPanel() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [approved, setApproved] = React.useState<ReqRow[]>([]);
  const [sessions, setSessions] = React.useState<ActiveSession[]>([]);
  const [audit, setAudit] = React.useState<Audit[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [auditFilter, setAuditFilter] = React.useState<AuditFilter>("all");
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [exporting, setExporting] = React.useState<"csv" | "json" | null>(null);

  const notify = React.useCallback((severity: Severity, title: string, description: string) => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      description,
      severity,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [item, ...prev].slice(0, 50));

    if (severity === "success") toast.success(title, { description });
    else if (severity === "warning") toast.warning(title, { description });
    else if (severity === "error") toast.error(title, { description });
    else toast.info(title, { description });
  }, []);

  React.useEffect(() => {
    if (!isAdmin) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const load = React.useCallback(async () => {
    const auditQuery = supabase
      .from("audit_log")
      .select("id,action,event_type,target,actor_id,created_at")
      .order("created_at", { ascending: false })
      .limit(150);

    const [{ data: reqs }, { data: nodes }, { data: a }, { data: s }] = await Promise.all([
      supabase
        .from("access_requests")
        .select("id,node_id,requester_id,requester_identity,node_name,location_hint,status,requested_at,expires_at")
        .in("status", ["pending", "approved"])
        .order("requested_at", { ascending: false }),
      supabase.from("desktop_nodes").select("id,name"),
      auditFilter === "all" ? auditQuery : auditQuery.eq("event_type", auditFilter),
      supabase
        .from("active_sessions")
        .select("id,node_id,requester_id,request_id,started_at,last_seen_at,ended_at,terminated_at")
        .is("ended_at", null)
        .is("terminated_at", null)
        .order("started_at", { ascending: false }),
    ]);

    const all = (reqs ?? []) as ReqRow[];
    setPending(all.filter((r) => r.status === "pending"));
    setApproved(all.filter((r) => r.status === "approved"));
    setNodeMap(Object.fromEntries((nodes ?? []).map((n: { id: string; name: string }) => [n.id, n.name])));
    setAudit((a ?? []) as Audit[]);
    setSessions((s ?? []) as ActiveSession[]);
    setLoading(false);
  }, [auditFilter]);

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
        notify(
          "warning",
          "New access request",
          `${r.requester_identity ?? r.requester_id.slice(0, 8)} requested ${r.node_name ?? r.node_id.slice(0, 8)} · ${r.location_hint ?? "unknown location"}`,
        );
        setPending((p) => [r, ...p]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_log" }, () => load())
      .subscribe();

    return () => {
      window.clearInterval(cleanup);
      supabase.removeChannel(ch);
    };
  }, [isAdmin, load, notify]);

  async function decide(req: ReqRow, decision: "approved" | "denied" | "revoked") {
    const { data, error } = await supabase.rpc("admin_decide_access_request", {
      p_request_id: req.id,
      p_decision: decision,
      p_single_use: true,
      p_ttl_minutes: 10,
    });

    if (error) {
      notify("error", "Decision failed", error.message);
      return;
    }

    const updated = (Array.isArray(data) ? data[0] : data) as ReqRow | null;
    if (updated?.status === "approved") {
      notify("success", "Approved", "Token issued with strict TTL.");
    } else if (updated?.status === "denied") {
      notify("info", "Denied", `${req.requester_identity ?? req.requester_id.slice(0, 8)} denied`);
    } else {
      notify("warning", "Revoked", "Session token has been invalidated.");
    }

    load();
  }

  async function terminateSession(session: ActiveSession) {
    const { error } = await supabase.rpc("admin_terminate_session", {
      p_session_id: session.id,
      p_reason: "admin_panel_terminate",
    });

    if (error) {
      notify("error", "Terminate failed", error.message);
      return;
    }

    notify("warning", "Session terminated", `Session ${session.id.slice(0, 8)} was terminated by admin.`);
    load();
  }

  async function exportIncident(format: "csv" | "json") {
    setExporting(format);
    const { data, error } = await supabase.rpc("export_incident_review", {
      p_format: format,
      p_event_type: auditFilter === "all" ? null : auditFilter,
    });

    setExporting(null);
    if (error || !data) {
      notify("error", "Export failed", error?.message ?? "No data returned");
      return;
    }

    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([data], { type: mime });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `incident-review-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);

    notify("success", "Incident export ready", `Downloaded ${format.toUpperCase()} incident review file.`);
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve incoming remote sessions, monitor active control channels, and review incidents.
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <BellRing className="size-4 text-warning" />
          <h2 className="text-sm font-semibold">Notification feed</h2>
          <Badge variant="outline" className="font-mono">{notifications.length}</Badge>
        </div>
        {notifications.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No notifications yet.</div>
        ) : (
          <div className="max-h-44 space-y-2 overflow-auto pr-2">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                {n.severity === "success" ? <CircleCheckBig className="mt-0.5 size-3.5 text-emerald-500" /> : null}
                {n.severity === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 text-amber-500" /> : null}
                {n.severity === "error" ? <CircleOff className="mt-0.5 size-3.5 text-destructive" /> : null}
                {n.severity === "info" ? <Radio className="mt-0.5 size-3.5 text-primary" /> : null}
                <div className="min-w-0">
                  <div className="font-medium">{n.title}</div>
                  <div className="text-muted-foreground">{n.description}</div>
                </div>
                <div className="ml-auto whitespace-nowrap font-mono text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        )}
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
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">Requester: {r.requester_identity ?? r.requester_id.slice(0, 8)} · {r.location_hint ?? "location unavailable"}</div>
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
                  <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">Requester: {r.requester_identity ?? r.requester_id.slice(0, 8)}</div>
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
          <Activity className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Active sessions</h2>
          <Badge variant="outline" className="font-mono">{sessions.length}</Badge>
        </div>
        {sessions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No active sessions.</div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 text-xs">
                  <div className="text-sm font-medium">{nodeMap[s.node_id] ?? s.node_id.slice(0, 8)}</div>
                  <div className="font-mono text-muted-foreground">session · {s.id.slice(0, 8)} · requester {s.requester_id?.slice(0, 8) ?? "—"}</div>
                  <div className="font-mono text-muted-foreground">started {new Date(s.started_at).toLocaleString()} · last {new Date(s.last_seen_at).toLocaleTimeString()}</div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => terminateSession(s)}>
                  <Ban className="size-4" /> Terminate
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
          <div className="ml-auto flex items-center gap-2">
            <select
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value as AuditFilter)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">All events</option>
              <option value="auth">Auth events</option>
              <option value="approval">Approval decisions</option>
              <option value="file_ops">File operations</option>
              <option value="remote_control">Remote control commands</option>
            </select>
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => exportIncident("json")}> 
              <Download className="size-4" /> {exporting === "json" ? "Exporting..." : "JSON"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => exportIncident("csv")}> 
              <Download className="size-4" /> {exporting === "csv" ? "Exporting..." : "CSV"}
            </Button>
          </div>
        </div>
        {audit.length === 0 ? (
          <RouteEmptyState title="No activity yet." description="Audit events will populate as actions occur." />
        ) : (
          <div className="divide-y divide-border">
            {audit.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-2 text-xs">
                <Activity className="size-3 text-accent" />
                <Badge variant="outline" className="font-mono text-[10px]">{a.event_type ?? "other"}</Badge>
                <span className="font-mono">{a.action}</span>
                <span className="font-mono text-muted-foreground">{a.target?.slice(0, 8) ?? "—"}</span>
                <span className="font-mono text-muted-foreground">actor {a.actor_id?.slice(0, 8) ?? "—"}</span>
                <span className="ml-auto font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
