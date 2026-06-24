import { ShieldCheck, HardDrive, CheckCircle2, Lock, EyeOff, RefreshCw } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AMPHub Compliance, GDPR & HIPAA Privacy Benefits",
  description: "Understand the corporate privacy benefits of AMPHub: full GDPR compliance, HIPAA alignment readiness, and absolute local control over session logs.",
};

export default function Benefits() {
  const compliancePoints = [
    {
      title: "GDPR Compliant Architecture",
      description: "Data protection guidelines state that personal visual streams and remote configuration details cannot flow into unaccounted jurisdictions. AMPHub ensures that 100% of remote session data is stored and processed locally.",
      icon: ShieldCheck,
    },
    {
      title: "HIPAA Alignment ready",
      description: "Remote healthcare support requires absolute encryption and strict session verification. AMPHub's peer-to-peer tunnels bypass third-party cloud brokers, ensuring medical visual records never touch external endpoints.",
      icon: HardDrive,
    },
    {
      title: "No Centralized Log Leakage",
      description: "Commercial remote support tools store audit records, client list logs, and connection timestamps on centralized databases. AMPHub databases are local SQLite systems deployed inside your Docker container.",
      icon: EyeOff,
    },
    {
      title: "Secure Session Handshakes",
      description: "Signaling handshakes utilize TLS/MFA encryption to verify client node validity before establishing the WebRTC direct peer stream. Session control is locked to your private server parameters.",
      icon: Lock,
    },
  ];

  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Background decoration */}
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-brand-cyan/5 blur-[180px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Compliance & Privacy</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            Enterprise Security Compliance
          </h1>
          <p className="text-lg text-slate-400">
            Discover how self-hosting AMPHub satisfies standard global data security regulations.
          </p>
        </div>

        {/* Compliance Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto mb-20">
          {compliancePoints.map((point, idx) => {
            const Icon = point.icon;
            return (
              <div
                key={idx}
                className="glass-panel p-8 rounded-2xl border border-white/5 text-left flex flex-col justify-between hover:border-brand-cyan/20 transition-all duration-300 group"
              >
                <div className="space-y-4">
                  <div className="p-3 bg-brand-cyan/10 text-brand-cyan rounded-lg w-fit group-hover:scale-105 transition-transform duration-300">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-brand-cyan transition-colors">
                    {point.title}
                  </h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    {point.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Audit Log / Self-Hosted Traversal block */}
        <div className="max-w-4xl mx-auto bg-gradient-to-r from-brand-cyan/5 via-brand-purple/5 to-transparent border border-white/5 rounded-2xl p-8 sm:p-10 text-left relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-brand-cyan/5 blur-2xl rounded-full"></div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-8 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-white">Full On-Premise Audit Trail Control</h2>
              <p className="text-slate-400 text-sm leading-relaxed">
                Many support tools limit connection log storage, forcing organizations to pay for history extensions. With AMPHub, your database belongs to you. You can integrate, export, and manage your SQLite or Firestore session registries infinitely.
              </p>
            </div>
            <div className="md:col-span-4 flex justify-center">
              <div className="relative p-6 rounded-full bg-white/[0.02] border border-white/10 animate-spin-slow">
                <RefreshCw className="h-10 w-10 text-brand-cyan" />
              </div>
            </div>
        </div>
      </div>
    </div>
  </div>
  );
}
