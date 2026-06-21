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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT_HTTP = 3355,
  PORT_SIGNAL = 7766,
  JWT_SECRET = "change-me-in-production",
  CORS_ORIGIN = "*",
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
    created_at: n.createdAt,
    updated_at: n.updatedAt
  });
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

// ---------- access requests ----------
app.post("/api/access-requests", authRequired, async (req, res) => {
  const parsed = z.object({ node_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  
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
  
  const clientIpRaw = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
  const clientIp = clientIpRaw.includes("::ffff:") ? clientIpRaw.split("::ffff:")[1] : clientIpRaw;
  
  const enrichedMetadata = {
    ...metadata,
    clientIp,
    requestedAt: new Date().toISOString()
  };

  try {
    const session = await prisma.remoteSession.create({
      data: {
        clientId,
        metadata: JSON.stringify(enrichedMetadata),
        status: "PENDING"
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
    logSecurityEvent(null, "session_request", clientId, { ip: clientIp });
    broadcast({ table: "RemoteSessions", type: "INSERT", row });
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
    if (sessionReq.status !== "PENDING") {
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
      where: { status: "PENDING" },
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
    if (sessionReq.status !== "PENDING") {
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

const signalingServer = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

// Security Handshake Engine
signalingServer.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  const token = url.searchParams.get("token");
  if (!token) { socket.destroy(); return; }
  
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
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
        isValidSession = true;
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
              status: "PENDING",
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

    ws.on("close", () => {
      clearTimeout(expirationTimer);
      signalingSockets.delete(ws);
    });
    ws.on("error", () => {
      clearTimeout(expirationTimer);
      signalingSockets.delete(ws);
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
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { app, expressServer as server, pool, prisma };
