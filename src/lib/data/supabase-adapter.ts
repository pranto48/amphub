import { supabase } from "@/integrations/supabase/client";
import type {
  AccessRequest, AuditEntry, AuthSession, DataClient, DesktopNode,
  Profile, RealtimeEvent, Unsubscribe,
} from "./types";

function toSession(s: { access_token: string; user: { id: string; email?: string | null } } | null): AuthSession | null {
  if (!s?.user) return null;
  return { user: { id: s.user.id, email: s.user.email ?? "" }, access_token: s.access_token };
}

export const supabaseAdapter: DataClient = {
  async getSession() {
    const { data } = await supabase.auth.getSession();
    return toSession(data.session);
  },
  onAuthChange(cb) {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => cb(toSession(s)));
    return () => sub.subscription.unsubscribe();
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  },
  async signUp(email, password, displayName) {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
        data: { display_name: displayName },
      },
    });
    return { error: error?.message ?? null };
  },
  async signOut() { await supabase.auth.signOut(); },
  async updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  },
  async isAdmin(userId) {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    return !!data?.some((r) => r.role === "admin");
  },

  async getProfile(userId) {
    const { data } = await supabase.from("profiles").select("id,email,display_name").eq("id", userId).maybeSingle();
    return (data as Profile) ?? null;
  },
  async updateProfile(userId, displayName) {
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", userId);
    return { error: error?.message ?? null };
  },

  async listNodes() {
    const { data } = await supabase.from("desktop_nodes").select("*").order("name");
    return (data ?? []) as DesktopNode[];
  },
  async getNode(id) {
    const { data } = await supabase.from("desktop_nodes").select("*").eq("id", id).maybeSingle();
    return (data as DesktopNode) ?? null;
  },
  async setNodeMasterPassword(nodeId, hash) {
    const { error } = await supabase.from("desktop_nodes").update({ master_password_hash: hash }).eq("id", nodeId);
    return { error: error?.message ?? null };
  },

  async createAccessRequest(nodeId) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return { data: null, error: "Not authenticated" };
    const { data, error } = await supabase
      .from("access_requests")
      .insert({ node_id: nodeId, requester_id: u.user.id, status: "pending" })
      .select()
      .single();
    return { data: (data as AccessRequest) ?? null, error: error?.message ?? null };
  },
  async getAccessRequest(id) {
    const { data } = await supabase.from("access_requests").select("*").eq("id", id).maybeSingle();
    return (data as AccessRequest) ?? null;
  },
  async listPendingRequests() {
    const { data } = await supabase.from("access_requests").select("*").eq("status", "pending").order("requested_at", { ascending: false });
    return (data ?? []) as AccessRequest[];
  },
  async decideAccessRequest(id, approve) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return { error: "Not authenticated" };
    const update = approve
      ? {
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_by: u.user.id,
          session_token: crypto.randomUUID().replace(/-/g, ""),
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }
      : { status: "denied", decided_at: new Date().toISOString(), decided_by: u.user.id };
    const { data: req, error } = await supabase.from("access_requests").update(update).eq("id", id).select().single();
    if (error) return { error: error.message };
    await supabase.from("audit_log").insert({
      actor_id: u.user.id,
      action: approve ? "approve_access" : "deny_access",
      target: (req as AccessRequest).node_id,
      metadata: { request_id: id },
    });
    return { error: null };
  },

  async listAudit(limit = 20) {
    const { data } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
    return (data ?? []) as AuditEntry[];
  },

  subscribe(cb) {
    const ch = supabase
      .channel("data-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_requests" }, (p) =>
        cb({ table: "access_requests", type: "INSERT", row: p.new as AccessRequest }))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "access_requests" }, (p) =>
        cb({ table: "access_requests", type: "UPDATE", row: p.new as AccessRequest }))
      .on("postgres_changes", { event: "*", schema: "public", table: "desktop_nodes" }, (p) =>
        cb({ table: "desktop_nodes", type: p.eventType as "INSERT" | "UPDATE" | "DELETE", row: p.new as DesktopNode }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  },
};
