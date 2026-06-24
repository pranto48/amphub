"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Monitor, Network, Users, Activity, Loader2 } from "lucide-react";

interface ClientNode {
  id: string;
  hostname: string;
  ip: string;
  status: "online" | "offline";
  lastSeen?: any;
}

interface Session {
  id: string;
  hostId: string;
  viewerId: string;
  status: "active" | "expired";
  startedAt?: any;
}

export default function StatusDashboard() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientNode[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    // Check if database is a mock placeholder
    if (!db || (db as any).type === "mock") {
      setIsDemoMode(true);
      // Load sample/mock dashboard data for presentation
      setClients([
        { id: "1", hostname: "AMPHUB-HQ-SRV", ip: "192.168.10.45", status: "online" },
        { id: "2", hostname: "AMPHUB-DEV-PC", ip: "192.168.10.88", status: "online" },
        { id: "3", hostname: "IT-SUPPORT-LAP1", ip: "192.168.1.112", status: "online" },
        { id: "4", hostname: "REMOTE-DESIGN-MAC", ip: "192.168.9.22", status: "offline" },
        { id: "5", hostname: "SALES-PC-01", ip: "10.0.0.15", status: "online" },
      ]);
      setSessions([
        { id: "s1", hostId: "1", viewerId: "3", status: "active" },
        { id: "s2", hostId: "2", viewerId: "5", status: "active" },
      ]);
      setLoading(false);
      return;
    }

    try {
      const clientsQuery = query(collection(db, "clients"));
      const sessionsQuery = query(collection(db, "sessions"));

      const unsubClients = onSnapshot(clientsQuery, (snapshot) => {
        const clientList: ClientNode[] = [];
        snapshot.forEach((doc) => {
          clientList.push({ id: doc.id, ...doc.data() } as ClientNode);
        });
        setClients(clientList);
        setLoading(false);
      }, (error) => {
        console.error("Firestore clients snapshot failed. Switching to demo fallback mode:", error);
        setIsDemoMode(true);
      });

      const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
        const sessionList: Session[] = [];
        snapshot.forEach((doc) => {
          sessionList.push({ id: doc.id, ...doc.data() } as Session);
        });
        setSessions(sessionList);
      }, (error) => {
        console.error("Firestore sessions snapshot failed:", error);
      });

      return () => {
        unsubClients();
        unsubSessions();
      };
    } catch (err) {
      console.error("Failed to initialize Firebase listeners:", err);
      setIsDemoMode(true);
      setLoading(false);
    }
  }, []);

  const totalClients = clients.length;
  const onlineClients = clients.filter(c => c.status === "online").length;
  const offlineClients = totalClients - onlineClients;
  const activeSessions = sessions.filter(s => s.status === "active").length;

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-8 flex items-center justify-center min-h-[300px]">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 text-brand-cyan animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Retrieving Live Node Network Status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Demo Mode Notice */}
      {isDemoMode && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>⚡ Running in <strong>Demo Sandbox Mode</strong>. Set up Firestore on Vercel to view your own live endpoints.</span>
          <span className="hidden sm:inline-block bg-amber-500/20 px-2 py-0.5 rounded text-[10px]">Local Sandbox</span>
        </div>
      )}

      {/* Dynamic Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-brand-cyan"></div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Clients</span>
            <Monitor className="h-4 w-4 text-brand-cyan" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-2xl font-bold text-white">{totalClients}</span>
            <span className="ml-2 text-xs text-slate-500">configured</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-brand-emerald"></div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Online Nodes</span>
            <Activity className="h-4 w-4 text-brand-emerald" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-2xl font-bold text-brand-emerald">{onlineClients}</span>
            <span className="ml-2 text-xs text-slate-500">active now</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-slate-500"></div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Offline Nodes</span>
            <Monitor className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-2xl font-bold text-slate-300">{offlineClients}</span>
            <span className="ml-2 text-xs text-slate-500">standby</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="glass-panel p-5 rounded-xl border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-1 h-full bg-brand-purple"></div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Active Sessions</span>
            <Network className="h-4 w-4 text-brand-purple" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span className="text-2xl font-bold text-brand-purple">{activeSessions}</span>
            <span className="ml-2 text-xs text-slate-500">connections</span>
          </div>
        </div>
      </div>

      {/* Network Client Details Node List */}
      <div className="glass-panel rounded-xl border border-white/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Users className="h-4 w-4 text-brand-cyan" /> Registered Clients List
          </h3>
          <span className="text-xs text-slate-500">Status Updates Live</span>
        </div>
        <div className="divide-y divide-white/5 max-h-[220px] overflow-y-auto">
          {clients.map((client) => (
            <div key={client.id} className="px-6 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center space-x-3">
                <div className={`w-2 h-2 rounded-full ${client.status === "online" ? "bg-brand-emerald animate-pulse" : "bg-slate-600"}`}></div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-white">{client.hostname}</span>
                  <span className="text-xs text-slate-500">{client.ip}</span>
                </div>
              </div>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                client.status === "online" 
                  ? "bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/20" 
                  : "bg-white/5 text-slate-400 border border-white/5"
              }`}>
                {client.status}
              </span>
            </div>
          ))}
          {clients.length === 0 && (
            <div className="py-8 text-center text-slate-500 text-sm">No registered client nodes found in Firestore.</div>
          )}
        </div>
      </div>
    </div>
  );
}
