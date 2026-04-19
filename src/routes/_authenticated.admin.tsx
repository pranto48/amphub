import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Ban,
  BellRing,
  Check,
  CircleCheckBig,
  CircleOff,
  Clock3,
  Download,
  Globe,
  ListTodo,
  Radio,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserCircle2,
  X,
} from "lucide-react";

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
  termination_reason: string | null;
};

type Audit = {
  id: string;
  action: string;
  event_type: string | null;
  target: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  createdAt: string;
};

type RequesterInfo = {
  email: string | null;
  role: "admin" | "user" | "unknown";
};

type PolicySettings = {
  auto_deny_outside_business_hours: boolean;
  business_hours_start: string;
  business_hours_end: string;
  require_two_step_sensitive_nodes: boolean;
  sensitive_node_ids_csv: string;
  max_session_user_minutes: number;
  max_session_admin_minutes: number;
};

const DEFAULT_POLICY: PolicySettings = {
  auto_deny_outside_business_hours: false,
  business_hours_start: "08:00",
  business_hours_end: "18:00",
  require_two_step_sensitive_nodes: false,
  sensitive_node_ids_csv: "",
  max_session_user_minutes: 30,
  max_session_admin_minutes: 120,
};

function stringifyExport(format: "csv" | "json", rows: Audit[]) {
  if (format === "json") return JSON.stringify(rows, null, 2);

  const headers = ["timestamp", "action", "event_type", "target", "actor_id", "session_id", "request_id", "reason"];
  const csvRows = rows.map((r) => {
    const sessionId = typeof r.metadata?.session_id === "string" ? r.metadata.session_id : "";
    const requestId = typeof r.metadata?.request_id === "string" ? r.metadata.request_id : "";
    const reason = typeof r.metadata?.reason === "string" ? r.metadata.reason : "";
    const row = [r.created_at, r.action, r.event_type ?? "", r.target ?? "", r.actor_id ?? "", sessionId, requestId, reason];
    return row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",");
  });

  return `${headers.join(",")}\n${csvRows.join("\n")}`;
}

