import { Zap, Shield, Db, Database, Key, Clock, Monitor, UserCheck, Smartphone } from "lucide-react";

export default function Features() {
  const technicalFeatures = [
    {
      title: "WebRTC Native Streaming",
      description: "Uses native WebRTC implementation inside Rust backends to compress, capture, and stream desktop frames directly. Lowers screen delay to below 50ms inside local area network topologies.",
      icon: Zap,
      color: "text-brand-cyan bg-brand-cyan/10 border-brand-cyan/20",
    },
    {
      title: "Custom SQLite Persistence",
      description: "Saves client connection states, saved computer node lists, and device tokens in a structured, local SQLite database file, preventing external database dependencies.",
      icon: Database,
      color: "text-brand-purple bg-brand-purple/10 border-brand-purple/20",
    },
    {
      title: "Multi-Factor Authentication",
      description: "Secures your configuration and gateway access with full multi-factor authentication (MFA) and JWT-based session security validation tokens.",
      icon: Key,
      color: "text-brand-emerald bg-brand-emerald/10 border-brand-emerald/20",
    },
    {
      title: "Time-Frame Permission Popup",
      description: "Requires manual confirmation on the host computer when a remote connection is requested. Admin panel configurations permit customization of standby permission timeout limits.",
      icon: Clock,
      color: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    },
    {
      title: "Local Multi-Monitor Switching",
      description: "Supports automatic multi-display systems discovery. The controller UI renders screen-switching tabs (e.g. Screen 1, Screen 2) for switching target monitors.",
      icon: Monitor,
      color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    },
    {
      title: "Local Recording System",
      description: "Records the active remote session stream directly to a local WebM format video file on your client machine with an integrated live toolbar timer.",
      icon: UserCheck,
      color: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    },
  ];

  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Background decorations */}
      <div className="absolute top-1/4 right-0 w-[500px] h-[500px] bg-brand-cyan/5 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Engineering Specs</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            Core Features & Technologies
          </h1>
          <p className="text-lg text-slate-400">
            A comprehensive look at the self-hosted remote access features of AMPHub.
          </p>
        </div>

        {/* Dynamic Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {technicalFeatures.map((feat, idx) => {
            const Icon = feat.icon;
            return (
              <div
                key={idx}
                className="glass-panel p-8 rounded-2xl border border-white/5 flex flex-col justify-between glass-panel-hover text-left group"
              >
                <div className="space-y-6">
                  {/* Icon Wrapper */}
                  <div className={`p-3 rounded-lg border w-fit transition-transform group-hover:scale-110 duration-300 ${feat.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  {/* Feature Title */}
                  <h3 className="text-lg font-bold text-white group-hover:text-brand-cyan transition-colors duration-300">
                    {feat.title}
                  </h3>
                  {/* Feature Description */}
                  <p className="text-slate-400 text-sm leading-relaxed">
                    {feat.description}
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-slate-500">
                  <span>Architecture Component</span>
                  <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-[10px]">Active</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sub-block explaining Local Client Loop vs Sandbox */}
        <div className="mt-20 max-w-4xl mx-auto glass-panel p-8 rounded-2xl border border-white/5 text-left relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-brand-cyan/5 blur-2xl rounded-full"></div>
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="p-4 bg-brand-cyan/10 text-brand-cyan rounded-xl shrink-0">
              <Shield className="h-8 w-8" />
            </div>
            <div className="space-y-3">
              <h3 className="text-lg font-bold text-white">Security-First Desktop Capture Engine</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                By bypassing the browser WebRTC sandbox on native clients and utilizing local screen capture systems built directly in Rust, AMPHub resolves the Chromium black-screen loopback bug. Handshakes and stream rendering are conducted locally with TLS encryption.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
