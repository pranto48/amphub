import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
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
  PORT = 4000,
  DATABASE_URL = "postgres://remoteops:remoteops@db:5432/remoteops",
  JWT_SECRET = "change-me-in-production",
  CORS_ORIGIN = "*",
  SQLITE_DB_PATH = "/app/data/amphub.db",
} = process.env;

class SqlitePool {
  constructor(dbPath) {
    if (process.env.NODE_ENV === "test") {
      this.isTest = true;
      return;
    }
    this.isTest = false;
    
    // Ensure parent directory exists before creating Database connection
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    
    // Register custom SQL functions to match Postgres schema functions
    this.db.function("gen_random_uuid", () => crypto.randomUUID());
    this.db.function("now", () => new Date().toISOString());
  }

  async query(text, params = []) {
    if (this.isTest) {
      if (global.mockDbQuery) return global.mockDbQuery(text, params);
      return { rows: [], rowCount: 0 };
    }

    // Convert Postgres $1, $2 placeholders to SQLite ?
    const sqliteSql = text.replace(/\$\d+/g, "?");
    const isSelectOrReturning = /^\s*(select|with)/i.test(sqliteSql) || /returning/i.test(sqliteSql);

    try {
      const stmt = this.db.prepare(sqliteSql);
      if (isSelectOrReturning) {
        const rows = stmt.all(...params);
        
        // Post-process JSON fields back to objects for API compatibility
        const JSON_COLUMNS = new Set(["metadata", "sensitive_node_ids", "max_session_duration_by_role"]);
        for (const row of rows) {
          for (const col of JSON_COLUMNS) {
            if (row[col] !== undefined && typeof row[col] === "string") {
              try {
                row[col] = JSON.parse(row[col]);
              } catch (e) {
                // leave as string if parse fails
              }
            }
          }
        }
        
        return {
          rows,
          rowCount: rows.length
        };
      } else {
        const info = stmt.run(...params);
        return {
          rows: [],
          rowCount: info.changes
        };
      }
    } catch (err) {
      console.error(`Database error executing: ${sqliteSql}`, err);
      throw err;
    }
  }
}

const pool = new SqlitePool(SQLITE_DB_PATH);

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

// Initialize the database on startup (creating tables and seeding default data)
async function waitForDb() {
  if (process.env.NODE_ENV === "test") return;
  await import("./db-init.js");
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
    // Fail silently or print to stdout if log file directory is not writable/present
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
  const { rows } = await pool.query("SELECT 1 FROM Users WHERE id=$1 AND role='admin'", [userId]);
  return rows.length > 0;
}

function adminOnly(req, res, next) {
  isAdmin(req.user.id).then((ok) => ok ? next() : res.status(403).json({ error: "Admin required" }));
}

