import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { dataClient } from "@/lib/data";
import type { DesktopNode } from "@/lib/data/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/StatusDot";
import { OsIcon } from "@/components/OsIcon";
import { useAuth } from "@/lib/auth-context";
import {
  Wifi, Globe, Loader2, ShieldAlert, RefreshCw, Server,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nodes, setNodes] = React.useState<DesktopNode[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [lanMode, setLanMode] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setNodes(await dataClient.listNodes());
    } catch (e) {
      toast.error((e as Error).message);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const unsub = dataClient.subscribe((evt) => {
      if (evt.table === "desktop_nodes") load();
    });
    return () => unsub();
  }, [load]);

  async function localAccess(node: DesktopNode) {
    toast.success(`Local connection initiated to ${node.local_ip}`, {
      description: `Routing through LAN to ${node.name}`,
    });
    navigate({ to: "/nodes/$id/session", params: { id: node.id } });
  }

  async function requestRemote(node: DesktopNode) {
    if (!user) return;
    setBusyId(node.id);
    const { data, error } = await dataClient.createAccessRequest(node.id);
    setBusyId(null);
    if (error || !data) { toast.error(error ?? "Failed to create request"); return; }
    toast.info("Access request sent", { description: "Awaiting admin approval…" });
    navigate({ to: "/requests/$id", params: { id: data.id } });
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
        <div className="flex items-center gap-2">
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

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : nodes.length === 0 ? (
        <Card className="p-10 text-center">
          <Server className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No registered nodes yet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((n) => (
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
                  {lanMode ? (
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={n.status !== "online"}
                      onClick={() => localAccess(n)}
                    >
                      <Wifi className="size-4" /> Local Access
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      disabled={busyId === n.id || n.status !== "online"}
                      onClick={() => requestRemote(n)}
                    >
                      {busyId === n.id ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                      Request Remote Access
                    </Button>
                  )}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {n.status === "online" ? "READY" : "OFFLINE"}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
