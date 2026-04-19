import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Power, Maximize2, Keyboard, Loader2, CircleDashed, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { canAccessApprovedSession } from "@/lib/session-access";
import type {
  ConnectionState,
  RemoteStreamAdapter,
  StreamStats,
  StreamInputMessage,
} from "@/lib/streaming/remote-stream-adapter";
import {
  MockStreamAdapter,
  RdpBridgeAdapter,
  VncBridgeAdapter,
  WebRTCGatewayAdapter,
} from "@/lib/streaming/adapters";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
    sessionToken: z.string().min(1).optional(),
  }),
  component: RemoteSession,
});

type ViewerState = "idle" | "connecting" | "live" | "agent-offline" | "error";

function RemoteSession() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [authorized, setAuthorized] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [viewerState, setViewerState] = React.useState<ViewerState>("idle");
  const [connectionState, setConnectionState] = React.useState<ConnectionState>("disconnected");
  const [stats, setStats] = React.useState<StreamStats>({ latencyMs: null, fps: null, lastFrameAt: null });
  const [sessionToken, setSessionToken] = React.useState<string | undefined>(undefined);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const adapterRef = React.useRef<RemoteStreamAdapter | null>(null);

  React.useEffect(() => {
    supabase
      .from("desktop_nodes")
      .select("name,status")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setName(data?.name ?? "node");
        if (data?.status !== "online") setViewerState("agent-offline");
        setLoading(false);
      });
  }, [id]);

  React.useEffect(() => {
    let cancelled = false;
    async function checkAccess() {
      if (search.local) {
        if (!cancelled) {
          setAuthorized(true);
          setAuthChecked(true);
        }
        return;
      }
      if (!user || !search.requestId) {
        if (!cancelled) {
          setAuthorized(false);
          setAuthChecked(true);
        }
        return;
      }
      const ok = await canAccessApprovedSession({
        requestId: search.requestId,
        nodeId: id,
        userId: user.id,
      });
      if (!cancelled) {
        setAuthorized(ok);
        setAuthChecked(true);
      }
    }
    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, [id, search.local, search.requestId, user]);

  React.useEffect(() => {
    if (!search.requestId || search.local) {
      setSessionToken(undefined);
      return;
    }
    supabase
      .from("access_requests")
      .select("session_token")
      .eq("id", search.requestId)
      .maybeSingle()
      .then(({ data }) => setSessionToken(data?.session_token ?? undefined));
  }, [search.requestId, search.local]);

  React.useEffect(() => {
    if (!authorized || !authChecked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onState = (next: ConnectionState) => {
      setConnectionState(next);
      if (next === "connecting" || next === "reconnecting") setViewerState("connecting");
      if (next === "connected") setViewerState("live");
      if (next === "failed") setViewerState("error");
      if (next === "disconnected") setViewerState("idle");
    };
    const onFrame = () => setStats(adapterRef.current?.getStats() ?? { latencyMs: null, fps: null, lastFrameAt: null });

    const adapter = search.local
      ? new MockStreamAdapter(onState, onFrame)
      : (() => {
          const hint = name.toLowerCase();
          if (hint.includes("rdp")) return new RdpBridgeAdapter(onState, onFrame);
          if (hint.includes("vnc")) return new VncBridgeAdapter(onState, onFrame);
          return new WebRTCGatewayAdapter(onState, onFrame);
        })();

    adapterRef.current = adapter;
    void adapter.connect({
      canvas,
      nodeId: id,
      local: Boolean(search.local),
      requestId: search.requestId,
      sessionToken,
    });

    const statsTimer = window.setInterval(() => {
      setStats(adapter.getStats());
    }, 1000);

    const resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      void adapter.resize({ width: box.width, height: box.height });
    });
    resizeObserver.observe(canvas);

    return () => {
      window.clearInterval(statsTimer);
      resizeObserver.disconnect();
      void adapter.disconnect("component_unmount");
      adapterRef.current = null;
    };
  }, [authorized, authChecked, id, name, search.local, search.requestId, sessionToken]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !authorized) return;

    const send = (message: StreamInputMessage) => {
      void adapterRef.current?.sendInput(message);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      send({ type: "key", key: event.code, pressed: true });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      send({ type: "key", key: event.code, pressed: false });
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / Math.max(1, rect.width);
      const y = (event.clientY - rect.top) / Math.max(1, rect.height);
      send({ type: "pointer", x, y });
    };
    const onPointerDown = (event: PointerEvent) => {
      send({ type: "pointer", x: 0, y: 0, button: event.button, pressed: true });
    };
    const onPointerUp = (event: PointerEvent) => {
      send({ type: "pointer", x: 0, y: 0, button: event.button, pressed: false });
    };
    const onWheel = (event: WheelEvent) => {
      send({ type: "wheel", dx: event.deltaX, dy: event.deltaY });
    };

    container.tabIndex = 0;
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("keyup", onKeyUp);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("wheel", onWheel);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("keyup", onKeyUp);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, [authorized]);

  function fullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
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

    await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_ctrl_alt_del",
      p_request_id: search.requestId ?? null,
      p_requester_id: user?.id ?? null,
      p_session_token: sessionToken ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name, command: "ctrl_alt_del", stream_state: viewerState },
    });

    toast.info("Ctrl+Alt+Del sent", { description: "Delivered via authenticated control channel" });
  }

  async function disconnect() {
    await adapterRef.current?.disconnect("user_disconnect");
    adapterRef.current = null;

    await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_end",
      p_request_id: search.requestId ?? null,
      p_requester_id: user?.id ?? null,
      p_session_token: sessionToken ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name, source: "disconnect", connection_state: connectionState },
    });

    toast.success("Session ended");
    navigate({ to: "/" });
  }

  if (loading || !authChecked) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  if (!authorized) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Session denied: this route requires LAN mode or an approved, non-expired request token.
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
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {viewerState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/45">
              <div className="rounded-lg border border-border bg-background/80 px-6 py-5 text-center backdrop-blur">
                {viewerState === "agent-offline" ? (
                  <WifiOff className="mx-auto size-8 text-warning" />
                ) : (
                  <CircleDashed className="mx-auto size-8 text-primary animate-spin" />
                )}
                <div className="mt-3 text-sm font-semibold">
                  {viewerState === "agent-offline"
                    ? "Streaming agent offline"
                    : viewerState === "error"
                      ? "Session signaling failed"
                      : "Negotiating stream transport"}
                </div>
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
