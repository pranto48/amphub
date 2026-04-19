import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Hourglass, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/requests/$id")({ component: RequestPage });

type Req = {
  id: string;
  node_id: string;
  status: string;
  session_token: string | null;
  expires_at: string | null;
};

function RequestPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [req, setReq] = React.useState<Req | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("access_requests")
      .select("id,node_id,status,session_token,expires_at")
      .eq("id", id)
      .maybeSingle();
    if (error) toast.error(error.message);
    setReq(data as Req | null);
    setLoading(false);
  }, [id]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const ch = supabase
      .channel(`req-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests", filter: `id=eq.${id}` },
        (payload) => {
          const next = payload.new as Req;
          setReq(next);
          if (next.status === "approved") toast.success("Access granted");
          if (next.status === "denied") toast.error("Access denied");
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
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
