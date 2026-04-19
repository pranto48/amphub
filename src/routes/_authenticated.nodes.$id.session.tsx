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
import { canAccessApprovedSession } from "@/lib/session-access";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
    sessionToken: z.string().min(1).optional(),
  }),
  component: RemoteSession,
});

function RemoteSession() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [authorized, setAuthorized] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

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
    checkAccess();
    return () => { cancelled = true; };
  }, [id, search.local, search.requestId, user]);

  React.useEffect(() => {
    if (!authorized) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 1280;
    canvas.height = 720;
    ctx.fillStyle = "#07090f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(48, 48, canvas.width - 96, canvas.height - 96);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "600 24px Inter, system-ui, sans-serif";
    ctx.fillText("Secure Remote Session", 90, 110);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`Node: ${name}`, 90, 150);
    ctx.fillText(`Transport: ${search.local ? "LAN Direct" : "Approval-Gated Remote Token"}`, 90, 176);
    ctx.fillText("Streaming pipeline placeholder (WebRTC/RDP/VNC bridge)", 90, 204);
  }, [authorized, name, search.local]);

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
      p_requester_id: user?.id ?? null,
      p_session_token: search.sessionToken ?? null,
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
      p_requester_id: user?.id ?? null,
      p_session_token: search.sessionToken ?? null,
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
          <div className="absolute inset-0 flex items-center justify-center bg-background/45">
            <div className="rounded-lg border border-border bg-background/80 px-6 py-5 text-center backdrop-blur">
              <ShieldAlert className="mx-auto size-8 text-warning" />
              <div className="mt-3 text-sm font-semibold">Streaming agent not connected</div>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Approval-gated session token is valid. To render an actual desktop stream, deploy a streaming agent (RDP/VNC/WebRTC) on the target host. See <span className="font-mono text-primary">STREAMING.md</span> for integration paths.
              </p>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                target · {name}
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
