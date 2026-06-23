import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Monitor, ShieldCheck, Cpu, Terminal, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/about")({
  component: AboutPage,
});

function AboutPage() {
  const version = import.meta.env.VITE_APP_VERSION || "V2.01";
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <Badge variant="secondary" className="mb-2 bg-primary/20 text-primary-foreground hover:bg-primary/30 border-primary/20">
          Secure Remote Desktop
        </Badge>
        <h1 id="about-title" className="text-3xl font-extrabold tracking-tight text-animated-accent">
          About AMPHUB Gateway
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
          AMPHUB is a premium enterprise-grade remote desktop gateway and file orchestrator designed for secure, auditable session control on corporate networks.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-5 border-border bg-gradient-to-br from-card to-background/50 flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
              <Monitor className="size-5" />
            </div>
            <h3 className="font-semibold text-base mb-2">High Performance</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Webrtc-based low latency screen sharing with optimized display modes, direct keyboard mapping, and customizable rendering buffers.
            </p>
          </div>
        </Card>

        <Card className="p-5 border-border bg-gradient-to-br from-card to-background/50 flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mb-4">
              <ShieldCheck className="size-5" />
            </div>
            <h3 className="font-semibold text-base mb-2">Zero-Trust Approvals</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              All remote session handshakes require administrative authorization, dual-factor validation for sensitive nodes, and strict lifetime limits.
            </p>
          </div>
        </Card>

        <Card className="p-5 border-border bg-gradient-to-br from-card to-background/50 flex flex-col justify-between">
          <div>
            <div className="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4">
              <Cpu className="size-5" />
            </div>
            <h3 className="font-semibold text-base mb-2">Network Discovery</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Automatic LAN node discovery, same-subnet routing bypassing public signaling paths, and local direct connection optimization.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* App Downloads Card */}
        <Card className="p-6 border-border flex flex-col justify-between relative overflow-hidden bg-card/60">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -mr-6 -mt-6"></div>
          <div>
            <h2 className="text-lg font-bold tracking-tight mb-2">Desktop Client Downloads</h2>
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
              Install the AMPHUB agent daemon on your Windows client nodes to make them available for remote access control. The agent runs silently as a background service.
            </p>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40 hover:border-primary/40 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">EXE</div>
                  <div>
                    <div className="text-xs font-semibold">Standard NSIS Setup (Recommended)</div>
                    <div className="text-[10px] text-muted-foreground">Version {version} · x64 · setup.exe</div>
                  </div>
                </div>
                <Button asChild size="sm" variant="secondary" className="hover:scale-105 transition-transform" id="btn-download-exe">
                  <a href="/downloads/AMPHUB_latest_x64-setup.exe" download={`AMPHUB_${version}_x64-setup.exe`}>
                    <Download className="size-3.5 mr-1" />
                    Download
                  </a>
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/40 hover:border-accent/40 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded bg-accent/10 flex items-center justify-center text-accent text-xs font-semibold">MSI</div>
                  <div>
                    <div className="text-xs font-semibold">Windows Installer Package</div>
                    <div className="text-[10px] text-muted-foreground">Version {version} · x64 · en-US.msi</div>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="hover:scale-105 transition-transform" id="btn-download-msi">
                  <a href="/downloads/AMPHUB_latest_x64_en-US.msi" download={`AMPHUB_${version}_x64_en-US.msi`}>
                    <Download className="size-3.5 mr-1" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* CLI Setup Instructions */}
        <Card className="p-6 border-border bg-card/60 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight mb-2">Command Line Setup</h2>
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              Enroll your headless servers or remote nodes quickly using the command-line setup utility. Run inside PowerShell as Administrator:
            </p>
            <div className="rounded-md border border-border bg-background/90 p-3 font-mono text-[11px] text-foreground space-y-2 select-all hover:border-muted-foreground/30 transition-colors">
              <div className="flex items-center gap-1.5 text-muted-foreground border-b border-border pb-1.5 mb-1.5">
                <Terminal className="size-3.5" />
                <span>enroll-node.ps1</span>
              </div>
              <p># Download and run client service registration</p>
              <p className="text-primary font-medium">iwr -useb http://192.168.9.9:3355/install.ps1 | iex</p>
              <p># Register client with authorization gateway</p>
              <p className="text-accent font-medium">amphub.exe register --gateway http://192.168.9.9:3355</p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Requires administrative privilege elevation (UAC)</span>
            <span className="flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors">
              Documentation <ChevronRight className="size-3" />
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
