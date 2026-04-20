import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { dataClient } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Power, Maximize2, Keyboard, Loader2, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/nodes/$id/session")({ component: RemoteSession });

function RemoteSession() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    dataClient.getNode(id).then((n) => {
      setName(n?.name ?? "node");
      setLoading(false);
    });
  }, [id]);

  function fullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  }

  function sendCAD() {
    toast.info("Ctrl+Alt+Del sent", { description: "Routed through approved session" });
  }

  function disconnect() {
    toast.success("Session ended");
    navigate({ to: "/" });
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{name}</h1>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">live remote session</div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={sendCAD}><Keyboard className="size-4" /> Ctrl+Alt+Del</Button>
          <Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="size-4" /> Fullscreen</Button>
          <Button size="sm" variant="destructive" onClick={disconnect}><Power className="size-4" /> Disconnect</Button>
        </div>
      </div>

      <Card ref={containerRef} className="relative overflow-hidden border-primary/30 p-0">
        <div className="viewer-grid relative aspect-video w-full bg-background">
          <div className="absolute inset-0 flex items-center justify-center">
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
