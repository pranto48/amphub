import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { dataClient } from "@/lib/data";
import type { DesktopNode } from "@/lib/data/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FolderOpen, Monitor as MonitorIcon, ArrowLeft } from "lucide-react";
import { OsIcon } from "@/components/OsIcon";
import { StatusDot } from "@/components/StatusDot";

export const Route = createFileRoute("/_authenticated/nodes/$id/")({ component: NodeDetail });

function NodeDetail() {
  const { id } = Route.useParams();
  const [node, setNode] = React.useState<DesktopNode | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    dataClient.getNode(id).then((n) => { setNode(n); setLoading(false); });
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  if (!node) return <Card className="p-8">Node not found.</Card>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm"><Link to="/"><ArrowLeft className="size-4" /> Dashboard</Link></Button>

      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-md bg-muted">
              <OsIcon os={node.os} className="size-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{node.name}</h1>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                {node.remote_id} · {node.local_ip}
              </div>
            </div>
          </div>
          <StatusDot status={(node.status as "online" | "offline") ?? "offline"} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button asChild variant="outline">
            <Link to="/nodes/$id/files" params={{ id: node.id }}>
              <FolderOpen className="size-4" /> File Explorer
            </Link>
          </Button>
          <Button asChild>
            <Link to="/nodes/$id/session" params={{ id: node.id }}>
              <MonitorIcon className="size-4" /> Open Remote Session
            </Link>
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold">System info</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div><dt className="text-muted-foreground">OS</dt><dd className="font-mono">{node.os}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="font-mono">{node.status}</dd></div>
          <div><dt className="text-muted-foreground">Last seen</dt><dd className="font-mono">{node.last_seen ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Node ID</dt><dd className="font-mono">{node.id.slice(0, 8)}…</dd></div>
        </dl>
      </Card>
    </div>
  );
}
