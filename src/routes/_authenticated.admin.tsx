import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { dataClient } from "@/lib/data";
import type { AccessRequest, AuditEntry } from "@/lib/data/types";
import { useAuth } from "@/lib/auth-context";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Check, X, ShieldAlert, Activity, ScrollText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPanel });

function AdminPanel() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<AccessRequest[]>([]);
  const [audit, setAudit] = React.useState<AuditEntry[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [requesterMap, setRequesterMap] = React.useState<Record<string, RequesterInfo>>({});

  const [loading, setLoading] = React.useState(true);
  const [auditFilter, setAuditFilter] = React.useState<AuditFilter>("all");
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);

  const [policyId, setPolicyId] = React.useState<string | null>(null);
  const [policySaving, setPolicySaving] = React.useState(false);
  const [policy, setPolicy] = React.useState<PolicySettings>(DEFAULT_POLICY);

  const [refreshing, setRefreshing] = React.useState(false);
  const [decisionBusyId, setDecisionBusyId] = React.useState<string | null>(null);
  const [sessionBusyId, setSessionBusyId] = React.useState<string | null>(null);
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
    try {
      const [reqs, nodes, a] = await Promise.all([
        dataClient.listPendingRequests(),
        dataClient.listNodes(),
        dataClient.listAudit(20),
      ]);
      setPending(reqs);
      setNodeMap(Object.fromEntries(nodes.map((n) => [n.id, n.name])));
      setAudit(a);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setLoading(false);
  }, [auditFilter]);

  React.useEffect(() => {
    if (!isAdmin) return;
    const unsub = dataClient.subscribe((evt) => {
      if (evt.table !== "access_requests") return;
      if (evt.type === "INSERT") {
        toast.warning("New access request", { description: "Requester awaiting approval" });
        setPending((p) => [evt.row, ...p.filter((r) => r.id !== evt.row.id)]);
      } else if (evt.type === "UPDATE") {
        load();
      }
    });
    return () => unsub();
  }, [isAdmin, load]);

  async function decide(req: AccessRequest, approve: boolean) {
    const { error } = await dataClient.decideAccessRequest(req.id, approve);
    if (error) { toast.error(error); return; }
    toast.success(approve ? "Approved" : "Denied");
    setPending((p) => p.filter((r) => r.id !== req.id));
    load();
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-animated-accent">Admin Panel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review approvals, enforce policies, and control live sessions.</p>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary" aria-label="Open security settings">
            <Link to="/security">Security Settings</Link>
          </Button>
          <Button asChild size="sm" variant="outline" aria-label="Open user settings">
            <Link to="/settings">User Settings</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refreshAll()} disabled={refreshing} aria-label="Refresh admin data">
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh data
          </Button>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">admin actions</Badge>
        </div>
      </Card>

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
                aria-label="Enable auto deny outside business hours"
                checked={policy.auto_deny_outside_business_hours}
                onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, auto_deny_outside_business_hours: checked }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="start-time">Business start</Label>
                <Input id="start-time" type="time" value={policy.business_hours_start} onChange={(e) => setPolicy((prev) => ({ ...prev, business_hours_start: e.target.value }))} />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="end-time">Business end</Label>
                <Input id="end-time" type="time" value={policy.business_hours_end} onChange={(e) => setPolicy((prev) => ({ ...prev, business_hours_end: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="two-step">Require two-step approval for sensitive nodes</Label>
              <Switch
                id="two-step"
                aria-label="Require two-step approval"
                checked={policy.require_two_step_sensitive_nodes}
                onCheckedChange={(checked) => setPolicy((prev) => ({ ...prev, require_two_step_sensitive_nodes: checked }))}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="sensitive-node-ids">Sensitive node IDs (comma-separated)</Label>
              <Input
                id="sensitive-node-ids"
                value={policy.sensitive_node_ids_csv}
                onChange={(e) => setPolicy((prev) => ({ ...prev, sensitive_node_ids_csv: e.target.value }))}
                placeholder="node-a1, node-b3"
              />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void savePolicy()} disabled={policySaving} aria-label="Save policy settings">
            {policySaving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {policySaving ? "Saving..." : "Save policy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <BellRing className="size-4 text-warning" />
          <h2 className="text-sm font-semibold">Notification feed</h2>
          <Badge variant="outline" className="font-mono">{notifications.length}</Badge>
        </div>
        {notifications.length === 0 ? (
          <RouteEmptyState title="No notifications yet." description="Admin system events will appear here." />
        ) : (
          <div className="divide-y divide-border">
            {notifications.slice(0, 8).map((n) => (
              <div key={n.id} className="py-2 text-xs">
                <div className="font-medium">{n.title}</div>
                <div className="text-muted-foreground">{n.description}</div>
              </div>
            ))}
          </div>
        )}
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
              const deciding = decisionBusyId === r.id;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><UserCircle2 className="size-3.5" />{requester?.email ?? r.requester_identity ?? r.requester_id.slice(0, 8)}</span>
                      <span className="inline-flex items-center gap-1"><Globe className="size-3.5" />{r.location_hint ?? "IP/geo unavailable"}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={deciding} onClick={() => void decide(r, "denied")} aria-label={`Deny request ${r.id}`}>
                      {deciding ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Deny
                    </Button>
                    <Button size="sm" variant="secondary" disabled={deciding} onClick={() => void decide(r, "approved", "once")} aria-label={`Approve request ${r.id} once`}>
                      {deciding ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve once
                    </Button>
                    <Button size="sm" disabled={deciding} onClick={() => void decide(r, "approved", "timed")} aria-label={`Approve request ${r.id} for 15 minutes`}>
                      {deciding ? <Loader2 className="size-4 animate-spin" /> : <Clock3 className="size-4" />} Approve 15 min
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
            {approved.map((r) => {
              const deciding = decisionBusyId === r.id;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">Requester: {requesterMap[r.requester_id]?.email ?? r.requester_identity ?? r.requester_id.slice(0, 8)}</div>
                  </div>
                  <Button size="sm" variant="destructive" disabled={deciding} onClick={() => void decide(r, "revoked")} aria-label={`Revoke request ${r.id}`}>
                    {deciding ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} Revoke
                  </Button>
                </div>
              );
            })}
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
            {sessions.map((s) => {
              const terminating = sessionBusyId === s.id;
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 text-xs">
                    <div className="text-sm font-medium">{nodeMap[s.node_id] ?? s.node_id.slice(0, 8)}</div>
                    <div className="font-mono text-muted-foreground">session · {s.id.slice(0, 8)} · requester {requesterMap[s.requester_id ?? ""]?.email ?? s.requester_id?.slice(0, 8) ?? "—"}</div>
                  </div>
                  <Button size="sm" variant="destructive" disabled={terminating} onClick={() => void terminateSession(s)} aria-label={`Terminate session ${s.id}`}>
                    {terminating ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} Terminate
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ScrollText className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter audit events"
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value as AuditFilter)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All events</option>
              <option value="auth">Auth events</option>
              <option value="approval">Approval decisions</option>
              <option value="file_ops">File operations</option>
              <option value="remote_control">Remote control commands</option>
            </select>
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportIncident("json")} aria-label="Export incident JSON">
              <Download className="size-4" /> {exporting === "json" ? "Exporting..." : "Incident JSON"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportIncident("csv")} aria-label="Export incident CSV">
              <Download className="size-4" /> {exporting === "csv" ? "Exporting..." : "Incident CSV"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!auditExporting} onClick={() => exportAuditReport("json")} aria-label="Export audit JSON">
              <Download className="size-4" /> {auditExporting === "json" ? "Exporting..." : "Audit JSON"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!auditExporting} onClick={() => exportAuditReport("csv")} aria-label="Export audit CSV">
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
                <span className="ml-auto font-mono text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
