import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Server, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
});

function LoginPage() {
  const { signIn, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const loginFingerprint = React.useMemo(() => {
    if (typeof window === "undefined") return "server";
    return `${window.navigator.userAgent}|${window.location.hostname}`;
  }, []);

  React.useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setBusy(true);

    const throttle = await supabase.rpc("guard_auth_login_attempt", {
      p_identifier: parsed.data.email,
      p_client_fingerprint: loginFingerprint,
    });
    const throttleResult = throttle.data?.[0];
    if (!throttleResult?.allowed) {
      setBusy(false);
      toast.error("Login temporarily blocked", {
        description: throttleResult?.locked_until
          ? `Too many failed attempts. Retry after ${new Date(throttleResult.locked_until).toLocaleTimeString()}.`
          : throttleResult?.denial_reason ?? "rate_limited",
      });
      return;
    }

    const { error } = await signIn(parsed.data.email, parsed.data.password);
    setBusy(false);
    if (error) toast.error(error);
    else {
      void supabase.rpc("mark_auth_login_success", {
        p_identifier: parsed.data.email,
        p_client_fingerprint: loginFingerprint,
      });
      const { data: userData } = await supabase.auth.getUser();
      void supabase.from("audit_log").insert({
        actor_id: userData.user?.id,
        action: "auth_login",
        target: userData.user?.id ?? null,
        metadata: { email: parsed.data.email },
      });
      toast.success("Authenticated");
      navigate({ to: "/" });
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Server className="size-5" />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">RemoteOps</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              secure access console
            </div>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="text-base font-semibold">Sign in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Authenticate to access the remote desktop control plane.
          </p>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Sign in
            </Button>
          </form>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            No account? <Link to="/signup" className="text-primary hover:underline">Create one</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
