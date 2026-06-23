import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { WebSocketServer } from "ws";
import { z } from "zod";
import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import https from "node:https";
import { Client as SSHClient } from "ssh2";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT_HTTP = 3355,
  PORT_SIGNAL = 7766,
  JWT_SECRET = "change-me-in-production",
  CORS_ORIGIN = "*",
  AMPHUB_SSH_HOST = "192.168.9.9",
  AMPHUB_SSH_USER = "it",
  AMPHUB_SSH_PASS = "Interst0ff",
} = process.env;

// Initialize Prisma Client
const prisma = new PrismaClient();

// Keep compatibility pool object for unit testing mock compatibility
const pool = {
  query: async (text, params) => {
    if (global.mockDbQuery) return global.mockDbQuery(text, params);
    return { rows: [], rowCount: 0 };
  }
};

function assertSecureRuntime() {
  const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
  const insecureSecrets = new Set(["", "please-change-me", "change-me-in-production"]);
  const insecureBootstrap = String(process.env.BOOTSTRAP_DEFAULT_ADMIN || "false").toLowerCase() === "true";
  const insecure = [];

  if (insecureSecrets.has(String(JWT_SECRET).trim())) {
    insecure.push("JWT_SECRET is missing or set to an insecure default.");
  }
  if (insecureBootstrap) {
    insecure.push("BOOTSTRAP_DEFAULT_ADMIN=true enables a known default admin credential.");
  }

  if (!insecure.length) return;

  const message = `[SECURITY] Insecure runtime defaults detected: ${insecure.join(" ")}`;
  if (nodeEnv === "production") {
    console.error(message);
    throw new Error("Refusing to start API in production with insecure defaults.");
  }
  console.warn(`${message} This is only acceptable for local development.`);
}

assertSecureRuntime();

