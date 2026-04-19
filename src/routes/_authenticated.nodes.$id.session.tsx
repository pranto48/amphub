import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Power,
  Maximize2,
  Keyboard,
  ShieldAlert,
  Loader2,
  CircleDashed,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  MockStreamAdapter,
  WebRTCGatewayAdapter,
} from "@/lib/streaming/adapters";
import type {
  ConnectionState,
  RemoteStreamAdapter,
  StreamStats,
} from "@/lib/streaming/remote-stream-adapter";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
  }),
  component: RemoteSession,
});

type ViewerState =
  | "pending-approval"
  | "denied"
  | "expired"
  | "connecting"
  | "connected"
  | "agent-offline";

function RemoteSession() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [viewerState, setViewerState] = React.useState<ViewerState>("pending-approval");
  const [connectionState, setConnectionState] = React.useState<ConnectionState>("disconnected");
  const [stats, setStats] = React.useState<StreamStats>({ latencyMs: null, fps: null, lastFrameAt: null });

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const adapterRef = React.useRef<RemoteStreamAdapter | null>(null);

  const isAuthorized = viewerState === "connecting" || viewerState === "connected" || viewerState === "agent-offline";

  React.useEffect(() => {
    supabase
      .from("desktop_nodes")
      .select("name")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setName(data?.name ?? "node");
        setLoading(false);
      });
  }, [id]);

  React.useEffect(() => {
    let cancelled = false;

    async function checkAccess() {
      if (search.local) {
        if (!cancelled) {
          setViewerState("connecting");
          setAuthChecked(true);
        }
        return;
      }

      if (!user || !search.requestId) {
        if (!cancelled) {
          setViewerState("pending-approval");
          setAuthChecked(true);
        }
        return;
      }

      const { data } = await supabase
        .from("access_requests")
        .select("status,expires_at,session_token")
        .eq("id", search.requestId)
        .eq("node_id", id)
        .eq("requester_id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (!data || data.status === "denied" || data.status === "revoked") {
        setViewerState("denied");
        setAuthChecked(true);
        return;
      }

      if (data.status !== "approved" || !data.session_token || !data.expires_at) {
        setViewerState("pending-approval");
        setAuthChecked(true);
        return;
      }

      if (new Date(data.expires_at).getTime() <= Date.now()) {
        setViewerState("expired");
        setAuthChecked(true);
        return;
      }

      setViewerState("connecting");
      setAuthChecked(true);
    }

    checkAccess();
    return () => {
      cancelled = true;
    };
  }, [id, search.local, search.requestId, user]);

  React.useEffect(() => {
    if (!authChecked || !isAuthorized) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const adapter: RemoteStreamAdapter = search.local
      ? new MockStreamAdapter(
          (state) => {
            setConnectionState(state);
            if (state === "connecting" || state === "reconnecting") setViewerState("connecting");
            if (state === "connected") setViewerState("connected");
            if (state === "failed") setViewerState("agent-offline");
          },
          () => {
            if (!adapterRef.current) return;
            setStats(adapterRef.current.getStats());
          },
        )
      : new WebRTCGatewayAdapter((state) => {
          setConnectionState(state);
          if (state === "connecting" || state === "reconnecting") setViewerState("connecting");
          if (state === "connected") setViewerState("connected");
          if (state === "failed") setViewerState("agent-offline");
        });

    adapterRef.current = adapter;

    const syncSize = () => {
      void adapter.resize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(container);

    const onFullScreenChange = () => syncSize();
    document.addEventListener("fullscreenchange", onFullScreenChange);
    window.addEventListener("resize", syncSize);

    let mounted = true;

    adapter
      .connect({
        canvas,
        nodeId: id,
        local: !!search.local,
        requestId: search.requestId,
      })
      .then(syncSize)
      .catch(() => {
        if (mounted) setViewerState("agent-offline");
      });

    const statsHandle = window.setInterval(() => {
      if (!adapterRef.current) return;
      setStats(adapterRef.current.getStats());
    }, 500);

    return () => {
      mounted = false;
      window.clearInterval(statsHandle);
      resizeObserver.disconnect();
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      window.removeEventListener("resize", syncSize);
      void adapter.disconnect("route_cleanup");
      adapterRef.current = null;
    };
  }, [authChecked, id, isAuthorized, search.local, search.requestId]);

  const sendPointer = React.useCallback(
    async (event: React.MouseEvent<HTMLCanvasElement>, pressed?: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas || !adapterRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      await adapterRef.current.sendInput({
        type: "pointer",
        x,
        y,
        button: event.button,
        pressed,
      });
    },
    [],
  );

  async function sendKey(event: React.KeyboardEvent<HTMLCanvasElement>, pressed: boolean) {
    if (!adapterRef.current) return;
    const key = event.key.length === 1 ? event.key : event.code;
    await adapterRef.current.sendInput({ type: "key", key, pressed });
    event.preventDefault();
  }

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
      p_metadata: { node_name: name, command: "ctrl_alt_del" },
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
    adapterRef.current = null;

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

  if (loading || !authChecked) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    const stateMessage: Record<Exclude<ViewerState, "connecting" | "connected" | "agent-offline">, { title: string; message: string }> = {
      "pending-approval": {
        title: "Pending approval",
        message: "Request access and wait for an admin to approve before streaming can start.",
      },
      denied: {
        title: "Session denied",
        message: "This access request is denied or revoked. Submit a new request if you still need access.",
      },
      expired: {
        title: "Session expired",
        message: "The approved token expired. Request a fresh approval window to reconnect.",
      },
    };

    const content = stateMessage[viewerState as Exclude<ViewerState, "connecting" | "connected" | "agent-offline">] ?? stateMessage["pending-approval"];

    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <ShieldAlert className="mx-auto mb-2 size-6 text-warning" />
        <div className="font-semibold text-foreground">{content.title}</div>
        <p className="mt-1">{content.message}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{name}</h1>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">live remote session</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={sendCAD}><Keyboard className="size-4" /> Ctrl+Alt+Del</Button>
          <Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="size-4" /> Fullscreen</Button>
          <Button size="sm" variant="destructive" onClick={disconnect}><Power className="size-4" /> Disconnect</Button>
        </div>
      </div>

      <Card ref={containerRef} className="relative overflow-hidden border-primary/30 p-0">
        <div className="viewer-grid relative aspect-video w-full bg-background">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="absolute inset-0 h-full w-full outline-none"
            onClick={(e) => {
              e.currentTarget.focus();
              void sendPointer(e);
            }}
            onMouseMove={(e) => void sendPointer(e)}
            onMouseDown={(e) => void sendPointer(e, true)}
            onMouseUp={(e) => void sendPointer(e, false)}
            onKeyDown={(e) => void sendKey(e, true)}
            onKeyUp={(e) => void sendKey(e, false)}
          />

          {viewerState === "connecting" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/45">
              <div className="rounded-lg border border-border bg-background/80 px-6 py-5 text-center backdrop-blur">
                <CircleDashed className="mx-auto size-8 animate-spin text-primary" />
                <div className="mt-3 text-sm font-semibold">Connecting to stream</div>
              </div>
            </div>
          )}

          {viewerState === "agent-offline" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/45">
              <div className="rounded-lg border border-border bg-background/80 px-6 py-5 text-center backdrop-blur">
                <WifiOff className="mx-auto size-8 text-warning" />
                <div className="mt-3 text-sm font-semibold">Streaming agent offline</div>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  Approval is valid, but the target has no active streaming transport. Deploy the agent from STREAMING.md.
                </p>
              </div>
            </div>
          )}

          <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
            state: {viewerState} / {connectionState}
          </div>
          <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
            fps: {stats.fps ?? "--"} · latency: {stats.latencyMs ?? "--"}ms
          </div>
        </div>
      </Card>
    </div>
  );
}
