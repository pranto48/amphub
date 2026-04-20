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
  password_algo: string | null;
  password_updated_at: string | null;
  password_version: number;
  failed_attempts: number;
  locked_until: string | null;
};

function SecurityPage() {
  const { isAdmin } = useAuth();
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [pwd, setPwd] = React.useState<Record<string, string>>({});
  const [confirmPwd, setConfirmPwd] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newPwd, setNewPwd] = React.useState("");
  const [confirmOwnPwd, setConfirmOwnPwd] = React.useState("");
  const [savingOwn, setSavingOwn] = React.useState(false);

  const loadNodes = React.useCallback(async () => {
    if (!isAdmin) {
      setNodes([]);
      return;
    }

    const { data, error } = await supabase
      .from("desktop_nodes")
      .select("id,name,remote_id,master_password_hash,password_algo,password_updated_at,password_version,failed_attempts,locked_until")
      .order("name");

    if (error) {
      toast.error("Failed to load node passwords", { description: error.message });
      return;
    }

    setNodes((data ?? []) as Node[]);
  }, [isAdmin]);

  React.useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  async function setMaster(node: Node) {
    const v = pwd[node.id]?.trim() ?? "";
    const parsed = z.string().min(8).max(128).safeParse(v);
    if (!parsed.success) {
      toast.error("Master password must be 8-128 chars");
      return;
    }

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

    const result = data?.[0];
    if (error || !result?.success) {
      toast.error("Failed to update master password", {
        description: result?.error_code ?? error?.message ?? "unknown_error",
      });
      return;
    }

    toast.success(`Master password updated for ${node.name}`);
    setPwd((p) => ({ ...p, [node.id]: "" }));
    setConfirmPwd((p) => ({ ...p, [node.id]: "" }));

    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id
          ? {
              ...n,
              master_password_hash: "configured",
              password_algo: result.password_algo,
              password_updated_at: result.password_updated_at,
              password_version: result.password_version ?? n.password_version,
              failed_attempts: 0,
              locked_until: null,
            }
          : n,
      ),
    );
  }

  async function changeOwn() {
    const parsed = z.string().min(8).max(128).safeParse(newPwd);
    if (!parsed.success) {
      toast.error("Password must be 8-128 chars");
      return;
    }

    if (parsed.data !== confirmOwnPwd) {
      toast.error("Password confirmation does not match");
      return;
    }

    setSavingOwn(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data });
    setSavingOwn(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated");
    setNewPwd("");
    setConfirmOwnPwd("");
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
            Stored with bcrypt + per-password salt and verified server-side with lockout and throttling controls.
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
                        Algo {n.password_algo ?? "-"} · v{n.password_version} · Updated{" "}
                        {n.password_updated_at ? new Date(n.password_updated_at).toLocaleString() : "-"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Failed attempts: {n.failed_attempts}
                        {n.locked_until ? ` · Locked until ${new Date(n.locked_until).toLocaleString()}` : ""}
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
                  <Button size="sm" onClick={() => void setMaster(n)} disabled={busy === n.id}>
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
