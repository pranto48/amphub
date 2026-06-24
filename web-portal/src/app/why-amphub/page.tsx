"use client";

import { useState } from "react";
import { Check, X, Shield, DollarSign, CloudOff, Info } from "lucide-react";

export default function WhyAmphub() {
  const [technicians, setTechnicians] = useState(5);
  const [endpoints, setEndpoints] = useState(50);

  // Approximate industry licensing models (annual pricing)
  const teamViewerRate = 600; // $600 per seat per year
  const anyDeskRate = 240;    // $240 per seat per year
  const splashtopRate = 120;   // $120 per seat per year

  const tvCost = technicians * teamViewerRate;
  const adCost = technicians * anyDeskRate;
  const stCost = technicians * splashtopRate;
  const amphubCost = 0;

  const features = [
    {
      name: "100% Self-Hosted & Data Ownership",
      amphub: true,
      teamviewer: false,
      anydesk: false,
      splashtop: false,
    },
    {
      name: "Air-gapped LAN Mode (No Internet)",
      amphub: true,
      teamviewer: false,
      anydesk: false,
      splashtop: false,
    },
    {
      name: "Zero Subscription Seat Costs",
      amphub: true,
      teamviewer: false,
      anydesk: false,
      splashtop: false,
    },
    {
      name: "Custom Signaling/Traversals",
      amphub: true,
      teamviewer: false,
      anydesk: false,
      splashtop: false,
    },
    {
      name: "Unlimited Simultaneous Sessions",
      amphub: true,
      teamviewer: false,
      anydesk: false,
      splashtop: false,
    },
  ];

  return (
    <div className="relative isolate py-12 md:py-20">
      {/* Decorative background gradients */}
      <div className="absolute top-1/3 left-[-10%] w-[500px] h-[500px] bg-brand-purple/5 blur-[150px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
          <span className="text-xs font-bold text-brand-cyan uppercase tracking-widest">Compare & Save</span>
          <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl">
            Why AMPHub?
          </h1>
          <p className="text-lg text-slate-400">
            Compare features and calculate the real Total Cost of Ownership (TCO) savings.
          </p>
        </div>

        {/* Feature Comparison Matrix Table */}
        <div className="mb-24 overflow-x-auto">
          <div className="min-w-[620px] max-w-5xl mx-auto glass-panel rounded-2xl border border-white/5 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0f111a] border-b border-white/5 text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">Capability</th>
                  <th className="px-6 py-4 text-brand-cyan">AMPHub</th>
                  <th className="px-6 py-4">TeamViewer</th>
                  <th className="px-6 py-4">AnyDesk</th>
                  <th className="px-6 py-4">Splashtop</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm">
                {features.map((feature, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-6 py-4 text-white font-medium">{feature.name}</td>
                    <td className="px-6 py-4 text-brand-emerald">
                      <Check className="h-5 w-5 bg-brand-emerald/10 p-0.5 rounded" />
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      <X className="h-4 w-4" />
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      <X className="h-4 w-4" />
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      <X className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Key Values List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-24">
          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5">
            <div className="p-3 bg-brand-cyan/10 text-brand-cyan rounded-lg w-fit mb-6">
              <Shield className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2.5">Absolute Data Sovereignty</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Proprietary options store visual frames, active session IDs, and log data in third-party environments. With AMPHub, your network topology contains zero external entities. All session databases are self-hosted on custom local servers.
            </p>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5">
            <div className="p-3 bg-brand-purple/10 text-brand-purple rounded-lg w-fit mb-6">
              <DollarSign className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2.5">Zero Subscription Costs</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Paid alternatives limit connections per user, lock administrative consoles behind expensive paywalls, and raise seat pricing annually. AMPHub provides an open-source MIT implementation with zero ongoing license costs.
            </p>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/5">
            <div className="p-3 bg-brand-emerald/10 text-brand-emerald rounded-lg w-fit mb-6">
              <CloudOff className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2.5">Air-gapped LAN Mode</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Corporate clients cannot run commercial solutions on strictly isolated air-gapped subnets. AMPHub functions completely on standalone local networks without requiring external internet handshakes or WAN signaling traversals.
            </p>
          </div>
        </div>

        {/* Interactive TCO Calculator Slider */}
        <div className="max-w-4xl mx-auto glass-panel p-8 sm:p-10 rounded-2xl border border-white/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-cyan/5 blur-2xl rounded-full"></div>

          <div className="text-center sm:text-left mb-8">
            <h2 className="text-2xl font-bold text-white">Interactive Total Cost of Ownership (TCO) Calculator</h2>
            <p className="text-slate-400 text-xs sm:text-sm mt-1">
              Select your IT Support footprint size to see your estimated annual savings with self-hosted AMPHub.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Input Slider Column */}
            <div className="lg:col-span-7 space-y-6">
              {/* Slider 1 */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300 font-medium">IT Technicians (Seats):</span>
                  <span className="text-brand-cyan font-bold font-mono">{technicians}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={technicians}
                  onChange={(e) => setTechnicians(Number(e.target.value))}
                  className="w-full h-1.5 bg-brand-dark rounded-lg appearance-none cursor-pointer accent-brand-cyan focus:outline-none"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>1 Seat</span>
                  <span>100 Seats</span>
                </div>
              </div>

              {/* Slider 2 */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300 font-medium">Managed Computers (Endpoints):</span>
                  <span className="text-brand-purple font-bold font-mono">{endpoints}</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="1000"
                  step="5"
                  value={endpoints}
                  onChange={(e) => setEndpoints(Number(e.target.value))}
                  className="w-full h-1.5 bg-brand-dark rounded-lg appearance-none cursor-pointer accent-brand-purple focus:outline-none"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>5 Nodes</span>
                  <span>1,000 Nodes</span>
                </div>
              </div>
            </div>

            {/* Calculations Column */}
            <div className="lg:col-span-5 bg-brand-darker/60 border border-white/5 rounded-xl p-6 space-y-5 text-left">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-brand-cyan" /> Annual Cost Comparison
              </h3>
              <div className="space-y-3 font-mono text-sm">
                <div className="flex justify-between items-center text-slate-400">
                  <span>TeamViewer Cost:</span>
                  <span className="text-red-400">${tvCost.toLocaleString()}/yr</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>AnyDesk Cost:</span>
                  <span className="text-orange-400">${adCost.toLocaleString()}/yr</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Splashtop Cost:</span>
                  <span className="text-yellow-400">${stCost.toLocaleString()}/yr</span>
                </div>
                <div className="flex justify-between items-center text-brand-emerald font-bold border-t border-white/10 pt-3 text-base">
                  <span>AMPHub Cost:</span>
                  <span className="bg-brand-emerald/10 px-2 py-0.5 rounded">$0/yr</span>
                </div>
              </div>

              {/* Annual Savings Block */}
              <div className="bg-gradient-to-br from-brand-cyan/10 to-brand-purple/10 border border-brand-cyan/20 rounded-lg p-4 text-center">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider">Estimated Annual Savings</div>
                <div className="text-2xl font-bold bg-gradient-to-r from-brand-cyan to-white bg-clip-text text-transparent mt-1">
                  ${tvCost.toLocaleString()} / year
                </div>
                <div className="text-[9px] text-slate-500 mt-1">Compared to standard TeamViewer plans</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
