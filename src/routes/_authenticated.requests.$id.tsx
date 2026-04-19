import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Hourglass, CheckCircle2, XCircle, ArrowRight, Ban, TimerOff,
} from "lucide-react";
import { toast } from "sonner";
import { RouteLoadingState } from "@/components/route-state";

export const Route = createFileRoute("/_authenticated/requests/$id")({ component: RequestPage });

type ReqStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

type Req = {
  id: string;
  node_id: string;
  status: ReqStatus;
  session_token: string | null;
  expires_at: string | null;
  request_reason: string | null;
  status_reason_code: string | null;
  status_reason_message: string | null;
  pending_expires_at: string | null;
};

function RequestPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [req, setReq] = React.useState<Req | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    await supabase.rpc("expire_access_requests");
    const { data, error } = await supabase
      .from("access_requests")
      .select("id,node_id,status,session_token,expires_at,request_reason,status_reason_code,status_reason_message,pending_expires_at")
      .eq("id", id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setReq(data as Req | null);
    setLoading(false);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const refresh = window.setInterval(load, 30_000);
    const ch = supabase
      .channel(`req-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests", filter: `id=eq.${id}` },
        (payload) => {
          const next = payload.new as Req;
          setReq(next);
          if (next.status === "approved") toast.success("Access granted");
          if (next.status === "denied") toast.error("Access denied");
          if (next.status === "revoked") toast.error("Approval revoked");
          if (next.status === "expired") {
            if (next.status_reason_code === "pending_timeout") {
              toast.warning("Request expired", { description: "No admin decision arrived before timeout." });
            } else {
              toast.warning("Approval expired");
            }
          }
        })
      .subscribe();
    return () => {
      window.clearInterval(refresh);
      supabase.removeChannel(ch);
    };
  }, [id, load]);

  if (loading) return <RouteLoadingState label="Loading access request" withSkeleton />;
  if (!req) return <Card className="p-8">Request not found.</Card>;

  const expiredByTtl = req.status === "approved" && req.expires_at && new Date(req.expires_at).getTime() <= Date.now();

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
            {req.request_reason && <p className="mt-2 text-xs text-muted-foreground">Reason: {req.request_reason}</p>}
            {req.pending_expires_at && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Auto-expires at {new Date(req.pending_expires_at).toLocaleTimeString()}
              </p>
            )}
            <div className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              request id · {req.id.slice(0, 8)}
            </div>
          </>
        )}
        {req.status === "approved" && !expiredByTtl && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Access granted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Session token issued with strict TTL. Launch before it expires.
            </p>
            <Button
              className="mt-5"
              onClick={() => navigate({
                to: "/nodes/$id/session",
                params: { id: req.node_id },
                search: { requestId: req.id, sessionToken: req.session_token ?? undefined },
              })}
            >
              Launch session <ArrowRight className="size-4" />
            </Button>
          </>
        )}
        {(req.status === "expired" || expiredByTtl) && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <TimerOff className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Approval expired</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This approval token is no longer valid. Submit a new request to continue.
            </p>
            <Button asChild variant="outline" className="mt-5"><Link to="/">Back to dashboard</Link></Button>
          </>
        )}
        {req.status === "revoked" && (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <Ban className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Approval revoked</h2>
            <p className="mt-1 text-sm text-muted-foreground">An administrator revoked this approval and invalidated the token.</p>
            <Button asChild variant="outline" className="mt-5"><Link to="/">Back to dashboard</Link></Button>
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
        {req.status_reason_code && (
          <div className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-left">
            <div className="font-mono text-[10px] uppercase text-muted-foreground">Reason code · {req.status_reason_code}</div>
            {req.status_reason_message && <div className="mt-1 text-xs text-muted-foreground">{req.status_reason_message}</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