function AdminPanel() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [approved, setApproved] = React.useState<ReqRow[]>([]);
  const [sessions, setSessions] = React.useState<ActiveSession[]>([]);
  const [audit, setAudit] = React.useState<Audit[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [requesterMap, setRequesterMap] = React.useState<Record<string, RequesterInfo>>({});
  const [deniedAttemptMap, setDeniedAttemptMap] = React.useState<Record<string, number>>({});

  const [loading, setLoading] = React.useState(true);
  const [auditFilter, setAuditFilter] = React.useState<AuditFilter>("all");
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);

  const [policyId, setPolicyId] = React.useState<string | null>(null);
  const [policySaving, setPolicySaving] = React.useState(false);
  const [policy, setPolicy] = React.useState<PolicySettings>(DEFAULT_POLICY);

  const [exporting, setExporting] = React.useState<"csv" | "json" | null>(null);
  const [auditExporting, setAuditExporting] = React.useState<"csv" | "json" | null>(null);

  const notify = React.useCallback((severity: Severity, title: string, description: string) => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      description,
      severity,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [item, ...prev].slice(0, 60));

    if (severity === "success") toast.success(title, { description });
    else if (severity === "warning") toast.warning(title, { description });
    else if (severity === "error") toast.error(title, { description });
    else toast.info(title, { description });
  }, []);

  React.useEffect(() => {
    if (!isAdmin) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const loadPolicy = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("admin_access_policies")
      .select("id,auto_deny_outside_business_hours,business_hours_start,business_hours_end,require_two_step_sensitive_nodes,sensitive_node_ids,max_session_duration_by_role")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      notify("warning", "Policy load warning", error.message);
      return;
    }

    if (!data) {
      setPolicyId(null);
      setPolicy(DEFAULT_POLICY);
      return;
    }

    const roleDuration = (data.max_session_duration_by_role ?? {}) as Record<string, number>;
    setPolicyId(data.id);
    setPolicy({
      auto_deny_outside_business_hours: data.auto_deny_outside_business_hours,
      business_hours_start: data.business_hours_start,
      business_hours_end: data.business_hours_end,
      require_two_step_sensitive_nodes: data.require_two_step_sensitive_nodes,
      sensitive_node_ids_csv: (data.sensitive_node_ids ?? []).join(", "),
      max_session_user_minutes: Number(roleDuration.user ?? DEFAULT_POLICY.max_session_user_minutes),
      max_session_admin_minutes: Number(roleDuration.admin ?? DEFAULT_POLICY.max_session_admin_minutes),
    });
  }, [notify]);

  const load = React.useCallback(async () => {
    setLoading(true);

    const auditQuery = supabase
      .from("audit_log")
      .select("id,action,event_type,target,actor_id,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(250);

    const [{ data: reqs }, { data: nodes }, { data: a }, { data: s }, { data: deniedReqs }] = await Promise.all([
      supabase
        .from("access_requests")
        .select("id,node_id,requester_id,requester_identity,node_name,location_hint,status,requested_at,expires_at")
        .in("status", ["pending", "approved"])
        .order("requested_at", { ascending: false }),
      supabase.from("desktop_nodes").select("id,name"),
      auditFilter === "all" ? auditQuery : auditQuery.eq("event_type", auditFilter),
      supabase
        .from("active_sessions")
        .select("id,node_id,requester_id,request_id,started_at,last_seen_at,ended_at,terminated_at,termination_reason")
        .is("ended_at", null)
        .is("terminated_at", null)
        .order("started_at", { ascending: false }),
      supabase
        .from("access_requests")
        .select("requester_id,node_id")
        .eq("status", "denied")
        .limit(3000),
    ]);

    const allRequests = (reqs ?? []) as ReqRow[];
    const allSessions = (s ?? []) as ActiveSession[];

    const requesterIds = Array.from(new Set([
      ...allRequests.map((r) => r.requester_id),
      ...allSessions.map((session) => session.requester_id).filter(Boolean) as string[],
    ]));

    const [{ data: profiles }, { data: roles }] = await Promise.all([
      requesterIds.length
        ? supabase.from("profiles").select("id,email").in("id", requesterIds)
        : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
      requesterIds.length
        ? supabase.from("user_roles").select("user_id,role").in("user_id", requesterIds)
        : Promise.resolve({ data: [] as { user_id: string; role: "admin" | "user" }[] }),
    ]);

    const roleLookup = new Map((roles ?? []).map((r) => [r.user_id, r.role]));
    const requesterLookup = Object.fromEntries(
      (profiles ?? []).map((p) => [p.id, { email: p.email, role: roleLookup.get(p.id) ?? "unknown" } satisfies RequesterInfo]),
    );

    const deniedCounts = (deniedReqs ?? []).reduce<Record<string, number>>((acc, row) => {
      const key = `${row.requester_id}:${row.node_id}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    setPending(allRequests.filter((r) => r.status === "pending"));
    setApproved(allRequests.filter((r) => r.status === "approved"));
    setNodeMap(Object.fromEntries((nodes ?? []).map((n: { id: string; name: string }) => [n.id, n.name])));
    setAudit((a ?? []) as Audit[]);
    setSessions(allSessions);
    setRequesterMap(requesterLookup);
    setDeniedAttemptMap(deniedCounts);

    setLoading(false);
  }, [pendingTimeoutMinutes]);

  React.useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([load(), loadPolicy()]);
  }, [isAdmin, load, loadPolicy]);

  React.useEffect(() => {
    if (!isAdmin) return;

    const cleanup = window.setInterval(() => {
      void supabase.rpc("expire_access_requests");
      void load();
    }, 60_000);

    const ch = supabase
      .channel("admin-requests")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_requests" }, (payload) => {
        const r = payload.new as ReqRow;
        toast.warning("New access request", { description: `${nodeMap[r.node_id] ?? `Node ${r.node_id.slice(0, 8)}`} awaiting approval` });
        setPending((p) => [r, ...p]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, load, nodeMap]);

    return () => {
      window.clearInterval(cleanup);
      void supabase.removeChannel(ch);
    };
  }, [isAdmin, load, nodeMap, notify]);

  async function decide(req: ReqRow, decision: "approved" | "denied" | "revoked", mode: "once" | "timed" = "timed") {
    const ttl = mode === "once" ? 1 : 15;
    const singleUse = mode === "once";

    const { error } = await supabase.rpc("admin_decide_access_request", {
      p_request_id: req.id,
      p_decision: decision,
      p_single_use: singleUse,
      p_ttl_minutes: ttl,
    });

    if (error) {
      notify("error", "Decision failed", error.message);
      return;
    }

    notify(
      decision === "approved" ? "success" : "warning",
      decision === "approved" ? "Request approved" : decision === "denied" ? "Request denied" : "Request revoked",
      `${(req.node_name ?? nodeMap[req.node_id] ?? req.node_id.slice(0, 8)).slice(0, 40)} (${mode === "once" ? "approve once" : `${ttl} minute session`}).`,
    );

    void load();
  }

  async function terminateSession(session: ActiveSession) {
    const { error } = await supabase.rpc("admin_terminate_session", {
      p_session_id: session.id,
      p_reason: "terminated_from_admin_panel",
    });
    setBusyRequest(null);

    if (error) {
      toast.error("Decision failed", { description: error.message });
      return;
    }

    notify("warning", "Session terminated", `Session ${session.id.slice(0, 8)} was terminated by admin.`);
    void load();
  }

  async function savePolicy() {
    if (!user) return;
    setPolicySaving(true);

    const payload = {
      auto_deny_outside_business_hours: policy.auto_deny_outside_business_hours,
      business_hours_start: policy.business_hours_start,
      business_hours_end: policy.business_hours_end,
      require_two_step_sensitive_nodes: policy.require_two_step_sensitive_nodes,
      sensitive_node_ids: policy.sensitive_node_ids_csv
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      max_session_duration_by_role: {
        user: Number(policy.max_session_user_minutes),
        admin: Number(policy.max_session_admin_minutes),
      },
      updated_by: user.id,
    };

    const q = policyId
      ? supabase.from("admin_access_policies").update(payload).eq("id", policyId).select("id").single()
      : supabase.from("admin_access_policies").insert(payload).select("id").single();

    const { data, error } = await q;
    setPolicySaving(false);

    if (error) {
      notify("error", "Policy save failed", error.message);
      return;
    }

    if (data?.id) setPolicyId(data.id);
    notify("success", "Policy updated", "Admin access policy settings were saved.");
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

  function exportAuditReport(format: "csv" | "json") {
    setAuditExporting(format);

    const reportRows = audit.filter((a) =>
      a.action.includes("approve") || a.action.includes("deny") || a.action.includes("revoke") || a.action.includes("terminate"),
    );

    const payload = stringifyExport(format, reportRows);
    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([payload], { type: mime });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `audit-approval-report-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
    setAuditExporting(null);

    notify("success", "Audit report exported", `Downloaded ${reportRows.length} ${format.toUpperCase()} records.`);
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review approval queue, enforce access policy settings, and control live sessions.
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Policy settings</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="auto-deny">Auto-deny outside business hours</Label>
              <Switch
                id="auto-deny"
                checked={policy.auto_deny_outside_business_hours}
                onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, auto_deny_outside_business_hours: checked }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Business start</Label>
                <Input
                  type="time"
                  value={policy.business_hours_start}
                  onChange={(e) => setPolicy((prev) => ({ ...prev, business_hours_start: e.target.value }))}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Business end</Label>
                <Input
                  type="time"
                  value={policy.business_hours_end}
                  onChange={(e) => setPolicy((prev) => ({ ...prev, business_hours_end: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="two-step">Require two-step approval for sensitive nodes</Label>
              <Switch
                id="two-step"
                checked={policy.require_two_step_sensitive_nodes}
                onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, require_two_step_sensitive_nodes: checked }))}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Sensitive node IDs (comma-separated)</Label>
              <Input
                value={policy.sensitive_node_ids_csv}
                onChange={(e) => setPolicy((prev) => ({ ...prev, sensitive_node_ids_csv: e.target.value }))}
                placeholder="node-a1, node-b3"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3 md:col-span-2">
            <Label className="text-xs text-muted-foreground">Max session duration by role (minutes)</Label>
            <div className="grid grid-cols-2 gap-2 md:max-w-md">
              <Input
                type="number"
                min={1}
                value={policy.max_session_user_minutes}
                onChange={(e) => setPolicy((prev) => ({ ...prev, max_session_user_minutes: Number(e.target.value) }))}
                placeholder="User minutes"
              />
              <Input
                type="number"
                min={1}
                value={policy.max_session_admin_minutes}
                onChange={(e) => setPolicy((prev) => ({ ...prev, max_session_admin_minutes: Number(e.target.value) }))}
                placeholder="Admin minutes"
              />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={savePolicy} disabled={policySaving}>
            <ShieldCheck className="size-4" /> {policySaving ? "Saving..." : "Save policy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <BellRing className="size-4 text-warning" />
          <h2 className="text-sm font-semibold">Notification feed</h2>
          <Badge variant="outline" className="font-mono">{notifications.length}</Badge>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ListTodo className="size-4 text-warning" />
          <h2 className="text-sm font-semibold">Pending request queue</h2>
          <Badge variant="outline" className="font-mono">{pending.length}</Badge>
        </div>
        {loading ? (
          <RouteLoadingState label="Loading pending access requests" />
        ) : pending.length === 0 ? (
          <RouteEmptyState title="No pending requests." description="New approvals will appear here in real time." />
        ) : (
          <div className="divide-y divide-border">
            {pending.map((r) => {
              const requester = requesterMap[r.requester_id];
              const deniedCount = deniedAttemptMap[`${r.requester_id}:${r.node_id}`] ?? 0;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><UserCircle2 className="size-3.5" />{requester?.email ?? r.requester_identity ?? r.requester_id.slice(0, 8)}</span>
                      <Badge variant="secondary" className="text-[10px]">role: {requester?.role ?? "unknown"}</Badge>
                      <span className="inline-flex items-center gap-1"><Globe className="size-3.5" />{r.location_hint ?? "IP/geo unavailable"}</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      req · {r.id.slice(0, 8)} · {new Date(r.requested_at).toLocaleTimeString()} · prior denied attempts: {deniedCount}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void decide(r, "denied")}> 
                      <X className="size-4" /> Deny
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void decide(r, "approved", "once")}> 
                      <Check className="size-4" /> Approve once
                    </Button>
                    <Button size="sm" onClick={() => void decide(r, "approved", "timed")}> 
                      <Clock3 className="size-4" /> Approve 15 min
                    </Button>
                  </div>
                </div>
              );
            })}
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
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">Requester: {requesterMap[r.requester_id]?.email ?? r.requester_identity ?? r.requester_id.slice(0, 8)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    req · {r.id.slice(0, 8)} · exp {r.expires_at ? new Date(r.expires_at).toLocaleTimeString() : "—"}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => void decide(r, "revoked")}> 
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
                  <div className="font-mono text-muted-foreground">
                    session · {s.id.slice(0, 8)} · requester {requesterMap[s.requester_id ?? ""]?.email ?? s.requester_id?.slice(0, 8) ?? "—"}
                  </div>
                  <div className="font-mono text-muted-foreground">started {new Date(s.started_at).toLocaleString()} · last {new Date(s.last_seen_at).toLocaleTimeString()}</div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => void terminateSession(s)}>
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
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportIncident("json")}> 
              <Download className="size-4" /> {exporting === "json" ? "Exporting..." : "Incident JSON"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportIncident("csv")}> 
              <Download className="size-4" /> {exporting === "csv" ? "Exporting..." : "Incident CSV"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!auditExporting} onClick={() => exportAuditReport("json")}> 
              <Download className="size-4" /> {auditExporting === "json" ? "Exporting..." : "Audit JSON"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!auditExporting} onClick={() => exportAuditReport("csv")}> 
              <Download className="size-4" /> {auditExporting === "csv" ? "Exporting..." : "Audit CSV"}
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
