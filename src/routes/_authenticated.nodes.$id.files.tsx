import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Folder, FolderPlus, Upload, Download, Trash2,
  FileText, FileImage, FileCode, FileArchive, File as FileIcon, ChevronRight, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/nodes/$id/files")({ component: FileExplorer });

type Entry =
  | { kind: "folder"; name: string; children: Entry[] }
  | { kind: "file"; name: string; size: number; type: "text" | "image" | "code" | "archive" | "binary" };

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

function FileExplorer() {
  const { id } = Route.useParams();
  const { isAdmin } = useAuth();
  const [nodeName, setNodeName] = React.useState<string>("");
  const [tree, setTree] = React.useState<Entry[]>(() => seed());
  const [path, setPath] = React.useState<string[]>([]);
  const [newFolder, setNewFolder] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    supabase.from("desktop_nodes").select("name").eq("id", id).maybeSingle().then(({ data }) => {
      setNodeName(data?.name ?? "");
      setLoading(false);
    });
  }, [id]);

  const current = getDir(tree, path);

  function mutateAt(path: string[], updater: (entries: Entry[]) => Entry[]) {
    function rec(entries: Entry[], depth: number): Entry[] {
      if (depth === path.length) return updater(entries);
      return entries.map((e) =>
        e.kind === "folder" && e.name === path[depth]
          ? { ...e, children: rec(e.children, depth + 1) }
          : e
      );
    }
    setTree((t) => rec(t, 0));
  }

  function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    if (current.some((e) => e.name === name)) { toast.error("Name already exists"); return; }
    mutateAt(path, (entries) => [...entries, { kind: "folder", name, children: [] }]);
    setNewFolder("");
    toast.success(`Folder “${name}” created`);
  }

  function uploadFile() {
    const name = `upload-${Date.now()}.txt`;
    mutateAt(path, (entries) => [...entries, { kind: "file", name, size: Math.floor(Math.random() * 50000), type: "text" }]);
    toast.success(`Uploaded ${name}`);
  }

  function deleteEntry(name: string) {
    mutateAt(path, (entries) => entries.filter((e) => e.name !== name));
    toast.success(`Deleted ${name}`);
  }

  function downloadEntry(name: string) {
    toast.info(`Downloading ${name}…`, { description: "Streaming via approved session" });
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-primary" /></div>;

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
          <button onClick={() => setPath([])} className="font-mono text-primary hover:underline">{nodeName || "node"}:</button>
          {path.map((seg, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="size-3 text-muted-foreground" />
              <button onClick={() => setPath(path.slice(0, i + 1))} className="font-mono hover:text-primary">{seg}</button>
            </React.Fragment>
          ))}
        </div>

        {isAdmin && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              placeholder="New folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              className="h-8 max-w-xs"
            />
            <Button size="sm" variant="outline" onClick={createFolder}>
              <FolderPlus className="size-4" /> Create
            </Button>
            <Button size="sm" variant="outline" onClick={uploadFile}>
              <Upload className="size-4" /> Upload
            </Button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        {path.length > 0 && (
          <button
            onClick={() => setPath(path.slice(0, -1))}
            className="flex w-full items-center gap-2 border-b border-border px-4 py-2.5 text-sm hover:bg-muted/40"
          >
            <Folder className="size-4 text-muted-foreground" />
            <span className="font-mono">..</span>
          </button>
        )}
        {current.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Empty directory</div>
        )}
        {current.map((e) => (
          <div key={e.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted/30">
            <button
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
                  <Download className="size-3.5" />
                </Button>
              )}
              {isAdmin && (
                <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => deleteEntry(e.name)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
