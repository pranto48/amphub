import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/security")({ component: SecurityPage });

type Node = {
  id: string;
  name: string;
  remote_id: string;
  master_password_hash: string | null;
  updated_at: string;
};

function passwordStrength(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score <= 2) return { label: "Weak", className: "text-destructive" };
  if (score <= 4) return { label: "Moderate", className: "text-warning" };
  return { label: "Strong", className: "text-primary" };
}

function SecurityPage() {
  const { isAdmin } = useAuth();
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [pwd, setPwd] = React.useState<Record<string, string>>({});
  const [confirmPwd, setConfirmPwd] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmOwnPwd, setConfirmOwnPwd] = React.useState("");
  const [savingOwn, setSavingOwn] = React.useState(false);
  const [lastOwnUpdateAt, setLastOwnUpdateAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isAdmin) {
      supabase.from("desktop_nodes").select("id,name,remote_id,master_password_hash,updated_at").order("name").then(({ data }) => {
        setNodes((data ?? []) as Node[]);
      });
  }, [isAdmin]);

  React.useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  async function setMaster(node: Node) {
    const v = pwd[node.id]?.trim() ?? "";
    const parsed = z.string().min(8).max(128).safeParse(v);
    if (!parsed.success) { toast.error("Master password must be 8–128 chars"); return; }
    if (parsed.data !== (confirmPwd[node.id]?.trim() ?? "")) {
      toast.error("Master password confirmation does not match");
      return;
    }
    setBusy(node.id);
    const { data, error } = await supabase.rpc("set_node_master_password", {
      p_node_id: node.id,
      p_password: parsed.data,
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success(`Master password updated for ${node.name}`);
      setPwd((p) => ({ ...p, [node.id]: "" }));
      setConfirmPwd((p) => ({ ...p, [node.id]: "" }));
      setNodes((prev) => prev.map((n) => (n.id === node.id ? { ...n, master_password_hash: hash, updated_at: new Date().toISOString() } : n)));
    }
  }

  async function changeOwn() {
    const parsed = z.string().min(8).max(128).safeParse(newPwd);
    if (!parsed.success) { toast.error("Password must be 8–128 chars"); return; }
    if (parsed.data !== confirmOwnPwd) { toast.error("Password confirmation does not match"); return; }
    setSavingOwn(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    setSavingOwn(false);
    if (error) toast.error(error.message);
    else { toast.success("Password updated"); setNewPwd(""); setConfirmOwnPwd(""); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage credentials and per-node master passwords.</p>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Lock className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Change your password</h2>
        </div>
        <div className="grid max-w-xl gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="newpwd">New password</Label>
            <Input id="newpwd" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmOwnPwd">Confirm password</Label>
            <Input id="confirmOwnPwd" type="password" value={confirmOwnPwd} onChange={(e) => setConfirmOwnPwd(e.target.value)} />
          </div>
          <Button onClick={changeOwn} disabled={savingOwn}>
            {savingOwn && <Loader2 className="size-4 animate-spin" />} Update
          </Button>
        </div>
      </Card>

      {isAdmin && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">Per-node master passwords</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Stored with bcrypt KDF and verified server-side with rate limits + lockouts.
          </p>
          <div className="space-y-3">
            {nodes.map((n) => (
              <div key={n.id} className="space-y-3 rounded-md border border-border p-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{n.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{n.remote_id}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {n.master_password_hash ? "Configured" : "Not set"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Updated {new Date(n.updated_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <Input
                    type="password"
                    placeholder="New master password"
                    value={pwd[n.id] ?? ""}
                    onChange={(e) => setPwd((p) => ({ ...p, [n.id]: e.target.value }))}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm master password"
                    value={confirmPwd[n.id] ?? ""}
                    onChange={(e) => setConfirmPwd((p) => ({ ...p, [n.id]: e.target.value }))}
                  />
                  <Button size="sm" onClick={() => setMaster(n)} disabled={busy === n.id}>
                    {busy === n.id ? <Loader2 className="size-4 animate-spin" /> : "Set"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
