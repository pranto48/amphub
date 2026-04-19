import * as React from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShieldCheck,
  Settings,
  FolderTree,
  Monitor,
  LogOut,
  Lock,
  Server,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin", label: "Admin Panel", icon: ShieldCheck, adminOnly: true },
  { to: "/security", label: "Security", icon: Lock },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { user, isAdmin, signOut } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-background">
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Server className="size-4" />
              </div>
              <div className="group-data-[collapsible=icon]:hidden">
                <div className="text-sm font-semibold tracking-tight">RemoteOps</div>
                <div className="font-mono text-[10px] text-muted-foreground">v1.0 · secure</div>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Console</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {nav
                    .filter((n) => !n.adminOnly || isAdmin)
                    .map((n) => {
                      const active = n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
                      return (
                        <SidebarMenuItem key={n.to}>
                          <SidebarMenuButton asChild isActive={active} tooltip={n.label}>
                            <Link to={n.to}>
                              <n.icon />
                              <span>{n.label}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <div className="flex flex-col gap-1 px-2 py-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                  {isAdmin ? "admin" : "user"}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
            >
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </Button>
          </SidebarFooter>
        </Sidebar>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2 backdrop-blur">
            <SidebarTrigger />
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Monitor className="size-3.5" />
              <span className="font-mono">remote-desktop-management</span>
              <span className="opacity-50">/</span>
              <FolderTree className="size-3.5" />
              <span className="max-w-[40vw] truncate font-mono opacity-80">{loc.pathname}</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success pulse-dot text-success" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                connected
              </span>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
