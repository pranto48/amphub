import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { dataClient } from "@/lib/data";
import type { AccessRequest } from "@/lib/data/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Hourglass, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/requests/$id")({ component: RequestPage });

function RequestPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [req, setReq] = React.useState<AccessRequest | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      setReq(await dataClient.getAccessRequest(id));
    } catch (e) { toast.error((e as Error).message); }
    setLoading(false);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const unsub = dataClient.subscribe((evt) => {
      if (evt.table === "access_requests" && evt.row.id === id) {
        setReq(evt.row);
        if (evt.row.status === "approved") toast.success("Access granted");
        if (evt.row.status === "denied") toast.error("Access denied");
      }
    });
    return () => unsub();
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  if (!req) return <Card className="p-8">Request not found.</Card>;

  return (
    <div className="mx-auto max-w-lg">
      <Card className="p-8 text-center">
        {req.status === "pending" && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Hourglass className="size-6 animate-pulse" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Awaiting admin approval</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              An administrator has been notified. This page will update automatically.
            </p>
            <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              request id · {req.id.slice(0, 8)}
            </div>
          </>
        )}
        {req.status === "approved" && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Access granted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Session token issued. You may launch the remote session now.
            </p>
            <Button className="mt-5" onClick={() => navigate({ to: "/nodes/$id/session", params: { id: req.node_id } })}>
              Launch session <ArrowRight className="size-4" />
            </Button>
          </>
        )}
        {req.status === "denied" && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <XCircle className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Access denied</h2>
            <p className="mt-1 text-sm text-muted-foreground">An administrator rejected this request.</p>
            <Button asChild variant="outline" className="mt-5"><Link to="/">Back to dashboard</Link></Button>
          </>
        )}
      </Card>
    </div>
  );
}
