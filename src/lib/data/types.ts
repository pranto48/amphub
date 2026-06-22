// Shared domain types for both Supabase and Express REST backends.
export type AuthUser = { id: string; email: string };
export type AuthSession = { user: AuthUser; access_token: string };

export type DesktopNode = {
  id: string;
  name: string;
  remote_id: string;
  local_ip: string;
  os: string;
  status: string;
  last_seen: string | null;
  master_password_hash?: string | null;
  owner_id?: string | null;
  password_algo?: string | null;
  password_version?: number | null;
  password_updated_at?: string | null;
  failed_attempts?: number | null;
  locked_until?: string | null;
  banned_until?: string | null;
};

export type AccessRequest = {
  id: string;
  node_id: string;
  requester_id: string;
  status: "pending" | "approved" | "denied" | "expired" | "revoked";
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  session_token: string | null;
  expires_at: string | null;
  request_reason?: string | null;
  pending_expires_at?: string | null;
  status_reason_code?: string | null;
  status_reason_message?: string | null;
};

export type AuditEntry = {
  id: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  metadata: unknown;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
};

export type RealtimeEvent =
  | { table: "access_requests"; type: "INSERT" | "UPDATE"; row: AccessRequest }
  | { table: "desktop_nodes"; type: "INSERT" | "UPDATE" | "DELETE"; row: DesktopNode };

export type Unsubscribe = () => void;

export interface DataClient {
  // ---- auth ----
  getSession(): Promise<AuthSession | null>;
  onAuthChange(cb: (s: AuthSession | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(email: string, password: string, displayName: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  updatePassword(newPassword: string): Promise<{ error: string | null }>;
  isAdmin(userId: string): Promise<boolean>;

  // ---- profiles ----
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, displayName: string): Promise<{ error: string | null }>;

  // ---- desktop nodes ----
  listNodes(): Promise<DesktopNode[]>;
  getNode(id: string): Promise<DesktopNode | null>;
  setNodeMasterPassword(nodeId: string, hash: string): Promise<{ error: string | null }>;
  updateNode(id: string, updates: Partial<{ name: string; remote_id: string; banned_until: string | null }>): Promise<{ error: string | null }>;
  verifyNodeMasterPassword(nodeId: string, password: string, context?: string): Promise<{ verified: boolean; error: string | null }>;
  recordPrivilegedEvent(nodeId: string, action: string, requestId?: string, sessionToken?: string, local?: boolean, metadata?: Record<string, unknown>): Promise<{ error: string | null }>;

  // ---- access requests ----
  createAccessRequest(nodeId: string): Promise<{ data: AccessRequest | null; error: string | null }>;
  getAccessRequest(id: string): Promise<AccessRequest | null>;
  listPendingRequests(): Promise<AccessRequest[]>;
  decideAccessRequest(id: string, approve: boolean): Promise<{ error: string | null }>;

  // ---- audit ----
  listAudit(limit?: number): Promise<AuditEntry[]>;

  // ---- realtime ----
  subscribe(cb: (e: RealtimeEvent) => void): Unsubscribe;
}
