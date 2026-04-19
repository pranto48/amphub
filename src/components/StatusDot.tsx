import { cn } from "@/lib/utils";

type Status = "online" | "offline" | "pending";

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  const color =
    status === "online" ? "bg-success text-success" :
    status === "pending" ? "bg-warning text-warning" :
    "bg-muted-foreground text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} role="status" aria-label={`Node status: ${status}`}>
      <span className={cn("size-2 rounded-full pulse-dot", color)} aria-hidden="true" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {status}
      </span>
    </span>
  );
}
