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

export const Route = createFileRoute("/signup")({ component: SignupPage });

const schema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
});

function SignupPage() {
  const { signUp, session } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { if (session) navigate({ to: "/" }); }, [session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ displayName, email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setBusy(true);
    const { error } = await signUp(parsed.data.email, parsed.data.password, parsed.data.displayName);
    setBusy(false);
    if (error) toast.error(error);
    else {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.id) {
        void supabase.from("audit_log").insert({
          actor_id: userData.user.id,
          action: "auth_signup",
          target: userData.user.id,
          metadata: { email: parsed.data.email },
        });
      }
      toast.success("Account created");
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
              new operator
            </div>
          </div>
        </div>
        <Card className="p-6">
          <h1 className="text-base font-semibold">Create account</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            New accounts default to <span className="font-mono">user</span> role. Admins are provisioned in Security.
          </p>
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Display name</Label>
              <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Create account
            </Button>
          </form>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            Have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
