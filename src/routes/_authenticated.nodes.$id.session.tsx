import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Power, Maximize2, Keyboard, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { RouteLoadingState } from "@/components/route-state";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
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
  const [denialReason, setDenialReason] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sessionStartedRef = React.useRef(false);

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

    const { data } = await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_ctrl_alt_del",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name },
    });

    const result = data?.[0];
    if (!result?.authorized) {
      toast.error("Ctrl+Alt+Del denied", { description: result?.denial_reason ?? "request_not_approved" });
      return;
    }

    toast.info("Ctrl+Alt+Del sent", { description: "Routed through approved session" });
  }

  async function disconnect() {
    await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "session_end",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { node_name: name, source: "disconnect" },
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
        p_metadata: { node_name: name, source: "unmount" },
      });
    };
  }, [authorized, id, name, search.local, search.requestId]);

  if (loading || !authChecked) return <RouteLoadingState label="Loading remote session" withSkeleton />;
  if (!authorized) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Session denied: {denialReason ?? "request_not_approved"}. This route requires LAN mode with policy guard or an approved, non-expired request token.
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
        <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto">
          <Button size="sm" variant="outline" onClick={sendCAD} aria-label="Send Ctrl Alt Del">
            <Keyboard className="size-4" aria-hidden="true" /> Ctrl+Alt+Del
          </Button>
          <Button size="sm" variant="outline" onClick={fullscreen} aria-label="Toggle fullscreen">
            <Maximize2 className="size-4" aria-hidden="true" /> Fullscreen
          </Button>
          <Button size="sm" variant="destructive" onClick={disconnect} aria-label="Disconnect session">
            <Power className="size-4" aria-hidden="true" /> Disconnect
          </Button>
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
          </div>
        </div>
      </Card>
    </div>
  );
}
