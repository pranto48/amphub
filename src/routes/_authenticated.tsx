import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { RouteLoadingState } from "@/components/route-state";

export const Route = createFileRoute("/_authenticated")({ component: ProtectedLayout });

function ProtectedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <RouteLoadingState label="Checking session" />
      </div>
    );
  }

  return <AppShell />;
}
