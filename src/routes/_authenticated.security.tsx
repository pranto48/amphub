import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dataClient } from "@/lib/data";
import type { DesktopNode } from "@/lib/data/types";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/security")({ component: SecurityPage });

async function hashPassword(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function SecurityPage() {
  const { isAdmin } = useAuth();
  const [nodes, setNodes] = React.useState<DesktopNode[]>([]);
  const [pwd, setPwd] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [newPwd, setNewPwd] = React.useState("");
  const [savingOwn, setSavingOwn] = React.useState(false);

  React.useEffect(() => {
    if (isAdmin) dataClient.listNodes().then(setNodes).catch((e) => toast.error((e as Error).message));
  }, [isAdmin]);

  async function setMaster(node: DesktopNode) {
    const v = pwd[node.id]?.trim() ?? "";
    const parsed = z.string().min(8).max(128).safeParse(v);
    if (!parsed.success) { toast.error("Master password must be 8–128 chars"); return; }
    setBusy(node.id);
    const hash = await hashPassword(parsed.data);
    const { error } = await dataClient.setNodeMasterPassword(node.id, hash);
    setBusy(null);
    if (error) toast.error(error);
    else { toast.success(`Master password updated for ${node.name}`); setPwd((p) => ({ ...p, [node.id]: "" })); }
  }

  async function changeOwn() {
    const parsed = z.string().min(8).max(128).safeParse(newPwd);
    if (!parsed.success) { toast.error("Password must be 8–128 chars"); return; }
    setSavingOwn(true);
    const { error } = await dataClient.updatePassword(parsed.data);
    setSavingOwn(false);
    if (error) toast.error(error);
    else { toast.success("Password updated"); setNewPwd(""); }
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
        <div className="flex max-w-md items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="newpwd">New password</Label>
            <Input id="newpwd" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
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
            Stored as SHA-256 hashes. Used to gate elevated actions on each desktop node.
          </p>
          <div className="space-y-3">
            {nodes.map((n) => (
              <div key={n.id} className="flex items-end gap-3 rounded-md border border-border p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{n.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{n.remote_id}</div>
                </div>
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
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
