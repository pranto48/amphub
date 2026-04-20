import * as React from "react";
import { dataClient } from "@/lib/data";
import type { AuthSession, AuthUser } from "@/lib/data/types";

type AuthCtx = {
  session: AuthSession | null;
  user: AuthUser | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
};

const Ctx = React.createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<AuthSession | null>(null);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const loadRole = React.useCallback(async (userId: string | undefined) => {
    if (!userId) { setIsAdmin(false); return; }
    setIsAdmin(await dataClient.isAdmin(userId));
  }, []);

  React.useEffect(() => {
    const unsub = dataClient.onAuthChange((s) => {
      setSession(s);
      setTimeout(() => loadRole(s?.user.id), 0);
    });
    dataClient.getSession().then((s) => {
      setSession(s);
      loadRole(s?.user.id).finally(() => setLoading(false));
    });
    return () => unsub();
  }, [loadRole]);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    isAdmin,
    loading,
    signIn: (email, password) => dataClient.signIn(email, password),
    signUp: (email, password, displayName) => dataClient.signUp(email, password, displayName),
    signOut: async () => { await dataClient.signOut(); setSession(null); setIsAdmin(false); },
    refreshRole: async () => { await loadRole(session?.user.id); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
