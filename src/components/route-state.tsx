import type { ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function RouteLoadingState({
  label = "Loading…",
  withSkeleton = false,
}: {
  label?: string;
  withSkeleton?: boolean;
}) {
  if (!withSkeleton) {
    return (
      <div className="flex justify-center py-20" role="status" aria-live="polite" aria-label={label}>
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="p-4" role="status" aria-live="polite" aria-label={label}>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </Card>
  );
}

export function RouteEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <Card className="p-10 text-center">
      {Icon ? <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /> : null}
      <p className="mt-3 text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    </Card>
  );
}
