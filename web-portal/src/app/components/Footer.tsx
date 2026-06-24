import Link from "next/link";
import { Monitor, Heart, Github, Globe } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-brand-darker border-t border-white/5 pt-16 pb-8 relative overflow-hidden">
      {/* Decorative gradient flare */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2/3 h-40 bg-brand-purple/5 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Brand Info */}
          <div className="md:col-span-2 space-y-6">
            <Link href="/" className="flex items-center space-x-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-brand-cyan to-brand-purple text-white">
                <Monitor className="h-5 w-5" />
              </div>
              <span className="text-lg font-bold text-white tracking-wider">
                AMP<span className="text-brand-cyan">Hub</span>
              </span>
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed max-w-md">
              Switch from TeamViewer, AnyDesk, and Splashtop to AMPHub for a secure and reliable remote desktop experience with your own self-hosted servers. Take full control of your infrastructure, security, and costs.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Product</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/why-amphub" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  Why AMPHub
                </Link>
              </li>
              <li>
                <Link href="/features" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  Key Features
                </Link>
              </li>
              <li>
                <Link href="/benefits" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  Compliance & Benefits
                </Link>
              </li>
              <li>
                <Link href="/download" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  Downloads
                </Link>
              </li>
            </ul>
          </div>

          {/* Company & Support */}
          <div>
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider mb-4">Company</h3>
            <ul className="space-y-2.5">
              <li>
                <Link href="/about" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-slate-400 hover:text-brand-cyan text-sm transition-all">
                  Contact Support
                </Link>
              </li>
              <li>
                <a
                  href="https://itsupport.bd"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-brand-cyan text-sm transition-all flex items-center gap-1"
                >
                  IT Support BD <Globe className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-xs">
            © {new Date().getFullYear()} AMPHub. Open-source under MIT License. All rights reserved.
          </p>
          <div className="flex items-center space-x-6 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              Made with <Heart className="h-3 w-3 text-red-500 fill-red-500 animate-pulse" /> by{" "}
              <a
                href="https://www.arifmahmud.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-brand-cyan underline transition-all"
              >
                Arif Mahmud
              </a>{" "}
              and{" "}
              <a
                href="https://itsupport.bd"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-brand-cyan underline transition-all"
              >
                IT Support BD
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
