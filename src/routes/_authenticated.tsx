import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { RouteLoadingState } from "@/components/route-state";

const searchSchema = z.object({
  connectTo: z.string().optional(),
  action: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated")({
  validateSearch: (search) => searchSchema.parse(search),
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();

  React.useEffect(() => {
    if (!loading && !session) {
      navigate({
        to: "/login",
        search: {
          connectTo: search?.connectTo,
          action: search?.action,
        },
      });
    }
  }, [loading, session, navigate, search]);

  if (loading || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <RouteLoadingState label="Checking session" />
      </div>
    );
  }

  return <AppShell />;
}
