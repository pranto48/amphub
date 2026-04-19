import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-mono text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Resource not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The node, file or session you requested could not be located.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "RemoteOps — Secure Remote Desktop & File Management" },
      { name: "description", content: "High-security console for managing remote Windows/Linux desktop nodes with admin-approved access." },
      { property: "og:title", content: "RemoteOps — Secure Remote Desktop & File Management" },
      { property: "og:description", content: "High-security console for managing remote Windows/Linux desktop nodes with admin-approved access." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "RemoteOps — Secure Remote Desktop & File Management" },
      { name: "twitter:description", content: "High-security console for managing remote Windows/Linux desktop nodes with admin-approved access." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d72f3866-2c6f-406e-bbcf-af3b2a2d6599/id-preview-c39215b4--1847cace-563f-47ca-9ba7-2217720bd74a.lovable.app-1776574952813.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d72f3866-2c6f-406e-bbcf-af3b2a2d6599/id-preview-c39215b4--1847cace-563f-47ca-9ba7-2217720bd74a.lovable.app-1776574952813.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors theme="dark" position="top-right" />
    </AuthProvider>
  );
}
