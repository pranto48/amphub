import Link from "next/link";
import { Monitor, Shield, Zap, Lock, Cpu, Server, CheckCircle2, ArrowRight } from "lucide-react";
import DockerInstall from "./components/DockerInstall";
import NetworkTopology from "./components/NetworkTopology";
import StatusDashboard from "./components/StatusDashboard";

export default function Home() {
  return (
    <div className="relative isolate">
      {/* Background decoration flares */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-brand-cyan/10 blur-[150px] rounded-full pointer-events-none animate-pulse-slow"></div>
      <div className="absolute top-[20%] right-[-10%] w-[600px] h-[600px] bg-brand-purple/10 blur-[180px] rounded-full pointer-events-none"></div>

      {/* Hero Section */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24 md:pt-20 md:pb-32 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Release Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-md animate-fade-in-up">
            <span className="flex h-2 w-2 rounded-full bg-brand-cyan animate-pulse"></span>
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">
              Version 2.08 Release — Self-Hosted Traversal
            </span>
          </div>

          {/* Main Heading */}
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.1] md:leading-[1.15] animate-fade-in-up delay-100">
            Secure Open-Source <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-brand-cyan via-brand-purple to-brand-emerald bg-clip-text text-transparent">
              Self-Hosted Remote Desktop
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed animate-fade-in-up delay-200">
            Switch from TeamViewer, AnyDesk, and Splashtop to AMPHub for a secure and reliable remote desktop experience with your own self-hosted servers. Take full control of your telemetry and sovereignty.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 animate-fade-in-up delay-300">
            <Link
              href="/download"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 rounded-xl text-sm font-bold text-black bg-brand-cyan hover:bg-brand-cyan/90 transition-all hover:scale-[1.02] shadow-[0_0_20px_rgba(6,182,212,0.25)] gap-2 group"
            >
              Download Windows Client <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/why-amphub"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 rounded-xl text-sm font-bold text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all hover:scale-[1.02]"
            >
              Why Choose AMPHub?
            </Link>
          </div>
        </div>

        {/* Scaffold Interactive Terminal */}
        <div className="mt-16 md:mt-24 animate-fade-in-up delay-400">
          <DockerInstall />
        </div>
      </section>

      {/* Network Topology section */}
      <section className="border-y border-white/5 bg-brand-darker/40 py-20 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Info Column */}
            <div className="lg:col-span-5 space-y-6 text-left">
              <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Relay Architecture</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
                Peer-to-Peer Traversal With Fallback Relays
              </h2>
              <p className="text-slate-400 text-base leading-relaxed">
                By bypassing centralized broker services, AMPHub keeps all remote connection sessions localized on your local LAN or traverses direct connections using WebRTC protocol.
              </p>
              <div className="space-y-4 pt-2">
                {[
                  "Direct high-fidelity local rendering",
                  "Encrypted TLS Signaling handshake",
                  "Self-hosted Docker proxy servers for NAT traversal",
                  "Zero data collection or third-party storage"
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm text-slate-300">
                    <CheckCircle2 className="h-5 w-5 text-brand-emerald shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagram Column */}
            <div className="lg:col-span-7">
              <NetworkTopology />
            </div>
          </div>
        </div>
      </section>

      {/* Live Firestore Node Dashboard section */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
        <div className="max-w-3xl mx-auto mb-12 text-center">
          <span className="text-xs font-bold text-brand-purple uppercase tracking-widest">Active Operations</span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mt-2">
            Live Network Node Registry
          </h2>
          <p className="text-slate-400 text-sm mt-3 leading-relaxed">
            Real-time status updates loaded directly from your Firestore instance database. Monitors connected active controller nodes and remote viewer desktop sessions.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <StatusDashboard />
        </div>
      </section>

      {/* Core Core Values Banner */}
      <section className="bg-gradient-to-b from-brand-darker/60 to-brand-dark py-20 border-t border-white/5 text-center">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="glass-panel p-8 rounded-2xl text-left border border-white/5">
              <div className="p-3 rounded-lg bg-brand-cyan/10 text-brand-cyan w-fit mb-5">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">GDPR & HIPAA Friendly</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Since all sessions are conducted locally or via your private server proxy, no logs are leaked, making it compliant with local compliance systems.
              </p>
            </div>

            <div className="glass-panel p-8 rounded-2xl text-left border border-white/5">
              <div className="p-3 rounded-lg bg-brand-purple/10 text-brand-purple w-fit mb-5">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Ultimate Speeds</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Uses customized WebRTC implementations to ensure fluid frame rates and low lag streams, even under low-bandwidth networks.
              </p>
            </div>

            <div className="glass-panel p-8 rounded-2xl text-left border border-white/5">
              <div className="p-3 rounded-lg bg-brand-emerald/10 text-brand-emerald w-fit mb-5">
                <Lock className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">100% Free & Open-Source</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Self-host with unlimited connections, unlimited users, and no monthly fees. Backed by the active IT Support BD engineering community.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
