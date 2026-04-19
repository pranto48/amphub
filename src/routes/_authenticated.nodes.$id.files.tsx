import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Folder, FolderPlus, Upload, Download, Trash2,
  FileText, FileImage, FileCode, FileArchive, File as FileIcon, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { canAccessApprovedSession } from "@/lib/session-access";

export const Route = createFileRoute("/_authenticated/nodes/$id/files")({
  validateSearch: z.object({
    local: z.coerce.boolean().optional(),
    requestId: z.string().uuid().optional(),
  }),
  component: FileExplorer,
});

type Entry =
  | { kind: "folder"; name: string; children: Entry[] }
  | { kind: "file"; name: string; size: number; type: "text" | "image" | "code" | "archive" | "binary" };

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(["txt", "md", "json", "csv", "png", "jpg", "jpeg", "zip", "pdf", "ts", "tsx"]);
const BLOCKED_UPLOAD_EXTENSIONS = new Set(["exe", "dll", "bat", "sh", "js", "msi", "scr", "com"]);

function seed(): Entry[] {
  return [
    { kind: "folder", name: "Documents", children: [
      { kind: "file", name: "report-q4.pdf", size: 218000, type: "text" },
      { kind: "file", name: "budget.xlsx", size: 51200, type: "text" },
      { kind: "folder", name: "Contracts", children: [
        { kind: "file", name: "vendor-agreement.docx", size: 31200, type: "text" },
      ]},
    ]},
    { kind: "folder", name: "Downloads", children: [
      { kind: "file", name: "installer.zip", size: 18400000, type: "archive" },
      { kind: "file", name: "screenshot.png", size: 412000, type: "image" },
    ]},
    { kind: "folder", name: "Projects", children: [
      { kind: "file", name: "main.ts", size: 4200, type: "code" },
      { kind: "file", name: "config.json", size: 1100, type: "code" },
    ]},
    { kind: "folder", name: "System32", children: [
      { kind: "file", name: "kernel.dll", size: 2400000, type: "binary" },
    ]},
  ];
}

