import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/StatusDot";
import { OsIcon } from "@/components/OsIcon";
import { useAuth } from "@/lib/auth-context";
import { RouteEmptyState, RouteLoadingState } from "@/components/route-state";
import {
  Wifi, Globe, Loader2, ShieldAlert, RefreshCw, Server, Search, ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

type Node = {
  id: string;
  name: string;
  remote_id: string;
  local_ip: string;
  os: string;
  status: string;
  last_seen: string | null;
  same_lan: boolean;
  lan_detection_source: string | null;
};

const REMOTE_ID_DIGITS = 9;

function canonicalizeRemoteIdInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, REMOTE_ID_DIGITS);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeRemoteIdForLookup(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== REMOTE_ID_DIGITS) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function parsePrivateIPv4(value: string | null | undefined): string | null {
  if (!value) return null;
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = value.match(ipv4Pattern);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return null;

  if (parts[0] === 10) return value;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return value;
  if (parts[0] === 192 && parts[1] === 168) return value;
  if (parts[0] === 169 && parts[1] === 254) return value;
  return null;
}

function getRequesterNetworkHints() {
  if (typeof window === "undefined") return { requesterIp: null as string | null, hints: [] as string[] };

  const hostnameHint = parsePrivateIPv4(window.location.hostname);
  const persistedHints = window.localStorage.getItem("amphub.requester_network_hints");
  const splitHints = (persistedHints ?? "")
    .split(",")
    .map((hint) => hint.trim())
    .filter(Boolean);

  const normalizedHints = Array.from(new Set(
    [hostnameHint, ...splitHints]
      .map((hint) => parsePrivateIPv4(hint))
      .filter((hint): hint is string => Boolean(hint)),
  ));

  return {
    requesterIp: hostnameHint,
    hints: normalizedHints,
  };
}

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [lanMode, setLanMode] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [remoteLookup, setRemoteLookup] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    const { requesterIp, hints } = getRequesterNetworkHints();

    const { data, error } = await supabase
      .rpc("dashboard_nodes_with_lan", {
        p_requester_ip: requesterIp,
        p_requester_hints: hints,
      });

    if (error) toast.error(error.message);
    setNodes((data ?? []) as Node[]);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const ch = supabase
      .channel("nodes-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "desktop_nodes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function auditModeDecision(node: Node, effectiveLocal: boolean) {
    const overrideDiffers = lanMode !== node.same_lan;
    const { requesterIp, hints } = getRequesterNetworkHints();

    await supabase.rpc("audit_access_mode_decision", {
      p_node_id: node.id,
      p_detected_same_lan: node.same_lan,
      p_manual_lan_mode: lanMode,
      p_effective_mode: effectiveLocal ? "local_lan" : "remote_request",
      p_detection_source: node.lan_detection_source,
      p_requester_hints: requesterIp ? Array.from(new Set([requesterIp, ...hints])) : hints,
      p_override_differs: overrideDiffers,
    });
  }

  async function localAccess(node: Node) {
    toast.success(`Local connection initiated to ${node.local_ip}`, {
      description: `Routing through LAN to ${node.name}`,
    });
    navigate({ to: "/nodes/$id/session", params: { id: node.id }, search: { local: true } });
  }

  async function requestRemote(node: Node) {
    if (!user) return;
    setBusyId(node.id);
    const { data, error } = await supabase
      .from("access_requests")
      .insert({
        node_id: node.id,
        requester_id: user.id,
        status: "pending",
        requester_identity: user.user_metadata?.display_name ?? user.email ?? user.id,
        node_name: node.name,
        location_hint: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      })
      .select()
      .single();
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.info("Access request sent", { description: `Request created for ${node.name}. Awaiting admin approval…` });
    navigate({ to: "/requests/$id", params: { id: data.id } });
  }

  async function quickConnect() {
    const normalized = normalizeRemoteIdForLookup(remoteLookup);
    if (!normalized) {
      toast.error("Invalid Remote ID", { description: "Remote ID must use the ###-###-### format." });
      return;
    }

    const { data, error } = await supabase.rpc("lookup_node_by_remote_id", {
      p_remote_id: normalized,
    });

    if (error) {
      toast.error("Remote lookup failed", { description: error.message });
      return;
    }

    const matched = (data ?? [])[0];
    if (!matched?.node_id) {
      toast.error("Remote ID not found", { description: "Check the node's Remote ID and try again." });
      return;
    }

    if (matched.status !== "online") {
      toast.warning("Node offline", { description: "This node is currently offline and cannot accept requests." });
      return;
    }

    const node = nodes.find((n) => n.id === matched.node_id);
    if (!node) {
      toast.error("Node unavailable", { description: "Node exists, but is not currently visible in your dashboard." });
      return;
    }

    requestRemote(node);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Desktop Nodes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered remote desktops · {nodes.length} total ·{" "}
            {nodes.filter((n) => n.status === "online").length} online
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant={lanMode ? "default" : "outline"}
            size="sm"
            onClick={() => setLanMode((v) => !v)}
          >
            {lanMode ? <Wifi className="size-4" /> : <Globe className="size-4" />}
            {lanMode ? "LAN mode" : "Remote mode"}
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Remote ID access</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              AnyDesk-style access request using a node Remote ID.
            </p>
          </div>
          <div className="flex w-full max-w-lg items-center gap-2">
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              value={remoteLookup}
              onChange={(e) => setRemoteLookup(canonicalizeRemoteIdInput(e.target.value))}
              placeholder="e.g. 847-291-563"
            />
            <Button size="sm" variant="secondary" onClick={quickConnect}>
              <Search className="size-4" /> Request Access
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <RouteLoadingState label="Loading dashboard nodes" withSkeleton />
      ) : nodes.length === 0 ? (
        <RouteEmptyState
          icon={Server}
          title="No registered nodes yet."
          description="Add a node to start local or approval-gated remote sessions."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((n) => {
            const overrideDiffers = lanMode !== n.same_lan;
            const effectiveLocal = lanMode && n.same_lan;

            return (
              <Card key={n.id} className="overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <OsIcon os={n.os} className="size-4 text-primary" />
                    <div>
                      <div className="text-sm font-medium">{n.name}</div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {n.os}
                      </div>
                    </div>
                  </div>
                  <StatusDot status={(n.status as "online" | "offline") ?? "offline"} />
                </div>

                <div className="space-y-3 p-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Remote ID</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <ShieldAlert className="size-3 text-accent" />
                        <span className="font-mono text-foreground">{n.remote_id}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Local IP</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Wifi className="size-3 text-primary" />
                        <span className="font-mono text-foreground">{n.local_ip}</span>
                      </div>
                    </div>
                  </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={n.status !== "online" || !lanMode}
                    onClick={() => localAccess(n)}
                  >
                    <Wifi className="size-4" /> Local Access
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    disabled={busyId === n.id || n.status !== "online"}
                    onClick={() => requestRemote(n)}
                  >
                    {busyId === n.id ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
                    Remote Access
                  </Button>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {n.status === "online" ? "READY" : "OFFLINE"}
                  </Badge>
                </div>
                {!lanMode && (
                  <div className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 font-mono text-[10px] text-warning">
                    Remote mode enabled: local-connect path disabled.
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
