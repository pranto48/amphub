import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Activity,
  Ban,
  BellRing,
  Check,
  Clock3,
  Download,
  Globe,
  ListTodo,
  Loader2,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserCircle2,
  X,
  Monitor,
  Edit,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { backendMode, dataClient } from "@/lib/data";
import type { DesktopNode } from "@/lib/data/types";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin")({ component: AdminPanel });

type ReqStatus = "pending" | "approved" | "denied" | "revoked" | "expired";
type Severity = "info" | "success" | "warning" | "error";
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
  started_at: string;
  last_seen_at: string;
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
  const { user, isAdmin, session } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = React.useState<ReqRow[]>([]);
  const [approved, setApproved] = React.useState<ReqRow[]>([]);
  const [audit, setAudit] = React.useState<Audit[]>([]);
  const [sessions, setSessions] = React.useState<ActiveSession[]>([]);
  const [nodeMap, setNodeMap] = React.useState<Record<string, string>>({});
  const [requesterMap, setRequesterMap] = React.useState<Record<string, RequesterInfo>>({});
  const [clients, setClients] = React.useState<DesktopNode[]>([]);

  // Client customization & ban modal states
  const [customizingClient, setCustomizingClient] = React.useState<DesktopNode | null>(null);
  const [customName, setCustomName] = React.useState("");
  const [customRemoteId, setCustomRemoteId] = React.useState("");
  const [banningClient, setBanningClient] = React.useState<DesktopNode | null>(null);
  const [banTimeframe, setBanTimeframe] = React.useState("30m");
  const [customBanDate, setCustomBanDate] = React.useState("");
  const [customBanTime, setCustomBanTime] = React.useState("12:00");
  const [banBusy, setBanBusy] = React.useState(false);
  const [editBusy, setEditBusy] = React.useState(false);

  async function handleSaveCustomize() {
    if (!customizingClient) return;
    setEditBusy(true);
    try {
      const updates = {
        name: customName,
        remote_id: customRemoteId,
      };
      const { error } = await dataClient.updateNode(customizingClient.id, updates);
      if (error) throw new Error(error);
      notify("success", "Client updated", `Custom name and client ID saved successfully.`);
      setCustomizingClient(null);
      await load();
    } catch (e) {
      notify("error", "Failed to update client", (e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }

  async function handleSaveBan() {
    if (!banningClient) return;
    setBanBusy(true);
    try {
      let banned_until: string | null = null;
      if (banTimeframe === "30m") {
        banned_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      } else if (banTimeframe === "2h") {
        banned_until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      } else if (banTimeframe === "24h") {
        banned_until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      } else if (banTimeframe === "7d") {
        banned_until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (banTimeframe === "permanent") {
        banned_until = new Date("2099-12-31T23:59:59Z").toISOString();
      } else if (banTimeframe === "custom") {
        if (!customBanDate || !customBanTime) {
          throw new Error("Please select a valid custom date and time.");
        }
        banned_until = new Date(`${customBanDate}T${customBanTime}`).toISOString();
      } else if (banTimeframe === "lift") {
        banned_until = null;
      }

      const { error } = await dataClient.updateNode(banningClient.id, { banned_until });
      if (error) throw new Error(error);

      if (banned_until) {
        notify("warning", "Client Banned", `Remote access for this client has been restricted until ${new Date(banned_until).toLocaleString()}.`);
      } else {
        notify("success", "Client Unbanned", `Banned status lifted. Client is now open for remote connections.`);
      }
      setBanningClient(null);
      await load();
    } catch (e) {
      notify("error", "Failed to update ban status", (e as Error).message);
    } finally {
      setBanBusy(false);
    }
  }

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

  // System updates state
  const [systemStatus, setSystemStatus] = React.useState<{
    current_commit: string;
    remote_commit: string;
    update_available: "UPDATE_AVAILABLE" | "UP_TO_DATE";
    last_checked: string | null;
    auto_update_enabled: boolean;
  } | null>(null);
  const [checkingUpdates, setCheckingUpdates] = React.useState(false);
  const [triggeringUpdate, setTriggeringUpdate] = React.useState(false);
  const [showUpdateModal, setShowUpdateModal] = React.useState(false);
  const [updateCountdown, setUpdateCountdown] = React.useState<number | null>(null);

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

  const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

  const fetchSystemStatus = React.useCallback(async (isManual = false) => {
    if (isManual) setCheckingUpdates(true);
    try {
      const token = session?.access_token || localStorage.getItem("remoteops_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`${API_BASE}/v1/system/status`, { headers });
      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(errMsg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSystemStatus(data);
      if (isManual) {
        notify("success", "Update check complete", data.update_available === "UPDATE_AVAILABLE" ? "New version is available!" : "System is up to date.");
      }
    } catch (err) {
      console.error("Error fetching system status:", err);
      if (isManual) {
        notify("error", "Check failed", (err as Error).message);
      }
    } finally {
      if (isManual) setCheckingUpdates(false);
    }
  }, [session, notify, API_BASE]);

  const toggleAutoUpdateMode = async (enabled: boolean) => {
    try {
      const token = session?.access_token || localStorage.getItem("remoteops_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`${API_BASE}/v1/system/auto-update`, {
        method: "POST",
        headers,
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(errMsg || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSystemStatus(prev => prev ? { ...prev, auto_update_enabled: data.autoUpdateEnabled } : null);
      notify("success", "Auto-Update Settings Saved", `Automatic daily updates are now ${data.autoUpdateEnabled ? "enabled" : "disabled"}.`);
    } catch (err) {
      console.error("Failed to toggle auto update:", err);
      notify("error", "Failed to update settings", (err as Error).message);
    }
  };

  const handleTriggerUpdate = async () => {
    setShowUpdateModal(false);
    setTriggeringUpdate(true);
    setUpdateCountdown(30);
    try {
      const token = session?.access_token || localStorage.getItem("remoteops_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`${API_BASE}/v1/system/trigger-update`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(errMsg || `HTTP ${res.status}`);
      }
      notify("success", "Update Triggered", "The system update has been scheduled and the service is rebuilding.");
    } catch (err) {
      console.error("Failed to trigger update:", err);
      notify("error", "Update trigger failed", (err as Error).message);
      setTriggeringUpdate(false);
      setUpdateCountdown(null);
    }
  };

  React.useEffect(() => {
    if (!isAdmin) {
      navigate({ to: "/" });
    } else {
      fetchSystemStatus();
    }
  }, [isAdmin, navigate, fetchSystemStatus]);

  React.useEffect(() => {
    if (updateCountdown === null) return;
    if (updateCountdown <= 0) {
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => {
      setUpdateCountdown(prev => prev !== null ? prev - 1 : null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [updateCountdown]);

  const loadPolicy = React.useCallback(async () => {
    const isRest = backendMode === "rest";
    if (isRest) {
      try {
        const token = session?.access_token || localStorage.getItem("remoteops_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/v1/admin/policies`, { headers });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        const data = await res.json();
        
        const roleDuration = (data.max_session_duration_by_role ?? {}) as Record<string, number>;
        setPolicyId(data.id);
        setPolicy({
          auto_deny_outside_business_hours: !!data.auto_deny_outside_business_hours,
          business_hours_start: data.business_hours_start,
          business_hours_end: data.business_hours_end,
          require_two_step_sensitive_nodes: !!data.require_two_step_sensitive_nodes,
          sensitive_node_ids_csv: (data.sensitive_node_ids ?? []).join(", "),
          max_session_user_minutes: Number(roleDuration.user ?? DEFAULT_POLICY.max_session_user_minutes),
          max_session_admin_minutes: Number(roleDuration.admin ?? DEFAULT_POLICY.max_session_admin_minutes),
        });
      } catch (err) {
        notify("warning", "Policy load warning", (err as Error).message);
      }
      return;
    }

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
  }, [notify, API_BASE, session]);

  const load = React.useCallback(async () => {
    setLoading(true);
    const isRest = backendMode === "rest";

    if (isRest) {
      try {
        const token = session?.access_token || localStorage.getItem("remoteops_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const [nodesRes, reqsRes, activeRes, auditRes] = await Promise.all([
          fetch(`${API_BASE}/nodes`, { headers }).then(r => r.json() as Promise<any[]>),
          fetch(`${API_BASE}/access-requests`, { headers }).then(r => r.json() as Promise<any[]>),
          fetch(`${API_BASE}/v1/sessions/active`, { headers }).then(r => r.json() as Promise<any[]>),
          fetch(`${API_BASE}/audit?limit=250`, { headers }).then(r => r.json() as Promise<any[]>),
        ]);

        const nodeMapping = Object.fromEntries((nodesRes || []).map((n: any) => [n.id || n.remote_id, n.name]));

        const allRequests: ReqRow[] = (reqsRes || []).map((r: any) => ({
          id: r.id,
          node_id: r.node_id || r.nodeId,
          requester_id: r.requester_id || r.requesterId,
          requester_identity: r.requester_identity || r.requesterIdentity || null,
          node_name: r.node_name || r.nodeName || nodeMapping[r.node_id || r.nodeId] || null,
          location_hint: r.location_hint || r.locationHint || null,
          status: (r.status || "pending").toLowerCase() as any,
          requested_at: r.requested_at || r.requestedAt,
          expires_at: r.expires_at || r.expiresAt || null,
        }));

        const allSessions: ActiveSession[] = (activeRes || []).map((s: any) => ({
          id: s.id,
          node_id: s.client_id || s.clientId,
          requester_id: s.metadata?.controllerId || null,
          started_at: s.requested_at || s.requestedAt,
          last_seen_at: s.expires_at || s.expiresAt || s.requested_at || s.requestedAt,
        }));

        const auditLogs: Audit[] = (auditRes || []).map((a: any) => ({
          id: a.id,
          action: a.action,
          event_type: a.event_type || a.eventType || null,
          target: a.target || null,
          actor_id: a.actor_id || a.actorId || null,
          metadata: typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata || null,
          created_at: a.created_at || a.createdAt,
        }));

        let userMapping: Record<string, RequesterInfo> = {};
        try {
          const usersRes = await fetch(`${API_BASE}/v1/admin/users`, { headers }).then(r => r.json() as Promise<any[]>);
          userMapping = Object.fromEntries(
            (usersRes || []).map((u: any) => [
              u.id,
              { email: u.email, role: (u.role || "user") as any } satisfies RequesterInfo
            ])
          );
        } catch (e) {
          console.warn("Failed to load user mapping in admin REST mode:", e);
        }

        setPending(allRequests.filter((r) => r.status === "pending"));
        setApproved(allRequests.filter((r) => r.status === "approved"));
        setNodeMap(nodeMapping);
        setClients((nodesRes || []) as DesktopNode[]);
        setAudit(auditLogs);
        setSessions(allSessions);
        setRequesterMap(userMapping);
        setLoading(false);
      } catch (err: any) {
        notify("error", "REST Load Failed", err.message);
        setLoading(false);
      }
      return;
    }

    const auditQuery = supabase
      .from("audit_log")
      .select("id,action,event_type,target,actor_id,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(250);

    const [{ data: reqs }, { data: nodes }, { data: a }, { data: s }] = await Promise.all([
      supabase
        .from("access_requests")
        .select("id,node_id,requester_id,requester_identity,node_name,location_hint,status,requested_at,expires_at")
        .in("status", ["pending", "approved"])
        .order("requested_at", { ascending: false }),
      supabase.from("desktop_nodes").select("*").order("name"),
      auditFilter === "all" ? auditQuery : auditQuery.eq("event_type", auditFilter),
      supabase
        .from("active_sessions")
        .select("id,node_id,requester_id,started_at,last_seen_at")
        .is("ended_at", null)
        .is("terminated_at", null)
        .order("started_at", { ascending: false }),
    ]);

    const allRequests = (reqs ?? []) as ReqRow[];
    const allSessions = (s ?? []) as ActiveSession[];

    const requesterIds = Array.from(new Set([
      ...allRequests.map((r) => r.requester_id),
      ...(allSessions.map((session) => session.requester_id).filter(Boolean) as string[]),
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

    setPending(allRequests.filter((r) => r.status === "pending"));
    setApproved(allRequests.filter((r) => r.status === "approved"));
    setNodeMap(Object.fromEntries((nodes ?? []).map((n: { id: string; name: string }) => [n.id, n.name])));
    setClients((nodes ?? []) as DesktopNode[]);
    setAudit((a ?? []) as Audit[]);
    setSessions(allSessions);
    setRequesterMap(requesterLookup);
    setLoading(false);
  }, [auditFilter]);

  React.useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([load(), loadPolicy()]);
  }, [isAdmin, load, loadPolicy]);

  async function decide(r: ReqRow, status: Extract<ReqStatus, "approved" | "denied" | "revoked">, mode: "once" | "timed" = "once") {
    if (!user) return;
    setDecisionBusyId(r.id);
    const isRest = backendMode === "rest";

    if (isRest) {
      try {
        const token = session?.access_token || localStorage.getItem("remoteops_token");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const approve = status === "approved";
        const res = await fetch(`${API_BASE}/access-requests/${r.id}/decision`, {
          method: "POST",
          headers,
          body: JSON.stringify({ approve })
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        
        notify("success", "Decision saved", `${status.toUpperCase()} saved for node.`);
        await load();
      } catch (err: any) {
        notify("error", "Decision failed", err.message);
      } finally {
        setDecisionBusyId(null);
      }
      return;
    }

    const expiresAt = status !== "approved" ? null : mode === "timed" ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;

    const { error } = await supabase
      .from("access_requests")
      .update({
        status,
        expires_at: expiresAt,
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq("id", r.id);

    setDecisionBusyId(null);
    if (error) {
      notify("error", "Decision failed", error.message);
      return;
    }

    notify("success", "Request updated", `${status.toUpperCase()} saved for ${r.node_name ?? r.node_id?.slice(0, 8) ?? ""}.`);
    await load();
  }

  async function terminateSession(sessionItem: ActiveSession) {
    if (!user) return;
    setSessionBusyId(sessionItem.id);
    const isRest = backendMode === "rest";

    if (isRest) {
      try {
        const token = session?.access_token || localStorage.getItem("remoteops_token");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE}/v1/sessions/revoke`, {
          method: "POST",
          headers,
          body: JSON.stringify({ requestId: sessionItem.id })
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        
        notify("warning", "Session terminated", `Session ${sessionItem.id?.slice(0, 8) ?? ""} was terminated.`);
        await load();
      } catch (err: any) {
        notify("error", "Terminate failed", err.message);
      } finally {
        setSessionBusyId(null);
      }
      return;
    }

    const { error } = await supabase
      .from("active_sessions")
      .update({
        terminated_at: new Date().toISOString(),
        terminated_by: user.id,
        termination_reason: "admin_forced_terminate",
      })
      .eq("id", sessionItem.id)
      .is("ended_at", null)
      .is("terminated_at", null);

    setSessionBusyId(null);
    if (error) {
      notify("error", "Terminate failed", error.message);
      return;
    }

    notify("warning", "Session terminated", `Session ${sessionItem.id?.slice(0, 8) ?? ""} was terminated.`);
    await load();
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

    const isRest = backendMode === "rest";
    if (isRest) {
      try {
        const token = session?.access_token || localStorage.getItem("remoteops_token");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/v1/admin/policies`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
        const data = await res.json();
        if (data?.id) setPolicyId(data.id);
        notify("success", "Policy updated", "Admin access policy settings were saved.");
      } catch (err) {
        notify("error", "Policy save failed", (err as Error).message);
      } finally {
        setPolicySaving(false);
      }
      return;
    }

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

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([load(), loadPolicy()]);
    setRefreshing(false);
  }

  async function exportIncident(format: "csv" | "json") {
    if (backendMode === "rest") {
      exportAuditReport(format);
      return;
    }
    setExporting(format);
    const { data, error } = await supabase.rpc("export_incident_review", {
      p_format: format,
      p_event_type: auditFilter === "all" ? undefined : auditFilter,
    });
    if (error) {
      notify("error", "Export failed", error.message);
    } else if (data) {
      const mime = format === "json" ? "application/json" : "text/csv";
      const blob = new Blob([data as string], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incident_export_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    setExporting(null);
  }

  function exportAuditReport(format: "csv" | "json") {
    setAuditExporting(format);
    try {
      const data = stringifyExport(format, audit);
      const mime = format === "json" ? "application/json" : "text/csv";
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit_report_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      notify("error", "Export failed", (e as Error).message);
    }
    setAuditExporting(null);
  }

  React.useEffect(() => {
    if (!isAdmin) return;
    const isRest = backendMode === "rest";

    if (isRest) {
      const unsub = dataClient.subscribe((event) => {
        void load();
      });
      return () => {
        unsub();
      };
    }

    const channel = supabase
      .channel("admin-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "access_requests" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "active_sessions" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, load]);

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

      {/* Connected Windows AMPHUB Clients */}
      <Card className="p-4" id="amphub-clients-list">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Connected Windows AMPHUB Clients</h2>
            <Badge variant="outline" className="font-mono">{clients.length}</Badge>
          </div>
          <span className="text-[11px] text-muted-foreground">AnyDesk-style Client Renaming & Access Banning</span>
        </div>

        {clients.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No registered clients found.</div>
        ) : (
          <div className="divide-y divide-border border rounded-lg overflow-hidden bg-card/40">
            {clients.map((c) => {
              const isBanned = c.banned_until && new Date(c.banned_until) > new Date();
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 p-3 hover:bg-muted/20 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{c.name}</span>
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {c.remote_id}
                      </span>
                      {isBanned && (
                        <Badge variant="destructive" className="text-[10px] font-semibold bg-red-950/60 text-red-400 border border-red-500/20">
                          Banned
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>OS: <span className="font-medium text-foreground capitalize">{c.os}</span></span>
                      <span>IP: <span className="font-mono text-foreground">{c.local_ip || "—"}</span></span>
                      {isBanned && (
                        <span className="text-red-400">
                          Banned until: {new Date(c.banned_until!).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="mr-2">
                      <Badge variant="outline" className={`font-semibold capitalize text-[10px] ${c.status === "online" ? "bg-emerald-950/30 text-emerald-400 border-emerald-500/30" : "bg-zinc-950/30 text-zinc-400 border-zinc-500/30"}`}>
                        {c.status}
                      </Badge>
                    </span>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCustomizingClient(c);
                        setCustomName(c.name);
                        setCustomRemoteId(c.remote_id);
                      }}
                      aria-label={`Customize settings for client ${c.name}`}
                    >
                      <Edit className="size-3.5 mr-1" /> Rename / ID
                    </Button>

                    <Button
                      size="sm"
                      variant={isBanned ? "outline" : "destructive"}
                      onClick={() => {
                        setBanningClient(c);
                        setBanTimeframe(isBanned ? "lift" : "30m");
                      }}
                      aria-label={`Ban settings for client ${c.name}`}
                    >
                      <Ban className="size-3.5 mr-1" /> Ban Settings
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Customize Client Name / ID Dialog */}
      <Dialog open={!!customizingClient} onOpenChange={(open) => !open && setCustomizingClient(null)}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-animated-accent">Customize Client Connection Settings</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Modify the public-facing AnyDesk-style client ID and custom display name for this client node.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Client Name (Alias)</Label>
              <Input
                id="edit-name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Office-PC-1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-remote-id">Client Remote ID</Label>
              <Input
                id="edit-remote-id"
                value={customRemoteId}
                onChange={(e) => setCustomRemoteId(e.target.value)}
                placeholder="e.g. 847-291-563"
              />
              <span className="text-[10px] text-muted-foreground block">
                Must be formatted with 9 digits and hyphens (e.g. 123-456-789).
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCustomizingClient(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveCustomize} disabled={editBusy}>
              {editBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Check className="size-4 mr-1" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban Client Dialog */}
      <Dialog open={!!banningClient} onOpenChange={(open) => !open && setBanningClient(null)}>
        <DialogContent className="max-w-md bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-animated-accent">Restrict Client Remote Access</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Ban or lift restrictions for this client. Banned clients cannot be selected or accessed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="ban-timeframe">Select Ban Duration</Label>
              <select
                id="ban-timeframe"
                value={banTimeframe}
                onChange={(e) => setBanTimeframe(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="30m">30 Minutes</option>
                <option value="2h">2 Hours</option>
                <option value="24h">24 Hours</option>
                <option value="7d">7 Days</option>
                <option value="permanent">Permanent / Indefinite</option>
                <option value="custom">Custom Date & Time</option>
                <option value="lift">Lift Ban / Active</option>
              </select>
            </div>

            {banTimeframe === "custom" && (
              <div className="grid grid-cols-2 gap-3 p-3 border rounded-lg bg-muted/30">
                <div className="space-y-1">
                  <Label htmlFor="custom-ban-date" className="text-xs">End Date</Label>
                  <Input
                    id="custom-ban-date"
                    type="date"
                    value={customBanDate}
                    onChange={(e) => setCustomBanDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-ban-time" className="text-xs">End Time</Label>
                  <Input
                    id="custom-ban-time"
                    type="time"
                    value={customBanTime}
                    onChange={(e) => setCustomBanTime(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBanningClient(null)}>
              Cancel
            </Button>
            <Button
              variant={banTimeframe === "lift" ? "default" : "destructive"}
              size="sm"
              onClick={handleSaveBan}
              disabled={banBusy}
            >
              {banBusy ? <Loader2 className="size-4 animate-spin mr-1" /> : <Ban className="size-4 mr-1" />}
              {banTimeframe === "lift" ? "Lift Ban Status" : "Enforce Ban"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className={`size-4 text-primary ${checkingUpdates ? "animate-spin" : ""}`} />
            <h2 className="text-sm font-semibold">System updates</h2>
          </div>
          {systemStatus?.update_available === "UPDATE_AVAILABLE" ? (
            <Badge variant="destructive" className="animate-pulse bg-red-600 text-white font-semibold">
              New Version Available!
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-emerald-950/30 text-emerald-400 border-emerald-500/30">
              Up to Date
            </Badge>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Version:</span>
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                  {systemStatus?.current_commit ? systemStatus.current_commit.slice(0, 7) : "Checking..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remote Version:</span>
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                  {systemStatus?.remote_commit ? systemStatus.remote_commit.slice(0, 7) : "Checking..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Checked:</span>
                <span className="text-[11px] text-muted-foreground">
                  {systemStatus?.last_checked ? new Date(systemStatus.last_checked).toLocaleString() : "Never"}
                </span>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void fetchSystemStatus(true)}
                disabled={checkingUpdates}
                className="w-full flex items-center justify-center gap-1.5"
              >
                {checkingUpdates ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Check for Updates
              </Button>
            </div>
          </div>

          <div className="space-y-4 rounded-md border border-border p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <Label htmlFor="auto-update-toggle" className="text-sm font-medium">Auto-Update Mode</Label>
                <p className="text-[11px] text-muted-foreground">Automatically check for updates and run self-updates daily.</p>
              </div>
              <Switch
                id="auto-update-toggle"
                checked={systemStatus?.auto_update_enabled ?? false}
                onCheckedChange={(checked) => void toggleAutoUpdateMode(checked)}
                aria-label="Toggle auto update mode"
              />
            </div>

            <div className="pt-2">
              <Button
                size="sm"
                variant={systemStatus?.update_available === "UPDATE_AVAILABLE" ? "default" : "secondary"}
                onClick={() => setShowUpdateModal(true)}
                className="w-full flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Update and Restart Amphub
              </Button>
            </div>
          </div>
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
                    <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id?.slice(0, 8) ?? ""}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><UserCircle2 className="size-3.5" />{requester?.email ?? r.requester_identity ?? r.requester_id?.slice(0, 8) ?? ""}</span>
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
                    <div className="text-sm font-medium">{r.node_name ?? nodeMap[r.node_id] ?? r.node_id?.slice(0, 8) ?? ""}</div>
                    <div className="text-xs text-muted-foreground">Requester: {requesterMap[r.requester_id]?.email ?? r.requester_identity ?? r.requester_id?.slice(0, 8) ?? ""}</div>
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
                    <div className="text-sm font-medium">{nodeMap[s.node_id] ?? s.node_id?.slice(0, 8) ?? ""}</div>
                    <div className="font-mono text-muted-foreground">session · {s.id?.slice(0, 8) ?? ""} · requester {requesterMap[s.requester_id ?? ""]?.email ?? s.requester_id?.slice(0, 8) ?? "—"}</div>
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

      {showUpdateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold tracking-tight text-animated-accent mb-2">Confirm Update & Restart</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              <span className="text-amber-500 font-semibold block mb-1">Warning:</span>
              This will pull the latest Git changes from the repository, rebuild the Docker container, and restart the service. Remote access may briefly disconnect.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowUpdateModal(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleTriggerUpdate()}>
                Confirm Update
              </Button>
            </div>
          </div>
        </div>
      )}

      {triggeringUpdate && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="text-center space-y-4 max-w-sm px-4">
            <Loader2 className="size-12 animate-spin text-primary mx-auto" />
            <h3 className="text-xl font-bold tracking-tight">Triggering System Update...</h3>
            <p className="text-sm text-muted-foreground">
              Rebuilding the Docker container and restarting the service. Please wait while the system updates.
            </p>
            <div className="text-2xl font-mono font-semibold text-animated-accent">
              Refreshing page in {updateCountdown}s
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