// ---------- realtime broadcast ----------
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();
function broadcast(evt) {
  const data = JSON.stringify(evt);
  for (const ws of sockets) { try { ws.send(data); } catch { /* drop */ } }
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
    const userId = crypto.randomUUID();
    const { rows } = await pool.query(
      "INSERT INTO Users(id, email, password_hash, display_name, role) VALUES($1,$2,$3,$4,$5) RETURNING id, email",
      [userId, email, hash, displayName, "user"]
    );
    const user = rows[0];
    logSecurityEvent(user.id, "user_signup", user.email, { ip: req.ip });
    res.json({ token: signToken(user), user });
  } catch (e) {
    if (e.message && (e.message.includes("UNIQUE constraint failed") || e.code === "23505")) {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = credSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password } = parsed.data;
  const { rows } = await pool.query("SELECT id, email, password_hash FROM Users WHERE email=$1", [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
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
  await pool.query("UPDATE Users SET password_hash=$1, updated_at=now() WHERE id=$2", [hash, req.user.id]);
  res.status(204).end();
});

// ---------- profiles ----------
app.get("/api/profiles/:id", authRequired, async (req, res) => {
  const { rows } = await pool.query("SELECT id,email,display_name FROM Users WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.patch("/api/profiles/:id", authRequired, async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: "Cannot edit other profiles" });
  const parsed = z.object({ display_name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await pool.query("UPDATE Users SET display_name=$1, updated_at=now() WHERE id=$2",
    [parsed.data.display_name, req.user.id]);
  res.status(204).end();
});

// ---------- desktop nodes ----------
app.get("/api/nodes", authRequired, async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM desktop_nodes ORDER BY name");
  res.json(rows);
});

app.get("/api/nodes/:id", authRequired, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM desktop_nodes WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.post("/api/nodes/:id/master-password", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ hash: z.string().min(8).max(256) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const r = await pool.query(
    "UPDATE desktop_nodes SET master_password_hash=$1, updated_at=now() WHERE id=$2 RETURNING id",
    [parsed.data.hash, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// ---------- access requests ----------
app.post("/api/access-requests", authRequired, async (req, res) => {
  const parsed = z.object({ node_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { rows } = await pool.query(
    `INSERT INTO access_requests(node_id, requester_id, status)
     VALUES($1,$2,'pending') RETURNING *`,
    [parsed.data.node_id, req.user.id]
  );
  const row = rows[0];
  broadcast({ table: "access_requests", type: "INSERT", row });
  res.json(row);
});

app.get("/api/access-requests", authRequired, async (req, res) => {
  const status = req.query.status;
  const adminFlag = await isAdmin(req.user.id);
  let q, params;
  if (status === "pending") {
    if (!adminFlag) return res.status(403).json({ error: "Admin required" });
    q = "SELECT * FROM access_requests WHERE status='pending' ORDER BY requested_at DESC";
    params = [];
  } else {
    q = adminFlag
      ? "SELECT * FROM access_requests ORDER BY requested_at DESC LIMIT 100"
      : "SELECT * FROM access_requests WHERE requester_id=$1 ORDER BY requested_at DESC LIMIT 100";
    params = adminFlag ? [] : [req.user.id];
  }
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

app.get("/api/access-requests/:id", authRequired, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM access_requests WHERE id=$1", [req.params.id]);
  const r = rows[0];
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.requester_id !== req.user.id && !(await isAdmin(req.user.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json(r);
});

app.post("/api/access-requests/:id/decision", authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ approve: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { approve } = parsed.data;
  const updateSql = approve
    ? `UPDATE access_requests SET status='approved', decided_at=now(), decided_by=$2,
         session_token=$3, expires_at=datetime(now(), '+15 minutes') WHERE id=$1 RETURNING *`
    : `UPDATE access_requests SET status='denied', decided_at=now(), decided_by=$2 WHERE id=$1 RETURNING *`;
  const params = approve
    ? [req.params.id, req.user.id, crypto.randomUUID().replace(/-/g, "")]
    : [req.params.id, req.user.id];
  const { rows } = await pool.query(updateSql, params);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  await pool.query(
    "INSERT INTO ActionLogs(id, actor_id, action, target, metadata) VALUES($1,$2,$3,$4,$5)",
    [crypto.randomUUID(), req.user.id, approve ? "approve_access" : "deny_access", row.node_id, JSON.stringify({ request_id: row.id })]
  );
  broadcast({ table: "access_requests", type: "UPDATE", row });
  res.json(row);
});

// ---------- audit ----------
app.get("/api/audit", authRequired, adminOnly, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 200);
  const { rows } = await pool.query(
    "SELECT id, actor_id, action, target, metadata, created_at FROM ActionLogs ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
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
  
  // Extract client IP address
  const clientIpRaw = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";
  const clientIp = clientIpRaw.includes("::ffff:") ? clientIpRaw.split("::ffff:")[1] : clientIpRaw;
  
  const enrichedMetadata = {
    ...metadata,
    clientIp,
    requestedAt: new Date().toISOString()
  };

  try {
    const { rows } = await pool.query(
      `INSERT INTO RemoteSessions (id, client_id, metadata, status)
       VALUES (gen_random_uuid(), $1, $2, 'PENDING')
       RETURNING *`,
      [clientId, JSON.stringify(enrichedMetadata)]
    );
    const row = rows[0];
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
    const { rows } = await pool.query(
      "SELECT * FROM RemoteSessions WHERE id = $1",
      [requestId]
    );
    const sessionReq = rows[0];
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
        clientId: sessionReq.client_id,
        exp: T_expiry_seconds
      },
      JWT_SECRET
    );

    const updateResult = await pool.query(
      `UPDATE RemoteSessions
       SET status = 'APPROVED', approved_at = $2, expires_at = $3, token = $4
       WHERE id = $1
       RETURNING *`,
      [requestId, approvedAt, expiresAt, token]
    );
    const updatedRow = updateResult.rows[0];

    await pool.query(
      "INSERT INTO ActionLogs (id, actor_id, action, target, metadata) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
      [req.user.id, "approve_session", sessionReq.client_id, JSON.stringify({ request_id: requestId, ttl_minutes: ttlMinutes })]
    );

    logSecurityEvent(req.user.id, "approve_session", sessionReq.client_id, { request_id: requestId, ttl_minutes: ttlMinutes });

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
    const { rows } = await pool.query(
      "SELECT * FROM RemoteSessions WHERE status = 'PENDING' ORDER BY requested_at DESC"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/sessions/active", authRequired, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM RemoteSessions 
       WHERE status = 'APPROVED' AND expires_at > now() 
       ORDER BY approved_at DESC`
    );
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
    const { rows } = await pool.query(
      "SELECT * FROM RemoteSessions WHERE id = $1",
      [requestId]
    );
    const sessionReq = rows[0];
    if (!sessionReq) {
      return res.status(404).json({ error: "Session request not found" });
    }
    if (sessionReq.status !== "PENDING") {
      return res.status(400).json({ error: `Session request is already ${sessionReq.status}` });
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE RemoteSessions
       SET status = 'DENIED', decided_at = now(), decided_by = $2
       WHERE id = $1
       RETURNING *`,
      [requestId, req.user.id]
    );
    const updatedRow = updatedRows[0];

    await pool.query(
      "INSERT INTO ActionLogs (id, actor_id, action, target, metadata) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
      [req.user.id, "deny_session", sessionReq.client_id, JSON.stringify({ request_id: requestId })]
    );

    logSecurityEvent(req.user.id, "deny_session", sessionReq.client_id, { request_id: requestId });

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
    const { rows } = await pool.query(
      "SELECT * FROM RemoteSessions WHERE id = $1",
      [requestId]
    );
    const sessionReq = rows[0];
    if (!sessionReq) {
      return res.status(404).json({ error: "Session request not found" });
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE RemoteSessions
       SET status = 'REVOKED', decided_at = now(), decided_by = $2
       WHERE id = $1
       RETURNING *`,
      [requestId, req.user.id]
    );
    const updatedRow = updatedRows[0];

    // Find and terminate matching WebSocket connections
    let terminatedCount = 0;
    for (const ws of sockets) {
      if (ws.requestId === requestId) {
        ws.terminate();
        sockets.delete(ws);
        terminatedCount++;
      }
    }

    await pool.query(
      "INSERT INTO ActionLogs (id, actor_id, action, target, metadata) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
      [req.user.id, "revoke_session", sessionReq.client_id, JSON.stringify({ request_id: requestId, terminated_connections: terminatedCount })]
    );

    logSecurityEvent(req.user.id, "revoke_session", sessionReq.client_id, { request_id: requestId, terminated_connections: terminatedCount });

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

// Run updates check initially and schedule it every 24 hours
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
    const { rows } = await pool.query("SELECT * FROM AdminPermissions LIMIT 1");
    if (rows[0]) {
      const row = rows[0];
      res.json({
        id: row.id,
        auto_deny_outside_business_hours: !!row.auto_deny_outside_business_hours,
        business_hours_start: row.business_hours_start,
        business_hours_end: row.business_hours_end,
        require_two_step_sensitive_nodes: !!row.require_two_step_sensitive_nodes,
        sensitive_node_ids: typeof row.sensitive_node_ids === "string" ? JSON.parse(row.sensitive_node_ids) : (row.sensitive_node_ids || []),
        max_session_duration_by_role: typeof row.max_session_duration_by_role === "string" 
          ? JSON.parse(row.max_session_duration_by_role) 
          : (row.max_session_duration_by_role || { user: 30, admin: 120 })
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
    const { rows } = await pool.query(
      `INSERT INTO AdminPermissions (
         id, auto_deny_outside_business_hours, business_hours_start, business_hours_end, 
         require_two_step_sensitive_nodes, sensitive_node_ids, max_session_duration_by_role, 
         updated_by, updated_at
       ) 
       VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         auto_deny_outside_business_hours = EXCLUDED.auto_deny_outside_business_hours,
         business_hours_start = EXCLUDED.business_hours_start,
         business_hours_end = EXCLUDED.business_hours_end,
         require_two_step_sensitive_nodes = EXCLUDED.require_two_step_sensitive_nodes,
         sensitive_node_ids = EXCLUDED.sensitive_node_ids,
         max_session_duration_by_role = EXCLUDED.max_session_duration_by_role,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [
        auto_deny_outside_business_hours,
        business_hours_start,
        business_hours_end,
        require_two_step_sensitive_nodes,
        JSON.stringify(sensitive_node_ids),
        JSON.stringify(max_session_duration_by_role),
        req.user.id
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve admin control portal
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- start ----------
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
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

  if (payload.type === "session") {
    const remainingMs = (payload.exp * 1000) - Date.now();
    if (remainingMs <= 0) {
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);

    if (payload.type === "session") {
      ws.requestId = payload.requestId;
      ws.clientId = payload.clientId;
      ws.token = token;

      const remainingMs = (payload.exp * 1000) - Date.now();
      const expirationTimer = setTimeout(async () => {
        console.warn(`[SESSION] Forcefully terminating connection for session request ${payload.requestId}`);
        ws.terminate();
        sockets.delete(ws);

        // Broadcast termination signal
        broadcast({
          type: "SESSION_TERMINATED",
          requestId: payload.requestId,
          reason: "session_expired"
        });

        logSecurityEvent(null, "session_expired", payload.clientId, { request_id: payload.requestId, reason: "TTL expiration" });

        // Log the event
        try {
          await pool.query(
            "INSERT INTO ActionLogs (id, actor_id, action, target, metadata) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
            [null, "session_expired", payload.clientId, JSON.stringify({ request_id: payload.requestId, reason: "TTL expiration" })]
          );
        } catch (dbErr) {
          console.error("Failed to log session expiration to audit log:", dbErr);
        }
      }, remainingMs);

      ws.on("close", () => {
        clearTimeout(expirationTimer);
        sockets.delete(ws);
      });
      ws.on("error", () => {
        clearTimeout(expirationTimer);
        sockets.delete(ws);
      });
    } else {
      ws.on("close", () => sockets.delete(ws));
      ws.on("error", () => sockets.delete(ws));
    }
  });
});

if (process.env.NODE_ENV !== "test") {
  waitForDb().then(() => {
    server.listen(PORT, () => console.log(`RemoteOps API listening on :${PORT}`));
  }).catch((e) => { console.error(e); process.exit(1); });
}

export { app, server, pool };
