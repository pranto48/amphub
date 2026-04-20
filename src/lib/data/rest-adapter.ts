// REST + WebSocket adapter — talks to the Express server in /server (Docker).
import type {
  AccessRequest, AuditEntry, AuthSession, DataClient, DesktopNode,
  Profile, RealtimeEvent, Unsubscribe,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";
const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || (() => {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
})();
const TOKEN_KEY = "remoteops_token";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string> ?? {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const authListeners = new Set<(s: AuthSession | null) => void>();
let cachedSession: AuthSession | null = null;
function emitAuth(s: AuthSession | null) {
  cachedSession = s;
  authListeners.forEach((cb) => cb(s));
}

// --- realtime ws (single shared connection) ---
let ws: WebSocket | null = null;
let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
const rtListeners = new Set<(e: RealtimeEvent) => void>();

function ensureWs() {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (!WS_URL) return;
  try {
    const token = getToken();
    const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
    ws = new WebSocket(url);
    ws.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as RealtimeEvent;
        rtListeners.forEach((cb) => cb(evt));
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      ws = null;
      if (rtListeners.size > 0 && !wsRetryTimer) {
        wsRetryTimer = setTimeout(() => { wsRetryTimer = null; ensureWs(); }, 2000);
      }
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  } catch { /* noop */ }
}

export const restAdapter: DataClient = {
  async getSession() {
    if (cachedSession) return cachedSession;
    const token = getToken();
    if (!token) return null;
    try {
      const me = await api<{ id: string; email: string }>("/auth/me");
      cachedSession = { user: me, access_token: token };
      return cachedSession;
    } catch {
      setToken(null);
      return null;
    }
  },
  onAuthChange(cb) {
    authListeners.add(cb);
    return () => { authListeners.delete(cb); };
  },
  async signIn(email, password) {
    try {
      const r = await api<{ token: string; user: { id: string; email: string } }>("/auth/login", {
        method: "POST", body: JSON.stringify({ email, password }),
      });
      setToken(r.token);
      emitAuth({ user: r.user, access_token: r.token });
      ensureWs();
      return { error: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
  async signUp(email, password, displayName) {
    try {
      const r = await api<{ token: string; user: { id: string; email: string } }>("/auth/signup", {
        method: "POST", body: JSON.stringify({ email, password, displayName }),
      });
      setToken(r.token);
      emitAuth({ user: r.user, access_token: r.token });
      ensureWs();
      return { error: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
  async signOut() {
    setToken(null);
    emitAuth(null);
    try { ws?.close(); } catch { /* noop */ }
    ws = null;
  },
  async updatePassword(newPassword) {
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ password: newPassword }) });
      return { error: null };
    } catch (e) { return { error: (e as Error).message }; }
  },
  async isAdmin(_userId) {
    try {
      const r = await api<{ isAdmin: boolean }>("/auth/role");
      return r.isAdmin;
    } catch { return false; }
  },

  async getProfile(userId) { return api<Profile>(`/profiles/${userId}`).catch(() => null); },
  async updateProfile(userId, displayName) {
    try {
      await api(`/profiles/${userId}`, { method: "PATCH", body: JSON.stringify({ display_name: displayName }) });
      return { error: null };
    } catch (e) { return { error: (e as Error).message }; }
  },

  async listNodes() { return api<DesktopNode[]>("/nodes"); },
  async getNode(id) { return api<DesktopNode>(`/nodes/${id}`).catch(() => null); },
  async setNodeMasterPassword(nodeId, hash) {
    try {
      await api(`/nodes/${nodeId}/master-password`, { method: "POST", body: JSON.stringify({ hash }) });
      return { error: null };
    } catch (e) { return { error: (e as Error).message }; }
  },

  async createAccessRequest(nodeId) {
    try {
      const data = await api<AccessRequest>("/access-requests", {
        method: "POST", body: JSON.stringify({ node_id: nodeId }),
      });
      return { data, error: null };
    } catch (e) { return { data: null, error: (e as Error).message }; }
  },
  async getAccessRequest(id) { return api<AccessRequest>(`/access-requests/${id}`).catch(() => null); },
  async listPendingRequests() { return api<AccessRequest[]>("/access-requests?status=pending"); },
  async decideAccessRequest(id, approve) {
    try {
      await api(`/access-requests/${id}/decision`, {
        method: "POST", body: JSON.stringify({ approve }),
      });
      return { error: null };
    } catch (e) { return { error: (e as Error).message }; }
  },

  async listAudit(limit = 20) { return api<AuditEntry[]>(`/audit?limit=${limit}`); },

  subscribe(cb) {
    rtListeners.add(cb);
    ensureWs();
    return () => {
      rtListeners.delete(cb);
      if (rtListeners.size === 0) { try { ws?.close(); } catch { /* noop */ } ws = null; }
    };
  },
};
