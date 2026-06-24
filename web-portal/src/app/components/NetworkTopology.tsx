"use client";

import { useState } from "react";
import { Monitor, Server, Laptop, ArrowRightLeft, Radio, Network } from "lucide-react";

export default function NetworkTopology() {
  const [activeRoute, setActiveRoute] = useState<"p2p" | "relay" | null>(null);

  return (
    <div className="glass-panel rounded-2xl p-6 lg:p-8 border border-white/5 relative overflow-hidden">
      {/* Topology Header */}
      <div className="mb-8">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Network className="h-5 w-5 text-brand-cyan" /> Interactive Network Topology
        </h3>
        <p className="text-slate-400 text-sm mt-1">
          AMPHub uses local P2P WebRTC connection with fallback to your own self-hosted signaling servers. Click a path below to see how data flows.
        </p>
      </div>

      {/* Interactive Controller buttons */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => setActiveRoute(activeRoute === "p2p" ? null : "p2p")}
          className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold border transition-all ${
            activeRoute === "p2p"
              ? "bg-brand-emerald/10 border-brand-emerald text-brand-emerald shadow-[0_0_15px_rgba(16,185,129,0.15)]"
              : "bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        >
          ✨ Direct P2P WebRTC Path
        </button>
        <button
          onClick={() => setActiveRoute(activeRoute === "relay" ? null : "relay")}
          className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold border transition-all ${
            activeRoute === "relay"
              ? "bg-brand-cyan/10 border-brand-cyan text-brand-cyan shadow-[0_0_15px_rgba(6,182,212,0.15)]"
              : "bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        >
          ☁️ Self-Hosted Relay Server
        </button>
      </div>

      {/* SVG Diagram Canvas */}
      <div className="relative w-full aspect-[16/9] max-h-[350px] bg-brand-darker rounded-xl border border-white/5 flex items-center justify-center p-4">
        {/* SVG Overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
          {/* Defs for animations */}
          <defs>
            <linearGradient id="cyanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
            <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>

          {/* Path 1: Direct P2P WebRTC (Bottom Line) */}
          <path
            d="M 15% 70% Q 50% 90% 85% 70%"
            fill="none"
            stroke={activeRoute === "p2p" ? "#10b981" : "#1e2235"}
            strokeWidth={activeRoute === "p2p" ? "4" : "2"}
            strokeDasharray={activeRoute === "p2p" ? "8, 8" : "none"}
            className={activeRoute === "p2p" ? "animate-[dash_2s_linear_infinite]" : ""}
            style={{ transition: "stroke 0.3s, stroke-width 0.3s" }}
          />

          {/* Path 2A: Controller to Relay Server */}
          <path
            d="M 15% 70% Q 30% 30% 50% 25%"
            fill="none"
            stroke={activeRoute === "relay" ? "#06b6d4" : "#1e2235"}
            strokeWidth={activeRoute === "relay" ? "4" : "2"}
            strokeDasharray={activeRoute === "relay" ? "8, 8" : "none"}
            className={activeRoute === "relay" ? "animate-[dash_2s_linear_infinite]" : ""}
            style={{ transition: "stroke 0.3s, stroke-width 0.3s" }}
          />

          {/* Path 2B: Relay Server to Host */}
          <path
            d="M 50% 25% Q 70% 30% 85% 70%"
            fill="none"
            stroke={activeRoute === "relay" ? "#06b6d4" : "#1e2235"}
            strokeWidth={activeRoute === "relay" ? "4" : "2"}
            strokeDasharray={activeRoute === "relay" ? "8, 8" : "none"}
            className={activeRoute === "relay" ? "animate-[dash_2s_linear_infinite]" : ""}
            style={{ transition: "stroke 0.3s, stroke-width 0.3s" }}
          />
        </svg>

        {/* Nodes Positioning */}
        <div className="absolute inset-0 flex justify-between items-center px-[8%] relative z-10 w-full h-full">
          {/* Node 1: Controller */}
          <div className="flex flex-col items-center space-y-2 mt-20">
            <div className={`p-4 rounded-full transition-all duration-300 ${
              activeRoute === "p2p" ? "bg-brand-emerald/20 text-brand-emerald border-brand-emerald shadow-[0_0_15px_rgba(16,185,129,0.2)]" :
              activeRoute === "relay" ? "bg-brand-cyan/20 text-brand-cyan border-brand-cyan shadow-[0_0_15px_rgba(6,182,212,0.2)]" :
              "bg-white/5 text-slate-400 border-white/10"
            } border-2`}>
              <Laptop className="h-7 w-7" />
            </div>
            <span className="text-xs font-semibold text-white">Viewer Node</span>
            <span className="text-[10px] text-slate-500">Controller App</span>
          </div>

          {/* Node 2: Relay/Signaling Server */}
          <div className="flex flex-col items-center space-y-2 mb-28">
            <div className={`p-4 rounded-full transition-all duration-300 ${
              activeRoute === "relay" ? "bg-brand-cyan/20 text-brand-cyan border-brand-cyan shadow-[0_0_15px_rgba(6,182,212,0.2)]" :
              "bg-white/5 text-slate-400 border-white/10"
            } border-2`}>
              <Server className="h-7 w-7" />
            </div>
            <span className="text-xs font-semibold text-white">Self-Hosted Relay</span>
            <span className="text-[10px] text-slate-500">Signaling Server</span>
          </div>

          {/* Node 3: Remote Host PC */}
          <div className="flex flex-col items-center space-y-2 mt-20">
            <div className={`p-4 rounded-full transition-all duration-300 ${
              activeRoute === "p2p" ? "bg-brand-emerald/20 text-brand-emerald border-brand-emerald shadow-[0_0_15px_rgba(16,185,129,0.2)]" :
              activeRoute === "relay" ? "bg-brand-cyan/20 text-brand-cyan border-brand-cyan shadow-[0_0_15px_rgba(6,182,212,0.2)]" :
              "bg-white/5 text-slate-400 border-white/10"
            } border-2`}>
              <Monitor className="h-7 w-7" />
            </div>
            <span className="text-xs font-semibold text-white">Host Node</span>
            <span className="text-[10px] text-slate-500">Target Desktop</span>
          </div>
        </div>
      </div>

      {/* Informative Explanation Panel */}
      <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/5 min-h-[90px] flex items-center">
        {activeRoute === null && (
          <p className="text-sm text-slate-400 leading-relaxed text-center w-full">
            💡 Select one of the connection paths above to visualize packet routing, data channels, and bandwidth optimization protocols.
          </p>
        )}
        {activeRoute === "p2p" && (
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-brand-emerald flex items-center gap-1.5">
              <ArrowRightLeft className="h-4 w-4" /> Peer-to-Peer Connection (Direct WebRTC)
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              When both nodes reside in the same local area network (LAN) or traversal succeeds via STUN/ICE, video data streams directly between target and controller. Zero cloud relaying yields near-zero latency and high frame-rates.
            </p>
          </div>
        )}
        {activeRoute === "relay" && (
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-brand-cyan flex items-center gap-1.5">
              <Radio className="h-4 w-4" /> Traversal Failback (Self-Hosted TURN/Relay)
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              If nodes are partitioned by strict enterprise symmetric firewalls or double NAT layers, the peer connection is automatically tunneled through your self-hosted Signaling / TURN Server. Since it is self-hosted on your hardware, your connection privacy remains fully encrypted and local.
            </p>
          </div>
        )}
      </div>

      {/* Inline styles for animated lines */}
      <style jsx global>{`
        @keyframes dash {
          to {
            stroke-dashoffset: -40;
          }
        }
      `}</style>
    </div>
  );
}
