"use client";

import { useEffect, useState } from "react";
import { Download, Monitor, ShieldAlert, Check, Copy, Terminal, AlertTriangle } from "lucide-react";

export default function DownloadPage() {
  const [detectedOs, setDetectedOs] = useState<"windows" | "mac" | "linux" | "unknown">("unknown");
  const [copiedNSIS, setCopiedNSIS] = useState(false);
  const [copiedMSI, setCopiedMSI] = useState(false);

  const nsisHash = "29b828cb054238e87d42cf38a4a58b27ea8db7120df0f8541cb9bc9d5c414c11";
  const msiHash = "8e9a263ca0c99a0f44bc1912a2c1d05417ab89b3ea8d88e0b0bc92bc6d85a170";

  useEffect(() => {
    const platform = window.navigator.userAgent.toLowerCase();
    if (platform.includes("win")) {
      setDetectedOs("windows");
    } else if (platform.includes("mac")) {
      setDetectedOs("mac");
    } else if (platform.includes("linux")) {
      setDetectedOs("linux");
    }
  }, []);

  const handleCopyHash = async (hash: string, type: "nsis" | "msi") => {
    try {
      await navigator.clipboard.writeText(hash);
      if (type === "nsis") {
        setCopiedNSIS(true);
        setTimeout(() => setCopiedNSIS(false), 2000);
      } else {
        setCopiedMSI(true);
        setTimeout(() => setCopiedMSI(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy hash:", err);
    }
  };

  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Background decorations */}
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-brand-cyan/5 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Get The Client</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            Download AMPHub Client
          </h1>
          <p className="text-lg text-slate-400">
            Download the secure native client app to connect, capture, and administer your remote workspaces.
          </p>
        </div>

        {/* OS Detection Notice */}
        {detectedOs !== "unknown" && (
          <div className="max-w-2xl mx-auto mb-10 p-4 rounded-xl bg-brand-cyan/5 border border-brand-cyan/20 text-slate-300 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-brand-cyan" />
              We detected your operating system: <strong className="text-white capitalize">{detectedOs}</strong>
            </span>
            {detectedOs === "windows" && (
              <span className="text-[10px] bg-brand-cyan/20 text-brand-cyan px-2.5 py-0.5 rounded font-bold">
                Supported natively
              </span>
            )}
          </div>
        )}

        {/* Windows Download Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-16">
          {/* Card 1: NSIS Standard Installer */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 flex flex-col justify-between hover:border-brand-cyan/20 transition-all duration-300 relative overflow-hidden group">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 font-mono">Standard Installer</span>
                <span className="text-[10px] bg-brand-cyan/10 text-brand-cyan px-2.5 py-0.5 rounded-full font-bold">
                  Recommended
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">Windows NSIS Setup (.exe)</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Standard Windows client package featuring a full setup wizard, automatic path variable updates, and uninstall routines.
              </p>

              {/* Cryptographic Badges */}
              <div className="p-3 bg-brand-darker/60 rounded-lg border border-white/5 space-y-1.5 text-left">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                  <span>SHA-256 Checksum:</span>
                  <button
                    onClick={() => handleCopyHash(nsisHash, "nsis")}
                    className="text-brand-cyan hover:underline flex items-center gap-1"
                  >
                    {copiedNSIS ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedNSIS ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-300 break-all select-all">
                  {nsisHash}
                </div>
              </div>
            </div>

            <div className="mt-8">
              <a
                href="/downloads/AMPHUB_latest_x64-setup.exe"
                download
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-black bg-brand-cyan hover:bg-brand-cyan/90 transition-all hover:scale-[1.02] shadow-[0_0_15px_rgba(6,182,212,0.15)]"
              >
                <Download className="h-4 w-4" /> Download .exe Installer
              </a>
            </div>
          </div>

          {/* Card 2: MSI Enterprise Installer */}
          <div className="glass-panel p-8 rounded-2xl border border-white/5 flex flex-col justify-between hover:border-brand-purple/20 transition-all duration-300 relative overflow-hidden group">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 font-mono">Active Directory</span>
                <span className="text-[10px] bg-brand-purple/10 text-brand-purple px-2.5 py-0.5 rounded-full font-bold">
                  Enterprise
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">Windows MSI Package (.msi)</h3>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Ideal for remote corporate deployment via Group Policy (GPO), Microsoft Endpoint Configuration Manager, or custom scripts.
              </p>

              {/* Cryptographic Badges */}
              <div className="p-3 bg-brand-darker/60 rounded-lg border border-white/5 space-y-1.5 text-left">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                  <span>SHA-256 Checksum:</span>
                  <button
                    onClick={() => handleCopyHash(msiHash, "msi")}
                    className="text-brand-purple hover:underline flex items-center gap-1"
                  >
                    {copiedMSI ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedMSI ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="text-[11px] font-mono text-slate-300 break-all select-all">
                  {msiHash}
                </div>
              </div>
            </div>

            <div className="mt-8">
              <a
                href="/downloads/AMPHUB_latest_x64_en-US.msi"
                download
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all hover:scale-[1.02]"
              >
                <Download className="h-4 w-4" /> Download .msi Installer
              </a>
            </div>
          </div>
        </div>

        {/* Verification CLI Instruction block */}
        <div className="max-w-3xl mx-auto glass-panel p-6 sm:p-8 rounded-2xl border border-white/5 text-left">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
            <Terminal className="h-4 w-4 text-brand-cyan" /> Cryptographic Integrity Check Instructions
          </h3>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed mb-4">
            To prevent payload injection and verify file authenticity, copy the SHA-256 hash above and run the following commands inside your local Windows PowerShell console:
          </p>
          <div className="p-4 bg-brand-darker rounded-xl border border-white/5 font-mono text-xs text-brand-cyan overflow-x-auto whitespace-pre">
            Get-FileHash .\AMPHUB_latest_x64-setup.exe -Algorithm SHA256
          </div>
        </div>

        {/* Warning other OS */}
        {detectedOs !== "windows" && detectedOs !== "unknown" && (
          <div className="max-w-2xl mx-auto mt-12 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-slate-400 text-xs flex items-center gap-3 text-left">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <span>
              We noticed your platform is {detectedOs}. Native macOS and Linux client apps are not compiled for version 2.08 yet. However, the Web Portal is fully operational on your system. You can download and run these installers on any target Windows server computer.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