function fileIcon(type: string) {
  const cls = "size-4";
  if (type === "image") return <FileImage className={`${cls} text-accent`} />;
  if (type === "code") return <FileCode className={`${cls} text-primary`} />;
  if (type === "archive") return <FileArchive className={`${cls} text-warning`} />;
  if (type === "text") return <FileText className={`${cls} text-foreground/80`} />;
  return <FileIcon className={`${cls} text-muted-foreground`} />;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function getDir(tree: Entry[], path: string[]): Entry[] {
  let cur = tree;
  for (const seg of path) {
    const f = cur.find((e): e is Extract<Entry, { kind: "folder" }> => e.kind === "folder" && e.name === seg);
    if (!f) return [];
    cur = f.children;
  }
  return cur;
}

function extOf(name: string) {
  const segs = name.toLowerCase().split(".");
  return segs.length > 1 ? segs.pop() ?? "" : "";
}

async function runMalwareScanPlaceholder(file: File) {
  await Promise.resolve(file);
  return { clean: true, reason: null as string | null };
}

function FileExplorer() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const { user, isAdmin } = useAuth();
  const [nodeName, setNodeName] = React.useState<string>("");
  const [tree, setTree] = React.useState<Entry[]>(() => seed());
  const [path, setPath] = React.useState<string[]>([]);
  const [newFolder, setNewFolder] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [authorized, setAuthorized] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);

  React.useEffect(() => {
    supabase.from("desktop_nodes").select("name").eq("id", id).maybeSingle().then(({ data }) => {
      setNodeName(data?.name ?? "");
      setLoading(false);
    });
  }, [id]);

  React.useEffect(() => {
    let cancelled = false;
    async function checkAccess() {
      if (search.local) {
        if (!cancelled) {
          setAuthorized(true);
          setAuthChecked(true);
        }
        return;
      }
      if (!user || !search.requestId) {
        if (!cancelled) {
          setAuthorized(false);
          setAuthChecked(true);
        }
        return;
      }
      const ok = await canAccessApprovedSession({
        requestId: search.requestId,
        nodeId: id,
        userId: user.id,
      });
      if (!cancelled) {
        setAuthorized(ok);
        setAuthChecked(true);
      }
    }
    checkAccess();
    return () => { cancelled = true; };
  }, [id, search.local, search.requestId, user]);

  const current = getDir(tree, path);
  const canCreateFolder = isAdmin;
  const canUpload = true;
  const canDelete = isAdmin;

  function mutateAt(nextPath: string[], updater: (entries: Entry[]) => Entry[]) {
    function rec(entries: Entry[], depth: number): Entry[] {
      if (depth === nextPath.length) return updater(entries);
      return entries.map((e) =>
        e.kind === "folder" && e.name === nextPath[depth]
          ? { ...e, children: rec(e.children, depth + 1) }
          : e,
      );
    }
    setTree((t) => rec(t, 0));
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    if (current.some((e) => e.name === name)) { toast.error("Name already exists"); return; }

    const { data } = await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action: "file_create_folder",
      p_request_id: search.requestId ?? null,
      p_local: search.local ?? false,
      p_metadata: { path, name },
    });
    const result = data?.[0];
    if (!result?.authorized) {
      toast.error("Create folder denied", { description: result?.denial_reason ?? "request_not_approved" });
      return;
    }

    mutateAt(path, (entries) => [...entries, { kind: "folder", name, children: [] }]);
    setNewFolder("");
    toast.success(`Folder “${name}” created`);
  }

  async function uploadFile() {
    const { data } = await supabase.rpc("record_privileged_event", {
      p_node_id: id,
      p_action,
      p_request_id: search.requestId ?? null,
      p_requester_id: user.id,
      p_session_token: search.sessionToken ?? null,
      p_local: search.local ?? false,
      p_metadata,
    });
    return data?.[0] ?? { authorized: false, denial_reason: "request_not_approved" };
  }

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    if (current.some((e) => e.name === name)) {
      toast.error("Name already exists");
      return;
    }

    setActiveOp("create-folder");
    const result = await recordAction("file_create_folder", { path, name });
    if (!result.authorized) {
      toast.error("Create folder denied", { description: result.denial_reason ?? "request_not_approved" });
      setActiveOp(null);
      return;
    }

    mutateAt(path, (entries) => [...entries, { kind: "folder", name, children: [] }]);
    setNewFolder("");
    setActiveOp(null);
    toast.success(`Folder “${name}” created`);
  }

  async function uploadFile(file: File) {
    const ext = extOf(file.name);
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Upload blocked", { description: `Maximum size is ${fmtSize(MAX_UPLOAD_BYTES)}.` });
      return;
    }
    if (BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
      toast.error("Upload blocked", { description: `.${ext} files are blocked by policy.` });
      return;
    }
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      toast.error("Upload blocked", { description: `.${ext || "unknown"} is not in the allowed extension list.` });
      return;
    }

    setActiveOp("upload");
    const malwareScan = await runMalwareScanPlaceholder(file);
    if (!malwareScan.clean) {
      toast.error("Upload blocked", { description: malwareScan.reason ?? "malware_scan_failed" });
      setActiveOp(null);
      return;
    }

    const result = await recordAction("file_upload", {
      path,
      name: file.name,
      size: file.size,
      extension: ext,
      malware_scan: "placeholder_passed",
    });
    if (!result.authorized) {
      toast.error("Upload denied", { description: result.denial_reason ?? "request_not_approved" });
      setActiveOp(null);
      return;
    }

    mutateAt(path, (entries) => [...entries, { kind: "file", name: file.name, size: file.size, type: "text" }]);
    setActiveOp(null);
    toast.success(`Uploaded ${file.name}`);
  }

  async function deleteEntry(name: string) {
    setActiveOp(`delete:${name}`);
    const result = await recordAction("file_delete", { path, name });
    if (!result.authorized) {
      toast.error("Delete denied", { description: result.denial_reason ?? "request_not_approved" });
      setActiveOp(null);
      return;
    }

    mutateAt(path, (entries) => entries.filter((e) => e.name !== name));
    setActiveOp(null);
    toast.success(`Deleted ${name}`);
  }

  async function downloadEntry(name: string) {
    setActiveOp(`download:${name}`);
    const result = await recordAction("file_download", { path, name });
    if (!result.authorized) {
      toast.error("Download denied", { description: result.denial_reason ?? "request_not_approved" });
      setActiveOp(null);
      return;
    }

    setActiveOp(null);
    toast.info(`Downloading ${name}…`, { description: "Streaming via approved session" });
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  if (!authChecked) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;
  if (!authorized) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        This file explorer requires LAN access or an approved, non-expired remote session.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/nodes/$id" params={{ id }}><ArrowLeft className="size-4" /> Node</Link>
        </Button>
        <div className="font-mono text-xs text-muted-foreground">simulated remote filesystem</div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => setPath([])} className="font-mono text-primary hover:underline">{nodeName || "node"}:</button>
          {path.map((seg, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="size-3 text-muted-foreground" />
              <button type="button" onClick={() => setPath(path.slice(0, i + 1))} className="font-mono hover:text-primary">{seg}</button>
            </React.Fragment>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="New folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            className="h-8 max-w-xs"
            disabled={!canCreateFolder || activeOp === "create-folder"}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={createFolder}
            disabled={!canCreateFolder || activeOp !== null || !newFolder.trim()}
            title={canCreateFolder ? "Create a folder" : "Only admins can create folders"}
          >
            {activeOp === "create-folder" ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />} Create
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canUpload || activeOp !== null}
            title={canUpload ? "Upload a file" : "Your role cannot upload files"}
          >
            {activeOp === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload
          </Button>
          {!canCreateFolder && (
            <div className="text-xs text-muted-foreground">Folder create/delete requires admin role.</div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void uploadFile(file);
              }
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {path.length > 0 && (
          <button
            type="button"
            onClick={() => setPath(path.slice(0, -1))}
            className="flex w-full items-center gap-2 border-b border-border px-4 py-2.5 text-sm hover:bg-muted/40"
          >
            <Folder className="size-4 text-muted-foreground" />
            <span className="font-mono">..</span>
          </button>
        )}
        {current.length === 0 && (
          <div className="p-4">
            <RouteEmptyState title="Empty directory" description="Create a folder or upload a file to get started." />
          </div>
        )}
        {current.map((e) => (
          <div key={e.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted/30">
            <button
              type="button"
              onClick={() => e.kind === "folder" && setPath([...path, e.name])}
              className="flex flex-1 items-center gap-3 text-left"
            >
              {e.kind === "folder" ? <Folder className="size-4 text-primary" /> : fileIcon(e.type)}
              <span className="font-mono text-sm">{e.name}</span>
              {e.kind === "file" && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{fmtSize(e.size)}</span>
              )}
            </button>
            <div className="flex items-center gap-1">
              {e.kind === "file" && (
                <Button size="icon" variant="ghost" className="size-7" onClick={() => downloadEntry(e.name)}>
                  <span className="sr-only">Download {e.name}</span>
                  <Download className="size-3.5" />
                </Button>
              )}
              {isAdmin && (
                <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => deleteEntry(e.name)}>
                  <span className="sr-only">Delete {e.name}</span>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive"
                onClick={() => deleteEntry(e.name)}
                disabled={!canDelete || activeOp !== null}
                title={canDelete ? "Delete" : "Only admins can delete"}
              >
                {activeOp === `delete:${e.name}` ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