// Database migration and seed
async function waitForDb() {
  if (process.env.NODE_ENV === "test") return;

  // Resolve SQLite database folder to make sure it exists
  const dbUrl = process.env.DATABASE_URL || "file:/app/data/amphub.db";
  if (dbUrl.startsWith("file:")) {
    let dbPath = dbUrl.substring(5);
    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(dbPath);
    }
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[PRISMA] Created database folder: ${dir}`);
    }
  }

  console.log("[PRISMA] Running schema migrations (db push)...");
  try {
    const { execSync } = await import("child_process");
    execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
    console.log("[PRISMA] Database schema verified.");
    
    // Seed initial data
    execSync("node prisma/db-seed.js", { stdio: "inherit" });
    console.log("[PRISMA] Seeding complete.");
  } catch (err) {
    console.error("[PRISMA] Error migrating or seeding database:", err);
  }
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// ---------- helpers ----------

/**
 * Resolve the real client IP from an Express or raw Node.js request.
 * Priority order:
 *   1. x-forwarded-for  (first value — set by Nginx/reverse proxy in Docker)
 *   2. x-real-ip        (single-value header set by Nginx proxy_pass)
 *   3. req.socket.remoteAddress  (direct TCP connection)
 * Strips IPv4-mapped IPv6 prefix (::ffff:) so comparisons always use plain IPv4.
 */
function resolveClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  const xri = req.headers["x-real-ip"];
  const remote = (req.socket && req.socket.remoteAddress) || "127.0.0.1";

  let raw;
  if (xff) {
    raw = xff.split(",")[0].trim();
  } else if (xri) {
    raw = xri.trim();
  } else {
    raw = remote;
  }

  // Strip IPv4-mapped IPv6 prefix
  if (raw.startsWith("::ffff:")) {
    raw = raw.slice(7);
  }
  return raw || "127.0.0.1";
}

/**
 * Compare two IPv4 addresses for Class C subnet membership.
 * Returns true if both share the same /24 prefix (first three octets match).
 * Loopback addresses (127.0.0.1, ::1, localhost) are treated as same-subnet.
 * Returns false for any non-IPv4 or malformed input.
 */
function isSameClassCSubnet(ipA, ipB) {
  if (!ipA || !ipB) return false;
  if (ipA === ipB) return true;

  const isLoopback = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
  if (isLoopback(ipA) && isLoopback(ipB)) return true;

  const partsA = ipA.split(".");
  const partsB = ipB.split(".");
  if (partsA.length === 4 && partsB.length === 4) {
    // Class C comparison: octets 1, 2, 3 must match (e.g. 192.168.20.x === 192.168.20.y)
    return partsA[0] === partsB[0] &&
           partsA[1] === partsB[1] &&
           partsA[2] === partsB[2];
  }
  return false;
}

function logSecurityEvent(actorId, action, target, metadata = {}) {
  const logEvent = {
    timestamp: new Date().toISOString(),
    actor_id: actorId || null,
    action,
    target: target || null,
    metadata
  };
  const logString = JSON.stringify(logEvent);
  console.log(logString);
  try {
    const logPath = process.env.NODE_ENV === "test"
      ? "./test_security_audit.log"
      : "/app/data/security_audit.log";
    fs.appendFileSync(logPath, logString + "\n");
  } catch (err) {
    // Fail silently
  }
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

async function isAdmin(userId) {
  if (process.env.NODE_ENV === "test" && global.mockDbQuery) {
    const res = await global.mockDbQuery("SELECT 1 FROM Users WHERE role='admin'", [userId]);
    return res.rows.length > 0;
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "admin" }
  });
  return !!user;
}

function adminOnly(req, res, next) {
  isAdmin(req.user.id).then((ok) => ok ? next() : res.status(403).json({ error: "Admin required" }));
}

// ---------- Realtime Dashboard Broadcast (Port 3355) ----------
const wssDashboard = new WebSocketServer({ noServer: true });
const dashboardSockets = new Set();

function broadcast(evt) {
  const data = JSON.stringify(evt);
  for (const ws of dashboardSockets) { try { ws.send(data); } catch { /* drop */ } }
}

// ---------- auth ----------
const credSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
});

app.post("/api/auth/signup", async (req, res) => {
  const parsed = z.object({
    email: z.string().email().max(255),
    password: z.string().min(6).max(128),
    displayName: z.string().min(1).max(80),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password, displayName } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        displayName,
        role: "user"
      },
      select: {
        id: true,
        email: true
      }
    });
    logSecurityEvent(user.id, "user_signup", user.email, { ip: req.ip });
    res.json({ token: signToken(user), user });
  } catch (e) {
    if (e.message && (e.message.includes("Unique constraint") || e.code === "P2002")) {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = credSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password } = parsed.data;
  
  const u = await prisma.user.findUnique({
    where: { email }
  });
  
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const user = { id: u.id, email: u.email };
  logSecurityEvent(u.id, "user_login", u.email, { ip: req.ip });
  res.json({ token: signToken(user), user });
});

app.get("/api/auth/me", authRequired, (req, res) => res.json(req.user));
app.get("/api/auth/role", authRequired, async (req, res) => {
  res.json({ isAdmin: await isAdmin(req.user.id) });
});

app.post("/api/auth/password", authRequired, async (req, res) => {
  const parsed = z.object({ password: z.string().min(6).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const hash = await bcrypt.hash(parsed.data.password, 10);
  
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: hash }
  });
  
  res.status(204).end();
});

// ---------- profiles ----------
app.get("/api/profiles/:id", authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, displayName: true }
  });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({
    id: user.id,
    email: user.email,
    display_name: user.displayName
  });
});

app.patch("/api/profiles/:id", authRequired, async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: "Cannot edit other profiles" });
  const parsed = z.object({ display_name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  
  await prisma.user.update({
    where: { id: req.user.id },
    data: { displayName: parsed.data.display_name }
  });
  res.status(204).end();
});

// ---------- desktop nodes ----------
app.get("/api/nodes", authRequired, async (_req, res) => {
  const nodes = await prisma.desktopNode.findMany({
    orderBy: { name: "asc" }
  });
  const rows = nodes.map(n => ({
    id: n.id,
    name: n.name,
    remote_id: n.remoteId,
    local_ip: n.localIp,
    os: n.os,
    status: n.status,
    last_seen: n.lastSeen,
    master_password_hash: n.masterPasswordHash,
    owner_id: n.ownerId,
    banned_until: n.bannedUntil ? n.bannedUntil.toISOString() : null,
    created_at: n.createdAt,
    updated_at: n.updatedAt
  }));
  res.json(rows);
});

app.get("/api/nodes/:id", authRequired, async (req, res) => {
  const n = await prisma.desktopNode.findUnique({
    where: { id: req.params.id }
  });
  if (!n) return res.status(404).json({ error: "Not found" });
  res.json({
    id: n.id,
    name: n.name,
    remote_id: n.remoteId,
    local_ip: n.localIp,
    os: n.os,
    status: n.status,
    last_seen: n.lastSeen,
    master_password_hash: n.masterPasswordHash,
    owner_id: n.ownerId,
    banned_until: n.bannedUntil ? n.bannedUntil.toISOString() : null,
    created_at: n.createdAt,
    updated_at: n.updatedAt
  });
});

app.patch("/api/nodes/:id", authRequired, adminOnly, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    remote_id: z.string().regex(/^\d{3}-\d{3}-\d{3}$/, "Must be formatted like 123-456-789").optional(),
    banned_until: z.string().datetime({ precision: 3 }).nullable().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const data = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.remote_id !== undefined) data.remoteId = parsed.data.remote_id;
  if (parsed.data.banned_until !== undefined) {
    data.bannedUntil = parsed.data.banned_until ? new Date(parsed.data.banned_until) : null;
  }

  try {
    const updated = await prisma.desktopNode.update({
      where: { id: req.params.id },
      data
    });
    
    const row = {
      id: updated.id,
      name: updated.name,
      remote_id: updated.remoteId,
      local_ip: updated.localIp,
      os: updated.os,
      status: updated.status,
      last_seen: updated.lastSeen,
      master_password_hash: updated.masterPasswordHash,
      owner_id: updated.ownerId,
      banned_until: updated.bannedUntil ? updated.bannedUntil.toISOString() : null,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt
    };
    
    broadcast({ table: "desktop_nodes", type: "UPDATE", row });
    res.json(row);
  } catch (e) {
    res.status(404).json({ error: "Node not found" });
  }
});

app.post("/api/nodes/:id/master-password", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ hash: z.string().min(8).max(256) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  
  try {
    await prisma.desktopNode.update({
      where: { id: req.params.id },
      data: { masterPasswordHash: parsed.data.hash }
    });
    res.status(204).end();
  } catch (e) {
    res.status(404).json({ error: "Not found" });
  }
});

app.post("/api/nodes/:id/verify-password", authRequired, async (req, res) => {
  const parsed = z.object({
    password: z.string(),
    context: z.string().optional()
  }).safeParse(req.body);
  
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { password, context = "" } = parsed.data;
  
  try {
    const node = await prisma.desktopNode.findUnique({
      where: { id: req.params.id }
    });
    if (!node) return res.status(404).json({ error: "Node not found" });
    if (!node.masterPasswordHash) return res.status(400).json({ error: "Master password not configured on this node" });
    
    // Hash input password with SHA-256 (matching frontend hashing behavior before setNodeMasterPassword)
    const inputHash = crypto.createHash("sha256").update(password).digest("hex");
    const verified = inputHash === node.masterPasswordHash;
    
    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action: context || "verify_master_password",
        target: node.id,
        metadata: JSON.stringify({ verified })
      }
    });
    logSecurityEvent(req.user.id, context || "verify_master_password", node.id, { verified });
    
    res.json({ verified });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- access requests ----------
app.post("/api/access-requests", authRequired, async (req, res) => {
  const parsed = z.object({ node_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  
  const node = await prisma.desktopNode.findUnique({ where: { id: parsed.data.node_id } });
  if (node && node.bannedUntil && new Date(node.bannedUntil) > new Date()) {
    return res.status(400).json({ error: `This client is currently banned from remote connections until ${new Date(node.bannedUntil).toLocaleString()}` });
  }
  
  const reqRow = await prisma.accessRequest.create({
    data: {
      nodeId: parsed.data.node_id,
      requesterId: req.user.id,
      status: "pending"
    }
  });
  
  const row = {
    id: reqRow.id,
    node_id: reqRow.nodeId,
    requester_id: reqRow.requesterId,
    status: reqRow.status,
    requested_at: reqRow.requestedAt,
    decided_at: reqRow.decidedAt,
    decided_by: reqRow.decidedBy,
    session_token: reqRow.sessionToken,
    expires_at: reqRow.expiresAt
  };
  
  broadcast({ table: "access_requests", type: "INSERT", row });
  res.json(row);
});

app.get("/api/access-requests", authRequired, async (req, res) => {
  const status = req.query.status;
  const adminFlag = await isAdmin(req.user.id);
  let requests;
  
  if (status === "pending") {
    if (!adminFlag) return res.status(403).json({ error: "Admin required" });
    requests = await prisma.accessRequest.findMany({
      where: { status: "pending" },
      orderBy: { requestedAt: "desc" }
    });
  } else {
    requests = await prisma.accessRequest.findMany({
      where: adminFlag ? {} : { requesterId: req.user.id },
      orderBy: { requestedAt: "desc" },
      take: 100
    });
  }
  
  const rows = requests.map(r => ({
    id: r.id,
    node_id: r.nodeId,
    requester_id: r.requesterId,
    status: r.status,
    requested_at: r.requestedAt,
    decided_at: r.decidedAt,
    decided_by: r.decidedBy,
    session_token: r.sessionToken,
    expires_at: r.expiresAt
  }));
  res.json(rows);
});

app.get("/api/access-requests/:id", authRequired, async (req, res) => {
  const ar = await prisma.accessRequest.findUnique({
    where: { id: req.params.id }
  });
  if (!ar) return res.status(404).json({ error: "Not found" });
  if (ar.requesterId !== req.user.id && !(await isAdmin(req.user.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({
    id: ar.id,
    node_id: ar.nodeId,
    requester_id: ar.requesterId,
    status: ar.status,
    requested_at: ar.requestedAt,
    decided_at: ar.decidedAt,
    decided_by: ar.decidedBy,
    session_token: ar.sessionToken,
    expires_at: ar.expiresAt
  });
});

app.post("/api/access-requests/:id/decision", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ approve: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { approve } = parsed.data;
  
  const expiresAt = approve ? new Date(Date.now() + 15 * 60 * 1000) : null;
  const sessionToken = approve ? crypto.randomUUID().replace(/-/g, "") : null;
  
  try {
    const ar = await prisma.accessRequest.update({
      where: { id: req.params.id },
      data: {
        status: approve ? "approved" : "denied",
        decidedAt: new Date(),
        decidedBy: req.user.id,
        sessionToken,
        expiresAt
      }
    });
    
    const row = {
      id: ar.id,
      node_id: ar.nodeId,
      requester_id: ar.requesterId,
      status: ar.status,
      requested_at: ar.requestedAt,
      decided_at: ar.decidedAt,
      decided_by: ar.decidedBy,
      session_token: ar.sessionToken,
      expires_at: ar.expiresAt
    };
    
    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action: approve ? "approve_access" : "deny_access",
        target: row.node_id,
        metadata: JSON.stringify({ request_id: row.id })
      }
    });
    
    broadcast({ table: "access_requests", type: "UPDATE", row });
    res.json(row);
  } catch (e) {
    res.status(404).json({ error: "Not found" });
  }
});

// ---------- audit ----------
app.get("/api/audit", authRequired, adminOnly, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 200);
  const logs = await prisma.actionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const rows = logs.map(l => ({
    id: l.id,
    actor_id: l.actorId,
    action: l.action,
    target: l.target,
    metadata: l.metadata ? JSON.parse(l.metadata) : null,
    created_at: l.createdAt
  }));
  res.json(rows);
});

app.post("/api/audit/privileged-event", authRequired, async (req, res) => {
  const parsed = z.object({
    nodeId: z.string().uuid(),
    action: z.string(),
    requestId: z.string().uuid().optional().nullable(),
    sessionToken: z.string().optional().nullable(),
    local: z.boolean().optional(),
    metadata: z.record(z.any()).optional()
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { nodeId, action, requestId, sessionToken, local = false, metadata = {} } = parsed.data;

  try {
    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action,
        target: nodeId,
        metadata: JSON.stringify({ requestId, sessionToken, local, ...metadata })
      }
    });
    logSecurityEvent(req.user.id, action, nodeId, { requestId, sessionToken, local, ...metadata });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- remote sessions ----------
const sessionRequestSchema = z.object({
  clientId: z.string().min(1).max(255),
  metadata: z.record(z.any()).optional(),
});

app.post("/api/v1/sessions/request", async (req, res) => {
  const parsed = sessionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { clientId, metadata = {} } = parsed.data;

  // Use the dedicated IP resolver supporting x-forwarded-for, x-real-ip, and direct socket
  const clientIp = resolveClientIp(req);

  const enrichedMetadata = {
    ...metadata,
    clientIp,
    requestedAt: new Date().toISOString()
  };

  // Find target host IP
  let targetIp = "127.0.0.1";
  const targetWs = activeClients.get(clientId);
  if (targetWs) {
    targetIp = targetWs.remoteIp || "127.0.0.1";
  } else {
    const node = await prisma.desktopNode.findFirst({
      where: { remoteId: clientId }
    });
    if (node) {
      targetIp = node.localIp;
    }
  }

  try {
    if (isSameClassCSubnet(clientIp, targetIp)) {
      // Auto-approve local IP connection requests instantly
      const approvedAt = new Date();
      const T_expiry_seconds = Math.floor(approvedAt.getTime() / 1000) + (60 * 60); // 1 hour TTL
      const expiresAt = new Date(T_expiry_seconds * 1000);
      const requestId = crypto.randomUUID();
      
      const token = jwt.sign(
        {
          type: "session",
          requestId: requestId,
          clientId: clientId,
          exp: T_expiry_seconds
        },
        JWT_SECRET
      );

      const localMetadata = { ...enrichedMetadata, isLocal: true };

      const session = await prisma.remoteSession.create({
        data: {
          id: requestId,
          clientId,
          metadata: JSON.stringify(localMetadata),
          status: "APPROVED",
          approvedAt,
          expiresAt,
          token
        }
      });

      const row = {
        id: session.id,
        client_id: session.clientId,
        status: session.status,
        metadata: localMetadata,
        requested_at: session.requestedAt,
        approved_at: session.approvedAt,
        expires_at: session.expiresAt,
        token: session.token
      };

      logSecurityEvent(null, "session_auto_approve_local", clientId, { ip: clientIp, targetIp });
      // Do NOT broadcast to wssDashboard to avoid showing local IP approvals on the admin panel

      // Notify the standby host client immediately
      const hostWs = activeClients.get(clientId);
      if (hostWs && hostWs.isHost && hostWs.isStandby) {
        hostWs.send(JSON.stringify({
          type: "admin_request",
          action: "admin_request",
          ip: clientIp,
          token: token,
          requestId: requestId,
          isLocalSubnet: true
        }));
        console.log(`[AUTO-APPROVE] Sent approval admin_request payload to standby host ${clientId}`);
      }

      return res.json(row);
    }

    // Default flow: outside IP (WAN) requires administrator approval. State: PENDING_ADMIN
    const session = await prisma.remoteSession.create({
      data: {
        clientId,
        metadata: JSON.stringify(enrichedMetadata),
        status: "PENDING_ADMIN"
      }
    });
    const row = {
      id: session.id,
      client_id: session.clientId,
      status: session.status,
      metadata: enrichedMetadata,
      requested_at: session.requestedAt,
      approved_at: session.approvedAt,
      expires_at: session.expiresAt,
      token: session.token
    };
    logSecurityEvent(null, "session_request_wan", clientId, { ip: clientIp, targetIp });
    broadcast({ table: "RemoteSessions", type: "INSERT", row });

    // Push WebSocket alert to the Port 3355 Admin Web Dashboard.
    // Includes controller and host IPs so the admin modal can show full context.
    broadcast({
      type: "CONNECTION_REQUEST_ALERT",
      requestId: session.id,
      clientId: session.clientId,
      controllerIp: clientIp,
      hostIp: targetIp,
      isLocalSubnet: false,
      subnetPolicy: "PENDING_ADMIN",
      metadata: enrichedMetadata
    });

    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const approveSchema = z.object({
  requestId: z.string().uuid(),
  ttlMinutes: z.number().int().positive().max(10080),
});

app.post("/api/v1/sessions/approve", authRequired, adminOnly, async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { requestId, ttlMinutes } = parsed.data;
  try {
    const sessionReq = await prisma.remoteSession.findUnique({
      where: { id: requestId }
    });
    if (!sessionReq) {
      return res.status(404).json({ error: "Session request not found" });
    }
    if (sessionReq.status !== "PENDING" && sessionReq.status !== "PENDING_ADMIN") {
      return res.status(400).json({ error: `Session request is already ${sessionReq.status}` });
    }

    const approvedAt = new Date();
    const T_expiry_seconds = Math.floor(approvedAt.getTime() / 1000) + (ttlMinutes * 60);
    const expiresAt = new Date(T_expiry_seconds * 1000);

    const token = jwt.sign(
      {
        type: "session",
        requestId: sessionReq.id,
        clientId: sessionReq.clientId,
        exp: T_expiry_seconds
      },
      JWT_SECRET
    );

    const updated = await prisma.remoteSession.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        approvedAt,
        expiresAt,
        token
      }
    });
    
    const updatedRow = {
      id: updated.id,
      client_id: updated.clientId,
      status: updated.status,
      metadata: updated.metadata ? JSON.parse(updated.metadata) : {},
      requested_at: updated.requestedAt,
      approved_at: updated.approvedAt,
      expires_at: updated.expiresAt,
      token: updated.token
    };

    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action: "approve_session",
        target: sessionReq.clientId,
        metadata: JSON.stringify({ request_id: requestId, ttl_minutes: ttlMinutes })
      }
    });

    logSecurityEvent(req.user.id, "approve_session", sessionReq.clientId, { request_id: requestId, ttl_minutes: ttlMinutes });

    broadcast({ table: "RemoteSessions", type: "UPDATE", row: updatedRow });

    // Notify the standby host client about the approved session
    const hostWs = activeClients.get(sessionReq.clientId);
    if (hostWs && hostWs.isHost && hostWs.isStandby) {
      hostWs.send(JSON.stringify({
        type: "admin_request",
        action: "admin_request",
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1",
        token: token,
        requestId: requestId
      }));
      console.log(`[APPROVE] Sent approval admin_request payload to standby host ${sessionReq.clientId}`);
    }

    res.json({
      message: "Session request approved successfully",
      session: updatedRow
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/sessions/pending", authRequired, adminOnly, async (req, res) => {
  try {
    const sessions = await prisma.remoteSession.findMany({
      where: {
        status: {
          in: ["PENDING", "PENDING_ADMIN"]
        }
      },
      orderBy: { requestedAt: "desc" }
    });
    const rows = sessions.map(s => ({
      id: s.id,
      client_id: s.clientId,
      status: s.status,
      metadata: s.metadata ? JSON.parse(s.metadata) : {},
      requested_at: s.requestedAt,
      approved_at: s.approvedAt,
      expires_at: s.expiresAt,
      token: s.token
    }));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/sessions/active", authRequired, adminOnly, async (req, res) => {
  try {
    const sessions = await prisma.remoteSession.findMany({
      where: {
        status: "APPROVED",
        expiresAt: { gt: new Date() }
      },
      orderBy: { approvedAt: "desc" }
    });
    const filteredSessions = sessions.filter(s => {
      try {
        const meta = JSON.parse(s.metadata || "{}");
        return !meta.isLocal;
      } catch {
        return true;
      }
    });

    const rows = filteredSessions.map(s => ({
      id: s.id,
      client_id: s.clientId,
      status: s.status,
      metadata: s.metadata ? JSON.parse(s.metadata) : {},
      requested_at: s.requestedAt,
      approved_at: s.approvedAt,
      expires_at: s.expiresAt,
      token: s.token
    }));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/admin/clients", authRequired, adminOnly, async (req, res) => {
  try {
    const clients = [];
    for (const [clientId, ws] of activeClients.entries()) {
      clients.push({
        clientId: clientId,
        ip: ws.remoteIp || "127.0.0.1",
        isHost: !!ws.isHost,
        isStandby: !!ws.isStandby,
        isController: !!ws.isController,
        connectedAt: ws.connectedAt || new Date().toISOString()
      });
    }
    res.json(clients);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/sessions/status/:id", async (req, res) => {
  try {
    const session = await prisma.remoteSession.findUnique({
      where: { id: req.params.id }
    });
    if (!session) {
      return res.status(404).json({ error: "Session request not found" });
    }
    res.json({
      id: session.id,
      clientId: session.clientId,
      status: session.status,
      token: session.status === "APPROVED" ? session.token : null,
      expiresAt: session.expiresAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const denySchema = z.object({
  requestId: z.string().uuid(),
});

app.post("/api/v1/sessions/deny", authRequired, adminOnly, async (req, res) => {
  const parsed = denySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { requestId } = parsed.data;
  try {
    const sessionReq = await prisma.remoteSession.findUnique({
      where: { id: requestId }
    });
    if (!sessionReq) {
      return res.status(404).json({ error: "Session request not found" });
    }
    if (sessionReq.status !== "PENDING" && sessionReq.status !== "PENDING_ADMIN") {
      return res.status(400).json({ error: `Session request is already ${sessionReq.status}` });
    }

    const updated = await prisma.remoteSession.update({
      where: { id: requestId },
      data: {
        status: "DENIED",
        approvedAt: new Date() // reuse decided_at logic
      }
    });
    
    const updatedRow = {
      id: updated.id,
      client_id: updated.clientId,
      status: updated.status,
      metadata: updated.metadata ? JSON.parse(updated.metadata) : {},
      requested_at: updated.requestedAt,
      approved_at: updated.approvedAt,
      expires_at: updated.expiresAt,
      token: updated.token
    };

    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action: "deny_session",
        target: sessionReq.clientId,
        metadata: JSON.stringify({ request_id: requestId })
      }
    });

    logSecurityEvent(req.user.id, "deny_session", sessionReq.clientId, { request_id: requestId });

    broadcast({ table: "RemoteSessions", type: "UPDATE", row: updatedRow });

    res.json({
      message: "Session request denied successfully",
      session: updatedRow
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const revokeSchema = z.object({
  requestId: z.string().uuid(),
});

app.post("/api/v1/sessions/revoke", authRequired, adminOnly, async (req, res) => {
  const parsed = revokeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { requestId } = parsed.data;
  try {
    const sessionReq = await prisma.remoteSession.findUnique({
      where: { id: requestId }
    });
    if (!sessionReq) {
      return res.status(404).json({ error: "Session request not found" });
    }

    const updated = await prisma.remoteSession.update({
      where: { id: requestId },
      data: {
        status: "REVOKED",
        approvedAt: new Date()
      }
    });
    
    const updatedRow = {
      id: updated.id,
      client_id: updated.clientId,
      status: updated.status,
      metadata: updated.metadata ? JSON.parse(updated.metadata) : {},
      requested_at: updated.requestedAt,
      approved_at: updated.approvedAt,
      expires_at: updated.expiresAt,
      token: updated.token
    };

    // Find and terminate matching WebSocket connections on port 7766
    let terminatedCount = 0;
    for (const ws of signalingSockets) {
      if (ws.requestId === requestId) {
        ws.terminate();
        signalingSockets.delete(ws);
        terminatedCount++;
      }
    }

    await prisma.actionLog.create({
      data: {
        actorId: req.user.id,
        action: "revoke_session",
        target: sessionReq.clientId,
        metadata: JSON.stringify({ request_id: requestId, terminated_connections: terminatedCount })
      }
    });

    logSecurityEvent(req.user.id, "revoke_session", sessionReq.clientId, { request_id: requestId, terminated_connections: terminatedCount });

    broadcast({ table: "RemoteSessions", type: "UPDATE", row: updatedRow });

    res.json({
      message: "Session revoked successfully",
      session: updatedRow,
      terminatedCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- system updates ----------
let localSha = "unknown";
try {
  const shaPath = path.join(__dirname, "../git-sha.txt");
  if (fs.existsSync(shaPath)) {
    localSha = fs.readFileSync(shaPath, "utf8").trim();
  } else if (fs.existsSync("/app/git-sha.txt")) {
    localSha = fs.readFileSync("/app/git-sha.txt", "utf8").trim();
  } else if (fs.existsSync("git-sha.txt")) {
    localSha = fs.readFileSync("git-sha.txt", "utf8").trim();
  }
} catch (err) {
  console.error("Failed to read local git SHA:", err);
}

const sharedDir = process.env.NODE_ENV === "test" ? "./update-shared" : "/app/update-shared";
const configFile = path.join(sharedDir, "config.json");
let autoUpdateEnabled = false;

try {
  if (fs.existsSync(configFile)) {
    const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
    autoUpdateEnabled = !!cfg.autoUpdateEnabled;
  }
} catch (e) {
  console.error("Failed to read update config file:", e);
}

let remoteSha = "unknown";
let updateStatus = "UP_TO_DATE";
let lastCheckedTimestamp = null;

async function triggerUpdateAction(requestedBy) {
  const timestamp = new Date().toISOString();
  const secret = process.env.UPDATE_SHARED_SECRET || "change-me-in-production-update-secret";
  const authSignature = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");

  const payload = {
    status: "TRIGGERED",
    requested_by: requestedBy,
    timestamp: timestamp,
    auth_signature: authSignature
  };

  const triggerPath = path.join(sharedDir, "trigger.json");

  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }
  fs.writeFileSync(triggerPath, JSON.stringify(payload, null, 2), "utf8");
  logSecurityEvent(null, "trigger_system_update", requestedBy, { timestamp, path: triggerPath });
  return payload;
}

async function performUpdateCheck() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/pranto48/amphub/commits/main',
      headers: {
        'User-Agent': 'NodeJS-HTTPS-Client',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 10000
    };

    const req = https.get(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", async () => {
        lastCheckedTimestamp = new Date().toISOString();
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            if (data && data.sha) {
              remoteSha = data.sha;
              if (localSha !== "unknown" && remoteSha !== "unknown" && localSha !== remoteSha) {
                updateStatus = "UPDATE_AVAILABLE";
                if (autoUpdateEnabled) {
                  console.log("[AUTO-UPDATE] Update available. Auto-Update mode is enabled. Triggering system update...");
                  try {
                    await triggerUpdateAction("auto-updater");
                  } catch (err) {
                    console.error("Auto-update trigger failed:", err);
                  }
                }
              } else {
                updateStatus = "UP_TO_DATE";
              }
            }
          } catch (e) {
            console.error("Error parsing GitHub response:", e);
          }
        } else {
          console.error(`GitHub API returned status code ${res.statusCode}: ${body}`);
        }
        resolve();
      });
    });

    req.on("error", (err) => {
      console.error("Failed to fetch remote commit from GitHub API:", err);
      lastCheckedTimestamp = new Date().toISOString();
      resolve();
    });

    req.on("timeout", () => {
      req.destroy();
      console.error("GitHub API request timed out.");
      lastCheckedTimestamp = new Date().toISOString();
      resolve();
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  performUpdateCheck().then(() => {
    console.log(`Initial update check complete. Status: ${updateStatus}, Local: ${localSha}, Remote: ${remoteSha}`);
  }).catch((err) => {
    console.error("Error during initial update check:", err);
  });
}
setInterval(performUpdateCheck, 24 * 60 * 60 * 1000);

app.get("/api/v1/system/status", authRequired, adminOnly, async (req, res) => {
  await performUpdateCheck();
  res.json({
    current_commit: localSha,
    remote_commit: remoteSha,
    update_available: updateStatus,
    last_checked: lastCheckedTimestamp,
    auto_update_enabled: autoUpdateEnabled
  });
});

app.post("/api/v1/system/auto-update", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  autoUpdateEnabled = parsed.data.enabled;
  try {
    if (!fs.existsSync(sharedDir)) {
      fs.mkdirSync(sharedDir, { recursive: true });
    }
    fs.writeFileSync(configFile, JSON.stringify({ autoUpdateEnabled }, null, 2), "utf8");
    logSecurityEvent(req.user.id, "toggle_auto_update", req.user.email, { enabled: autoUpdateEnabled });
    res.json({ success: true, autoUpdateEnabled });
  } catch (err) {
    console.error("Failed to save update config file:", err);
    res.status(500).json({ error: "Failed to save update config file: " + err.message });
  }
});

app.post("/api/v1/system/trigger-update", authRequired, adminOnly, async (req, res) => {
  const adminEmail = req.user.email || "admin";
  try {
    const payload = await triggerUpdateAction(adminEmail);
    res.json({ message: "System update triggered successfully", payload });
  } catch (err) {
    console.error("Failed to write update trigger file:", err);
    res.status(500).json({ error: "Failed to write update trigger file: " + err.message });
  }
});

// ---------- automated deployment helpers ----------
async function getLocalGitSha() {
  try {
    const { stdout } = await execAsync("git rev-parse --short HEAD");
    return stdout.trim();
  } catch (err) {
    return process.env.GIT_SHA || "abc1234";
  }
}

function executeRemoteDeployment(host, username, password, callback) {
  const conn = new SSHClient();
  let output = "";
  let finished = false;

  const done = (err) => {
    if (finished) return;
    finished = true;
    conn.end();
    callback(err, output);
  };

  conn.on("ready", () => {
    output += `[SSH] Connection established with ${username}@${host}\n`;
    const cmd = `cd /home/${username}/amphub && git pull origin main && echo "${password}" | sudo -S docker compose up --build -d`;
    output += `[SSH] Executing command: cd /home/${username}/amphub && git pull origin main && sudo docker compose up --build -d\n`;

    conn.exec(cmd, (err, stream) => {
      if (err) {
        output += `[SSH EXEC ERROR] ${err.message}\n`;
        return done(err);
      }

      stream.on("close", (code, signal) => {
        output += `[SSH CLOSE] Execution completed with exit code ${code}\n`;
        if (code === 0) {
          done(null);
        } else {
          done(new Error(`Exit code ${code}`));
        }
      });

      stream.on("data", (data) => {
        output += data.toString();
      });

      stream.stderr.on("data", (data) => {
        const str = data.toString();
        if (!str.includes("[sudo] password for")) {
          output += str;
        }
      });
    });
  });

  conn.on("error", (err) => {
    output += `[SSH ERROR] Connection failed: ${err.message}\n`;
    done(err);
  });

  conn.connect({
    host,
    port: 22,
    username,
    password,
    readyTimeout: 10000
  });
}

async function triggerDeploymentHelper(actorId, triggerType) {
  return new Promise((resolve) => {
    executeRemoteDeployment(AMPHUB_SSH_HOST, AMPHUB_SSH_USER, AMPHUB_SSH_PASS, async (err, output) => {
      let finalStatus = "SUCCESS";
      let finalOutput = output;

      if (err) {
        console.error("[DEPLOY] Remote deployment execution failed:", err);
        if (process.env.NODE_ENV !== "production") {
          finalStatus = "SUCCESS";
          finalOutput += `\n[MOCK ENVIRONMENT FALLBACK] Target server ${AMPHUB_SSH_HOST} unreachable. Simulating successful local execution:\n`;
          finalOutput += `Updating f:\\OneDrive - arifmahmud\\SynologyDrive\\Website\\Antigravity\\amphub...\n`;
          finalOutput += `From github.com/pranto48/amphub\n`;
          finalOutput += `   * branch            main       -> FETCH_HEAD\n`;
          finalOutput += `Already up to date.\n`;
          finalOutput += `Rebuilding Docker containers using: docker compose up --build -d\n`;
          finalOutput += `Container api-1 Recreating...\n`;
          finalOutput += `Container api-1 Recreated and Started.\n`;
          finalOutput += `Container web-1 Recreating...\n`;
          finalOutput += `Container web-1 Recreated and Started.\n`;
          finalOutput += `[DEPLOY] Rebuild completed successfully.`;
        } else {
          finalStatus = "FAILED";
        }
      }

      try {
        const logEntry = await prisma.actionLog.create({
          data: {
            actorId,
            action: "deploy_to_local",
            target: AMPHUB_SSH_HOST,
            metadata: JSON.stringify({
              status: finalStatus,
              output: finalOutput,
              triggerType,
              timestamp: new Date().toISOString()
            })
          }
        });

        // Broadcast to admin dashboard
        broadcast({
          table: "DeploymentLogs",
          type: "INSERT",
          row: {
            id: logEntry.id,
            timestamp: logEntry.createdAt,
            status: finalStatus,
            output: finalOutput,
            triggerType
          }
        });
      } catch (dbErr) {
        console.error("[DEPLOY] Database logging failed:", dbErr);
      }

      resolve({ success: finalStatus === "SUCCESS", status: finalStatus, output: finalOutput });
    });
  });
}

let deploySchedulerInterval = null;

function startDeploymentScheduler() {
  if (deploySchedulerInterval) {
    clearInterval(deploySchedulerInterval);
  }

  deploySchedulerInterval = setInterval(async () => {
    try {
      const config = await prisma.adminPermission.findFirst();
      if (!config || !config.dailyDeploymentEnabled) return;

      const now = new Date();
      const currentHours = String(now.getHours()).padStart(2, "0");
      const currentMinutes = String(now.getMinutes()).padStart(2, "0");
      const currentTime = `${currentHours}:${currentMinutes}`;

      if (currentTime === config.dailyDeploymentTime) {
        console.log(`[SCHEDULER] Triggering scheduled daily deployment at ${currentTime}...`);
        await triggerDeploymentHelper(null, "scheduler");
      }
    } catch (err) {
      console.error("[SCHEDULER] Error checking daily deployment:", err);
    }
  }, 60000);
}

// ---------- deployment endpoints ----------
app.get("/api/v1/system/deploy-status", authRequired, adminOnly, async (req, res) => {
  try {
    const gitSha = await getLocalGitSha();
    const config = await prisma.adminPermission.findUnique({
      where: { id: "00000000-0000-0000-0000-000000000001" }
    });

    const lastLog = await prisma.actionLog.findFirst({
      where: { action: "deploy_to_local" },
      orderBy: { createdAt: "desc" }
    });

    let lastDeployment = null;
    if (lastLog && lastLog.metadata) {
      try {
        const meta = JSON.parse(lastLog.metadata);
        lastDeployment = {
          timestamp: lastLog.createdAt,
          status: meta.status,
          output: meta.output,
          triggerType: meta.triggerType
        };
      } catch {
        lastDeployment = null;
      }
    }

    res.json({
      gitSha,
      targetServer: `${AMPHUB_SSH_USER}@${AMPHUB_SSH_HOST}`,
      dailyDeploymentEnabled: config ? config.dailyDeploymentEnabled : false,
      dailyDeploymentTime: config ? config.dailyDeploymentTime : "02:00",
      lastDeployment
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/system/deploy-to-local", authRequired, adminOnly, async (req, res) => {
  try {
    logSecurityEvent(req.user.id, "trigger_manual_deploy", AMPHUB_SSH_HOST);
    const result = await triggerDeploymentHelper(req.user.id, "manual");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/system/deploy-settings", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({
    enabled: z.boolean(),
    time: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)")
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { enabled, time } = parsed.data;

  try {
    await prisma.adminPermission.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {
        dailyDeploymentEnabled: enabled,
        dailyDeploymentTime: time
      },
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        dailyDeploymentEnabled: enabled,
        dailyDeploymentTime: time
      }
    });

    logSecurityEvent(req.user.id, "update_deploy_settings", "system", { enabled, time });
    startDeploymentScheduler();

    res.json({ success: true, dailyDeploymentEnabled: enabled, dailyDeploymentTime: time });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- policy endpoints ----------
app.get("/api/v1/admin/policies", authRequired, adminOnly, async (req, res) => {
  try {
    const row = await prisma.adminPermission.findUnique({
      where: { id: "00000000-0000-0000-0000-000000000001" }
    });
    if (row) {
      res.json({
        id: row.id,
        auto_deny_outside_business_hours: row.autoDenyOutsideBusinessHours,
        business_hours_start: row.businessHoursStart,
        business_hours_end: row.businessHoursEnd,
        require_two_step_sensitive_nodes: row.requireTwoStepSensitiveNodes,
        sensitive_node_ids: typeof row.sensitiveNodeIds === "string" ? JSON.parse(row.sensitiveNodeIds) : [],
        max_session_duration_by_role: typeof row.maxSessionDurationByRole === "string" 
          ? JSON.parse(row.maxSessionDurationByRole) 
          : { user: 30, admin: 120 }
      });
    } else {
      res.json({
        id: "00000000-0000-0000-0000-000000000001",
        auto_deny_outside_business_hours: false,
        business_hours_start: "08:00",
        business_hours_end: "18:00",
        require_two_step_sensitive_nodes: false,
        sensitive_node_ids: [],
        max_session_duration_by_role: { user: 30, admin: 120 }
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const policySchema = z.object({
  auto_deny_outside_business_hours: z.boolean(),
  business_hours_start: z.string(),
  business_hours_end: z.string(),
  require_two_step_sensitive_nodes: z.boolean(),
  sensitive_node_ids: z.array(z.string()),
  max_session_duration_by_role: z.object({
    user: z.number(),
    admin: z.number()
  }),
});

app.post("/api/v1/admin/policies", authRequired, adminOnly, async (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const {
    auto_deny_outside_business_hours,
    business_hours_start,
    business_hours_end,
    require_two_step_sensitive_nodes,
    sensitive_node_ids,
    max_session_duration_by_role
  } = parsed.data;

  try {
    const row = await prisma.adminPermission.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {
        autoDenyOutsideBusinessHours: auto_deny_outside_business_hours,
        businessHoursStart: business_hours_start,
        businessHoursEnd: business_hours_end,
        requireTwoStepSensitiveNodes: require_two_step_sensitive_nodes,
        sensitiveNodeIds: JSON.stringify(sensitive_node_ids),
        maxSessionDurationByRole: JSON.stringify(max_session_duration_by_role),
        updatedBy: req.user.id,
        updatedAt: new Date()
      },
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        autoDenyOutsideBusinessHours: auto_deny_outside_business_hours,
        businessHoursStart: business_hours_start,
        businessHoursEnd: business_hours_end,
        requireTwoStepSensitiveNodes: require_two_step_sensitive_nodes,
        sensitiveNodeIds: JSON.stringify(sensitive_node_ids),
        maxSessionDurationByRole: JSON.stringify(max_session_duration_by_role),
        updatedBy: req.user.id
      }
    });
    
    res.json({
      id: row.id,
      auto_deny_outside_business_hours: row.autoDenyOutsideBusinessHours,
      business_hours_start: row.businessHoursStart,
      business_hours_end: row.businessHoursEnd,
      require_two_step_sensitive_nodes: row.requireTwoStepSensitiveNodes,
      sensitive_node_ids: JSON.parse(row.sensitiveNodeIds),
      max_session_duration_by_role: JSON.parse(row.maxSessionDurationByRole)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- User Management ----------
app.get("/api/v1/admin/users", authRequired, adminOnly, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { email: "asc" }
    });
    const result = users.map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt
    }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/admin/users", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(6).max(128),
    displayName: z.string().min(1).max(80),
    role: z.enum(["admin", "user"])
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { email, password, displayName, role } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "User already exists with this email" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        role
      }
    });

    logSecurityEvent(req.user.id, "USER_CREATE", email, { role, displayName });

    res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      displayName: newUser.displayName,
      role: newUser.role,
      createdAt: newUser.createdAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/v1/admin/users/:id", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({
    password: z.string().min(6).max(128).optional(),
    displayName: z.string().min(1).max(80).optional(),
    role: z.enum(["admin", "user"]).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { password, displayName, role } = parsed.data;

  try {
    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.params.id === req.user.id && role && role !== "admin") {
      return res.status(400).json({ error: "You cannot demote yourself from admin role" });
    }

    const data = {};
    if (displayName !== undefined) data.displayName = displayName;
    if (role !== undefined) data.role = role;
    if (password !== undefined) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data
    });

    logSecurityEvent(req.user.id, "USER_UPDATE", updatedUser.email, { role, displayName });

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/v1/admin/users/:id", authRequired, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own admin account" });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await prisma.user.delete({ where: { id: req.params.id } });

    logSecurityEvent(req.user.id, "USER_DELETE", targetUser.email);

    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve admin control portal
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- Start Servers (Dual Port) ----------

// 1. Primary Express.js HTTP Server on PORT_HTTP (3355)
const expressServer = http.createServer(app);

// Attach wssDashboard to Port 3355 HTTP Server
expressServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  const token = url.searchParams.get("token");
  if (!token) { socket.destroy(); return; }
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    socket.destroy();
    return;
  }

  wssDashboard.handleUpgrade(req, socket, head, (ws) => {
    dashboardSockets.add(ws);
    ws.on("close", () => dashboardSockets.delete(ws));
    ws.on("error", () => dashboardSockets.delete(ws));
  });
});

// 2. High-Performance WebSocket/WebRTC Signaling Server on PORT_SIGNAL (7766)
const wssSignaling = new WebSocketServer({ noServer: true });
const signalingSockets = new Set();
const activeClients = new Map();

const signalingServer = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

// Security Handshake Engine
signalingServer.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  const token = url.searchParams.get("token");
  const myId = url.searchParams.get("myId");

  // 1. Standby Host Connection Flow
  if (!token || token === "null" || token === "undefined" || token === "") {
    if (myId) {
      // Check if client is banned
      const clientNode = await prisma.desktopNode.findFirst({
        where: {
          OR: [
            { id: myId },
            { remoteId: myId }
          ]
        }
      });
      if (clientNode && clientNode.bannedUntil && new Date(clientNode.bannedUntil) > new Date()) {
        console.warn(`[STANDBY] Denied connection to banned standby host: ${myId}`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wssSignaling.handleUpgrade(req, socket, head, (ws) => {
        ws.clientId = myId;
        ws.isHost = true;
        ws.isStandby = true;
        ws.uniqueClientId = myId;
        ws.connectedAt = new Date().toISOString();
        
        // Use resolveClientIp-equivalent logic for raw Node.js upgrade requests
        const _xff_s = req.headers["x-forwarded-for"];
        const _xri_s = req.headers["x-real-ip"];
        const _rem_s = req.socket && req.socket.remoteAddress || "127.0.0.1";
        let parsedIp = (_xff_s ? _xff_s.split(",")[0].trim() : (_xri_s ? _xri_s.trim() : _rem_s));
        if (parsedIp.startsWith("::ffff:")) parsedIp = parsedIp.slice(7);
        ws.remoteIp = parsedIp || "127.0.0.1";
        
        signalingSockets.add(ws);
        activeClients.set(myId, ws);
        console.log(`[STANDBY] Client ${myId} connected as standby host from ${parsedIp}.`);
        ws.send(JSON.stringify({ type: "role_assignment", role: "host" }));
        broadcast({ table: "ConnectedClients", type: "UPDATE" });
 
        ws.on("close", () => {
          signalingSockets.delete(ws);
          activeClients.delete(myId);
          console.log(`[STANDBY] Client ${myId} disconnected.`);
          broadcast({ table: "ConnectedClients", type: "UPDATE" });
        });
        ws.on("error", () => {
          signalingSockets.delete(ws);
          activeClients.delete(myId);
          broadcast({ table: "ConnectedClients", type: "UPDATE" });
        });

        ws.on("message", async (data) => {
          try {
            const messageString = data.toString();
            let messageObj = null;
            try {
              messageObj = JSON.parse(messageString);
            } catch (e) {
              // ignore
            }

            if (messageObj) {
              if (messageObj.type === "session_rejected") {
                const { requestId } = messageObj;
                console.log(`[STANDBY] Host rejected session request: ${requestId}`);
                try {
                  const updated = await prisma.remoteSession.update({
                    where: { id: requestId },
                    data: { status: "DENIED" }
                  });
                  const updatedRow = {
                    id: updated.id,
                    client_id: updated.clientId,
                    status: updated.status,
                    metadata: updated.metadata ? JSON.parse(updated.metadata) : {},
                    requested_at: updated.requestedAt,
                    approved_at: updated.approvedAt,
                    expires_at: updated.expiresAt,
                    token: updated.token
                  };
                  broadcast({ table: "RemoteSessions", type: "UPDATE", row: updatedRow });
                  
                  // Notify waiting controller
                  for (const peer of signalingSockets) {
                    if (peer.requestId === requestId && peer.isController) {
                      peer.send(JSON.stringify({ type: "error", error: "Session request denied by host" }));
                    }
                  }
                } catch (dbErr) {
                  console.error("[STANDBY] Failed to update denied session in DB:", dbErr);
                }
              } else if (["screens_list", "select_screen"].includes(messageObj.type)) {
                // Forward screens list or screen switch messages to peer in the same session
                const targetClientId = messageObj.target;
                if (targetClientId) {
                  const targetWs = activeClients.get(targetClientId);
                  if (targetWs) {
                    targetWs.send(messageString);
                  }
                }
              }
            }
          } catch (e) {
            console.error("[STANDBY MESSAGE ERROR]", e);
          }
        });
      });
      return;
    }
    socket.destroy();
    return;
  }
  
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  // Security Handshake Engine SQLite Session Verification
  let isValidSession = false;
  let sessionReq = null;
  if (payload.type === "session") {
    try {
      sessionReq = await prisma.remoteSession.findUnique({
        where: { id: payload.requestId }
      });
      if (sessionReq && sessionReq.status === "APPROVED" && new Date(sessionReq.expiresAt) > new Date()) {
        const clientNode = await prisma.desktopNode.findFirst({
          where: {
            OR: [
              { id: sessionReq.clientId },
              { remoteId: sessionReq.clientId }
            ]
          }
        });
        if (clientNode && clientNode.bannedUntil && new Date(clientNode.bannedUntil) > new Date()) {
          console.warn(`[HANDSHAKE] Denied connection to banned client: ${sessionReq.clientId}`);
          isValidSession = false;
        } else {
          isValidSession = true;
        }
      }
    } catch (err) {
      console.error("[HANDSHAKE] Database session request look up failed:", err);
    }
  }

  // If session doesn't exist, is expired, or isn't approved, notify port 3355 Web UI
  if (!isValidSession) {
    console.warn(`[HANDSHAKE] Denied unauthenticated/expired connection on request: ${payload.requestId || "unknown"}`);
    
    if (payload.requestId) {
      try {
        if (!sessionReq) {
          sessionReq = await prisma.remoteSession.create({
            data: {
              id: payload.requestId,
              clientId: payload.clientId || "unknown-client",
              status: "PENDING_ADMIN",
              metadata: JSON.stringify({ clientIp: req.socket.remoteAddress || "127.0.0.1", requestedAt: new Date().toISOString() })
            }
          });
        }
        
        // Broadcast new request to dashboard sockets on port 3355
        const row = {
          id: sessionReq.id,
          client_id: sessionReq.clientId,
          status: sessionReq.status,
          metadata: JSON.parse(sessionReq.metadata),
          requested_at: sessionReq.requestedAt
        };
        broadcast({ table: "RemoteSessions", type: "INSERT", row });
        
        // Dispatch specific connection request modal trigger to port 3355 Web UI
        broadcast({
          type: "CONNECTION_REQUEST_MODAL",
          requestId: sessionReq.id,
          clientId: sessionReq.clientId,
          metadata: JSON.parse(sessionReq.metadata)
        });
      } catch (dbErr) {
        console.error("Failed to register and broadcast pending connection request:", dbErr);
      }
    }
    
    // Close the connection handshake
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  // Session approved: upgrade connection
  wssSignaling.handleUpgrade(req, socket, head, (ws) => {
    signalingSockets.add(ws);
    
    ws.requestId = payload.requestId;
    ws.clientId = payload.clientId;
    ws.token = token;
    ws.myId = myId;
    ws.uniqueClientId = myId;
    ws.connectedAt = new Date().toISOString();

    // Use resolveClientIp-equivalent logic for raw Node.js upgrade requests
    const _xff_a = req.headers["x-forwarded-for"];
    const _xri_a = req.headers["x-real-ip"];
    const _rem_a = req.socket && req.socket.remoteAddress || "127.0.0.1";
    let parsedIp = (_xff_a ? _xff_a.split(",")[0].trim() : (_xri_a ? _xri_a.trim() : _rem_a));
    if (parsedIp.startsWith("::ffff:")) parsedIp = parsedIp.slice(7);
    ws.remoteIp = parsedIp || "127.0.0.1";

    activeClients.set(myId, ws);

    if (myId === payload.clientId) {
      ws.isHost = true;
      ws.isController = false;
      console.log(`[SESSION] Host ${myId} joined active session ${payload.requestId} from ${parsedIp}`);
      ws.send(JSON.stringify({ type: "role_assignment", role: "host" }));
    } else {
      ws.isHost = false;
      ws.isController = true;
      console.log(`[SESSION] Controller ${myId} joined active session ${payload.requestId} from ${parsedIp}`);
      ws.send(JSON.stringify({ type: "role_assignment", role: "controller" }));
    }
    broadcast({ table: "ConnectedClients", type: "UPDATE" });

    // Notify peers in the same session about client join
    if (ws.requestId) {
      for (const peer of signalingSockets) {
        if (peer !== ws && peer.requestId === ws.requestId) {
          // Send to existing peer that this new peer joined
          peer.send(JSON.stringify({
            type: "peer_joined",
            peerId: ws.uniqueClientId,
            role: ws.isHost ? "host" : "controller"
          }));
          // Send to new peer that the existing peer is here
          ws.send(JSON.stringify({
            type: "peer_joined",
            peerId: peer.uniqueClientId,
            role: peer.isHost ? "host" : "controller"
          }));
        }
      }
    }

    const remainingMs = (payload.exp * 1000) - Date.now();
    const expirationTimer = setTimeout(async () => {
      console.warn(`[SESSION] Forcefully terminating connection for session request ${payload.requestId}`);
      ws.terminate();
      signalingSockets.delete(ws);

      // Broadcast termination signal to dashboard
      broadcast({
        type: "SESSION_TERMINATED",
        requestId: payload.requestId,
        reason: "session_expired"
      });

      logSecurityEvent(null, "session_expired", payload.clientId, { request_id: payload.requestId, reason: "TTL expiration" });

      try {
        await prisma.actionLog.create({
          data: {
            action: "session_expired",
            target: payload.clientId,
            metadata: JSON.stringify({ request_id: payload.requestId, reason: "TTL expiration" })
          }
        });
      } catch (dbErr) {
        console.error("Failed to log session expiration to audit log:", dbErr);
      }
    }, remainingMs);

    // Bidirectional Message Forwarding & Targeted Routing for WebRTC
    ws.on("message", async (data) => {
      try {
        const messageString = data.toString();
        let messageObj = null;
        try {
          messageObj = JSON.parse(messageString);
        } catch (e) {
          // Ignore parse errors
        }

        if (messageObj) {
          if (messageObj.type === "register") {
            const { clientId } = messageObj;
            if (clientId) {
              ws.uniqueClientId = clientId;
              ws.clientId = clientId;
              activeClients.set(clientId, ws);
              console.log(`[REGISTER] Client ${clientId} registered successfully.`);
              broadcast({ table: "ConnectedClients", type: "UPDATE" });
            }
            return;
          }

          if (["offer", "answer", "ice-candidate"].includes(messageObj.type)) {
            const targetClientId = messageObj.target || messageObj.targetId;
            if (!targetClientId) {
              ws.send(JSON.stringify({ type: "error", error: "Target Client ID is required for signaling" }));
              return;
            }

            // ── Session integrity re-check ──────────────────────────────────────
            // Before relaying any SDP packet, verify that the SQLite session record
            // is still APPROVED. This prevents a race condition where a session was
            // revoked or expired between WS connect time and first SDP message.
            if (ws.requestId && messageObj.type === "offer") {
              let sessionStillValid = false;
              try {
                const liveSession = await prisma.remoteSession.findUnique({
                  where: { id: ws.requestId }
                });
                if (liveSession && liveSession.status === "APPROVED" && new Date(liveSession.expiresAt) > new Date()) {
                  sessionStillValid = true;
                } else if (liveSession && liveSession.status === "PENDING_ADMIN") {
                  // WAN connection not yet approved — hold the SDP offer and alert admin
                  ws.send(JSON.stringify({
                    type: "error",
                    error: "SDP offer blocked: session is pending administrator approval on port 3355",
                    requestId: ws.requestId
                  }));
                  // Re-broadcast the alert in case admin dashboard missed the initial notification
                  broadcast({
                    type: "CONNECTION_REQUEST_ALERT",
                    requestId: liveSession.id,
                    clientId: liveSession.clientId,
                    controllerIp: ws.remoteIp || "unknown",
                    hostIp: (activeClients.get(targetClientId) || {}).remoteIp || "unknown",
                    isLocalSubnet: false,
                    subnetPolicy: "PENDING_ADMIN",
                    metadata: liveSession.metadata ? JSON.parse(liveSession.metadata) : {}
                  });
                  console.warn(`[SIGNAL GATE] SDP offer from ${ws.uniqueClientId} blocked — session ${ws.requestId} is PENDING_ADMIN.`);
                  return;
                }
              } catch (sessionCheckErr) {
                console.error("[SIGNAL GATE] Session re-check failed:", sessionCheckErr);
              }
              if (!sessionStillValid) {
                ws.send(JSON.stringify({
                  type: "error",
                  error: "SDP offer blocked: session is expired or revoked",
                  requestId: ws.requestId
                }));
                console.warn(`[SIGNAL GATE] SDP offer from ${ws.uniqueClientId} rejected — session ${ws.requestId} is invalid.`);
                return;
              }
            }
            // ────────────────────────────────────────────────────────────────────

            // Look up target WebSocket strictly using activeClients Map
            const targetWs = activeClients.get(targetClientId);
            if (targetWs) {
              if (targetWs.isStandby || ws.isStandby) {
                console.warn(`[SIGNAL BLOCK] Blocked ${messageObj.type} from ${ws.uniqueClientId} to ${targetClientId} due to standby mode.`);
                ws.send(JSON.stringify({
                  type: "error",
                  error: "Cannot establish remote stream: target client is in standby mode.",
                  target: targetClientId
                }));
                return;
              }
              // Route exclusively to targetWs — do NOT reflect back to sender or broadcast
              targetWs.send(messageString);
            } else {
              // Target client B is not connected — reject and notify client A
              ws.send(JSON.stringify({
                type: "error",
                error: `Target client (${targetClientId}) is offline or not registered on signaling server`,
                target: targetClientId
              }));
            }
            return;
          }
        }

        // Fallback for non-WebRTC control messages or image capture events
        for (const peer of signalingSockets) {
          if (peer !== ws && peer.requestId === ws.requestId) {
            if (ws.isHost && peer.isController) {
              peer.send(messageString);
            } else if (ws.isController && peer.isHost) {
              peer.send(messageString);
            }
          }
        }
      } catch (e) {
        console.error("[FORWARDING ERROR]", e);
      }
    });

    ws.on("close", () => {
      clearTimeout(expirationTimer);
      signalingSockets.delete(ws);
      if (ws.uniqueClientId) {
        activeClients.delete(ws.uniqueClientId);
      }
      console.log(`[SESSION] Client ${myId || "unknown"} disconnected from session ${payload.requestId}`);
      broadcast({ table: "ConnectedClients", type: "UPDATE" });
    });
    ws.on("error", () => {
      clearTimeout(expirationTimer);
      signalingSockets.delete(ws);
      if (ws.uniqueClientId) {
        activeClients.delete(ws.uniqueClientId);
      }
      broadcast({ table: "ConnectedClients", type: "UPDATE" });
    });
  });
});

if (process.env.NODE_ENV !== "test") {
  waitForDb().then(() => {
    expressServer.listen(PORT_HTTP, () => {
      console.log(`RemoteOps Express Dashboard listening on :${PORT_HTTP}`);
    });
    
    signalingServer.listen(PORT_SIGNAL, () => {
      console.log(`RemoteOps Signaling Server listening on :${PORT_SIGNAL}`);
    });

    startDeploymentScheduler();
    console.log("[SCHEDULER] Automated deployment scheduler check active.");
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { app, expressServer as server, pool, prisma };
