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
  password_algo: string | null;
  password_updated_at: string | null;
  password_version: number | null;
  failed_attempts: number | null;
  locked_until: string | null;
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
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmNewPwd, setConfirmNewPwd] = React.useState("");
  const [savingOwn, setSavingOwn] = React.useState(false);
  const [lastOwnUpdateAt, setLastOwnUpdateAt] = React.useState<string | null>(null);

  const ownStrength = React.useMemo(() => passwordStrength(newPwd), [newPwd]);

  const loadNodes = React.useCallback(() => {
    if (!isAdmin) return;
    supabase
      .from("desktop_nodes")
      .select("id,name,remote_id,password_algo,password_updated_at,password_version,failed_attempts,locked_until")
      .order("name")
      .then(({ data }) => {
        setNodes((data ?? []) as Node[]);
      });
  }, [isAdmin]);

  React.useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  async function setMaster(node: Node) {
    const v = pwd[node.id]?.trim() ?? "";
    const parsed = z.string().min(8).max(128).safeParse(v);
    if (!parsed.success) {
      toast.error("Master password must be 8–128 chars");
      return;
    }

    setBusy(node.id);
    const { data, error } = await supabase.rpc("set_node_master_password", {
      p_node_id: node.id,
      p_password: parsed.data,
    });
    setBusy(null);

    const result = data?.[0];
    if (error) {
      toast.error(error.message);
      return;
    }

    if (!result?.success) {
      toast.error("Password update failed", { description: result?.error_code ?? "unknown_error" });
      return;
    }

    toast.success(`Master password updated for ${node.name}`, {
      description: `Algorithm: ${result.password_algo} · Version ${result.password_version}`,
    });
    setPwd((p) => ({ ...p, [node.id]: "" }));
    loadNodes();
  }

  async function changeOwn() {
    const parsed = z.string().min(8).max(128).safeParse(newPwd);
    if (!parsed.success) {
      toast.error("Password must be 8–128 chars");
      return;
    }
    if (newPwd !== confirmNewPwd) {
      toast.error("Passwords do not match", { description: "Please confirm your new password." });
      return;
    }

    setSavingOwn(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    setSavingOwn(false);
    if (error) {
      toast.error("Password update failed", { description: error.message });
    } else {
      const nowIso = new Date().toISOString();
      setLastOwnUpdateAt(nowIso);
      toast.success("Password updated", { description: "Your account password was changed successfully." });
      setNewPwd("");
      setConfirmNewPwd("");
    }
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
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="newpwd">New password</Label>
            <Input id="newpwd" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-newpwd">Confirm new password</Label>
            <Input
              id="confirm-newpwd"
              type="password"
              value={confirmNewPwd}
              onChange={(e) => setConfirmNewPwd(e.target.value)}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Strength: <span className={ownStrength.className}>{ownStrength.label}</span>
          </div>
          {lastOwnUpdateAt && (
            <div className="text-xs text-muted-foreground">
              Last updated: {new Date(lastOwnUpdateAt).toLocaleString()}
            </div>
          )}
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
              <div key={n.id} className="rounded-md border border-border p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{n.name}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{n.remote_id}</div>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <div>Algo: {n.password_algo ?? "not_set"}</div>
                    <div>Version: {n.password_version ?? 0}</div>
                    <div>Updated: {n.password_updated_at ? new Date(n.password_updated_at).toLocaleString() : "never"}</div>
                    {n.locked_until && (
                      <div className="text-destructive">Locked until: {new Date(n.locked_until).toLocaleTimeString()}</div>
                    )}
                    {!!n.failed_attempts && n.failed_attempts > 0 && <div>Failed attempts: {n.failed_attempts}</div>}
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <Input
                    type="password"
                    placeholder="New master password"
                    value={pwd[n.id] ?? ""}
                    onChange={(e) => setPwd((p) => ({ ...p, [n.id]: e.target.value }))}
                    className="max-w-xs"
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
