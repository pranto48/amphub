"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";

export default function DockerInstall() {
  const [copied, setCopied] = useState(false);
  const command = "docker run -d --name amphub-server -p 3355:3355 -p 7766:7766 itsupportbd/amphub:latest";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy command to clipboard:", err);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl border border-white/5 bg-[#05060b]">
      {/* Terminal Title Bar */}
      <div className="px-4 py-3 bg-[#0d0e15] border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="h-4 w-4 text-brand-cyan" />
          <span className="text-xs font-mono text-slate-400">Self-Hosted Server Docker Deployment</span>
        </div>
        <div className="flex space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></span>
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/80"></span>
        </div>
      </div>

      {/* Code body */}
      <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono text-sm leading-relaxed">
        <div className="flex-1 overflow-x-auto w-full scrollbar-none whitespace-nowrap text-left text-slate-300">
          <span className="text-brand-purple">docker run</span> <span className="text-brand-cyan">-d</span> <span className="text-slate-400">--name</span> amphub-server \
          <br className="hidden sm:inline" />
          <span className="sm:pl-6 text-slate-400">-p</span> 3355:3355 <span className="text-slate-400">-p</span> 7766:7766 itsupportbd/amphub:latest
        </div>
        <button
          onClick={handleCopy}
          className={`shrink-0 flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg text-xs font-bold transition-all w-full sm:w-auto ${
            copied
              ? "bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/20"
              : "bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 border border-white/5"
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy Code
            </>
          )}
        </button>
      </div>
    </div>
  );
}
