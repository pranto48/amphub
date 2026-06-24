import Link from "next/link";
import Image from "next/image";
import { Users, Globe, Mail, Shield, CheckCircle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Arif Mahmud & IT Support BD Team",
  description: "Learn about the creators, lead architect Arif Mahmud, and the IT Support BD systems engineers behind the open-source secure remote desktop gateway.",
};

export default function About() {
  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Decorative gradient flare */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-brand-cyan/5 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header block */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Our Story</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            About AMPHub
          </h1>
          <p className="text-lg text-slate-400">
            Learn about the engineering team behind the remote access framework built for data privacy.
          </p>
        </div>

        {/* Story Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-24">
          <div className="space-y-6 text-left">
            <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
              Solving Corporate Data Sovereignty Issues
            </h2>
            <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
              In early 2026, corporate data privacy faced critical issues. Third-party hosted services (like TeamViewer and AnyDesk) required credentials and remote stream telemetry to flow through external cloud data brokers. This introduced significant compliance risks for companies handling sensitive financial information or personal data.
            </p>
            <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
              Arif Mahmud and the engineers at **IT Support BD** came together to build a self-hosted alternative. By separating signaling channels from data delivery, AMPHub enables organizations to deploy their own secure proxy, trapping 100% of telemetry in-house.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              {[
                "100% Sovereignty Protection",
                "Fully Open-Source Telemetry",
                "No Third-Party Cloud Dependency",
                "Optimized WebRTC Protocols"
              ].map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-slate-300 text-sm font-medium">
                  <CheckCircle className="h-4 w-4 text-brand-cyan" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-brand-darker/60 flex flex-col justify-center relative overflow-hidden">
            {/* Design accents */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-brand-cyan/10 blur-2xl rounded-full"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-brand-purple/5 blur-3xl rounded-full"></div>

            <div className="relative z-10 space-y-6 text-left">
              <Shield className="h-10 w-10 text-brand-cyan" />
              <blockquote className="text-slate-300 italic text-base leading-relaxed">
                &ldquo;AMPHub is the direct response to the corporate need for secure, air-gapped support access. We wanted a system that provides AnyDesk-like fluidity without standard subscription models and external telemetry leaks.&rdquo;
              </blockquote>
              <div className="flex flex-col">
                <span className="font-bold text-white text-sm">Arif Mahmud</span>
                <span className="text-xs text-slate-500">Lead Project Architect & Founder</span>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Grid */}
        <div className="mb-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Core Authors & Developers</h2>
          <p className="text-slate-400 text-sm max-w-xl mx-auto mb-12">
            The project is maintained by two core contributors. Hover or click to learn more about their credentials.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Creator Card 1 */}
            <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5 glass-panel-hover flex flex-col justify-between text-left group">
              <div className="space-y-6">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-cyan to-brand-purple p-0.5 flex items-center justify-center shadow-lg">
                    <div className="w-full h-full rounded-full bg-brand-dark flex items-center justify-center text-white text-xl font-bold">
                      AM
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-brand-cyan transition-colors">Arif Mahmud</h3>
                    <p className="text-xs text-slate-500">Lead Developer & Systems Engineer</p>
                  </div>
                </div>
                <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                  Creator of AMPHub. Specialized in low-level Rust systems development, WebRTC traversal algorithms, and Tauri window frameworks.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                <a
                  href="https://www.arifmahmud.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-cyan hover:underline flex items-center gap-1.5 font-semibold"
                >
                  <Globe className="h-3.5 w-3.5" /> Visit Portfolio website
                </a>
                <span className="text-[10px] bg-brand-cyan/10 text-brand-cyan px-2.5 py-0.5 rounded-full font-bold">
                  Core Maintainer
                </span>
              </div>
            </div>

            {/* Creator Card 2 */}
            <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5 glass-panel-hover flex flex-col justify-between text-left group">
              <div className="space-y-6">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-purple to-brand-emerald p-0.5 flex items-center justify-center shadow-lg">
                    <div className="w-full h-full rounded-full bg-brand-dark flex items-center justify-center text-white text-xl font-bold">
                      IT
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-brand-emerald transition-colors">IT Support BD</h3>
                    <p className="text-xs text-slate-500">Enterprise Solutions & DevOps</p>
                  </div>
                </div>
                <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                  Providing enterprise-grade implementation testing, Docker package deployment infrastructure, and customer onboarding resources.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                <a
                  href="https://itsupport.bd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-emerald hover:underline flex items-center gap-1.5 font-semibold"
                >
                  <Globe className="h-3.5 w-3.5" /> Visit Official Page
                </a>
                <span className="text-[10px] bg-brand-emerald/10 text-brand-emerald px-2.5 py-0.5 rounded-full font-bold">
                  Organization Support
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
