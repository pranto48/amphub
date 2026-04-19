import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Keyboard, Loader2, Maximize2, Power } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { MockStreamAdapter } from "@/lib/streaming/adapters";
import type { ConnectionState, RemoteStreamAdapter, StreamStats } from "@/lib/streaming/remote-stream-adapter";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
  }),
  component: RemoteSession,
});

const badgeVariantByState: Record<ConnectionState, "default" | "secondary" | "outline" | "destructive"> = {
  disconnected: "outline",
  connecting: "secondary",
  connected: "default",
  reconnecting: "secondary",
  failed: "destructive",
};

function RemoteSession() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [authorized, setAuthorized] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [denialReason, setDenialReason] = React.useState<string | null>(null);
  const [connectionState, setConnectionState] = React.useState<ConnectionState>("disconnected");
  const [stats, setStats] = React.useState<StreamStats>({ latencyMs: null, fps: null, lastFrameAt: null });

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sessionStartedRef = React.useRef(false);
  const adapterRef = React.useRef<RemoteStreamAdapter | null>(null);

  React.useEffect(() => {
    supabase.from("desktop_nodes").select("name,remote_id,local_ip,os").eq("id", id).maybeSingle().then(({ data }) => {
      setName(data?.name ?? "node");
      setLoading(false);
    });
  }, [id]);

  React.useEffect(() => {
    let cancelled = false;
    async function checkAccess() {
      if (!user) {
        if (!cancelled) {
          setAuthorized(false);
          setDenialReason("request_not_approved");
          setAuthChecked(true);
        }
        return;
      }

      const { data, error } = await supabase.rpc("authorize_privileged_access", {
        p_node_id: id,
        p_request_id: search.requestId ?? null,
        p_local: search.local ?? false,
      });

      const result = data?.[0];
      const ok = !error && !!result?.authorized;
      if (!cancelled) {
        setAuthorized(ok);
        setDenialReason(result?.denial_reason ?? (error ? "request_not_approved" : null));
        setAuthChecked(true);
      }
    }
    checkAccess();
    return () => {
      cancelled = true;
    };
  }, [id, search.local, search.requestId, user]);

  React.useEffect(() => {
    if (!authorized || !canvasRef.current || !containerRef.current) return;

    let adapter: MockStreamAdapter;
    const syncStats = () => {
      if (!adapter) return;
      setStats(adapter.getStats());
    };

    adapter = new MockStreamAdapter(
      (nextState) => setConnectionState(nextState),
      syncStats,
    );
    adapterRef.current = adapter;

    const syncResize = async () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      await adapter.resize({ width, height });
      setStats(adapter.getStats());
    };

    void adapter.connect({
      canvas: canvasRef.current,
      nodeId: id,
      local: search.local ?? false,
      requestId: search.requestId,
    }).then(syncResize);

    const observer = new ResizeObserver(() => {
      void syncResize();
    });
    observer.observe(containerRef.current);

    const interval = window.setInterval(() => {
      setStats(adapter.getStats());
    }, 1000);

    const fullscreenListener = () => {
      void syncResize();
    };
    document.addEventListener("fullscreenchange", fullscreenListener);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      document.removeEventListener("fullscreenchange", fullscreenListener);
      void adapter.disconnect("unmount");
      adapterRef.current = null;
      setConnectionState("disconnected");
    };
  }, [authorized, id, search.local, search.requestId]);

  function fullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  async function sendCAD() {
    const password = window.prompt("Enter node master password for privileged control:");
    if (!password) {
      toast.error("Action canceled", { description: "Master password is required." });
      return;
    }

    const verify = await supabase.rpc("verify_node_master_password", {
      p_node_id: id,
      p_password: password,
      p_context: "session_ctrl_alt_del",
    });
    const verifyResult = verify.data?.[0];
    if (verify.error || !verifyResult?.verified) {
      toast.error("Password verification failed", {
        description: verifyResult?.error_code ?? verify.error?.message ?? "invalid_password",
      });
      return;
    }

    await adapterRef.current?.sendInput({ type: "command", command: "ctrl_alt_del" });

    const { data } = await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_ctrl_alt_del",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name, channel: "adapter_command" },
    });

    const result = data?.[0];
    if (!result?.authorized) {
      toast.error("Ctrl+Alt+Del denied", { description: result?.denial_reason ?? "request_not_approved" });
      return;
    }

    toast.info("Ctrl+Alt+Del sent", { description: "Routed through approved session" });
  }

  async function disconnect() {
    await adapterRef.current?.disconnect("user_disconnect");
    await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_end",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name, source: "disconnect", connection_state: connectionState },
    });

    toast.success("Session ended");
    navigate({ to: "/" });
  }

  React.useEffect(() => {
    if (!authorized || sessionStartedRef.current) return;
    sessionStartedRef.current = true;

    void supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_start",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name },
    });

    return () => {
      void supabase.rpc("record_privileged_event", {
        p_node_id: id,
        p_action: "session_end",
        p_request_id: search.requestId ?? null,
        p_local: search.local ?? false,
        p_metadata: { node_name: name, source: "unmount", connection_state: connectionState },
      });
    };
  }, [authorized, connectionState, id, name, search.local, search.requestId]);

  if (loading || !authChecked) {
    return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  }

  if (!authorized) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Session denied: {denialReason ?? "request_not_approved"}. This route requires LAN mode with policy guard or an approved, non-expired request token.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{name}</h1>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">live remote session</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Badge variant={badgeVariantByState[connectionState]}>{connectionState}</Badge>
          <Badge variant="outline">Latency: {stats.latencyMs ?? "--"}ms</Badge>
          <Badge variant="outline">FPS: {stats.fps ?? "--"}</Badge>
          <Button size="sm" variant="outline" onClick={sendCAD}><Keyboard className="size-4" /> Ctrl+Alt+Del</Button>
          <Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="size-4" /> Fullscreen</Button>
          <Button size="sm" variant="destructive" onClick={disconnect}><Power className="size-4" /> Disconnect</Button>
        </div>
      </div>

      <Card ref={containerRef} className="relative overflow-hidden border-primary/30 p-0">
        <div className="viewer-grid relative aspect-video w-full bg-background">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        </div>
      </Card>
    </div>
  );
}
