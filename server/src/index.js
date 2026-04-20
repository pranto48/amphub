import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pg from "pg";
import { WebSocketServer } from "ws";
import { z } from "zod";
import http from "node:http";
import { URL } from "node:url";

const {
  PORT = 4000,
  DATABASE_URL = "postgres://remoteops:remoteops@db:5432/remoteops",
  JWT_SECRET = "change-me-in-production",
  CORS_ORIGIN = "*",
} = process.env;

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Wait for Postgres to be ready (compose ordering is best-effort)
async function waitForDb() {
  for (let i = 0; i < 30; i++) {
    try { await pool.query("SELECT 1"); return; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error("Postgres not reachable");
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// ---------- helpers ----------
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
  const { rows } = await pool.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role='admin'", [userId]);
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
    const { rows } = await pool.query(
      "INSERT INTO users(email, password_hash) VALUES($1,$2) RETURNING id, email",
      [email, hash]
    );
    const user = rows[0];
    await pool.query("INSERT INTO profiles(id,email,display_name) VALUES($1,$2,$3)", [user.id, email, displayName]);
    await pool.query("INSERT INTO user_roles(user_id, role) VALUES($1,'user')", [user.id]);
    res.json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const parsed = credSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password } = parsed.data;
  const { rows } = await pool.query("SELECT id, email, password_hash FROM users WHERE email=$1", [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const user = { id: u.id, email: u.email };
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
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user.id]);
  res.status(204).end();
});

// ---------- profiles ----------
app.get("/api/profiles/:id", authRequired, async (req, res) => {
  const { rows } = await pool.query("SELECT id,email,display_name FROM profiles WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
});

app.patch("/api/profiles/:id", authRequired, async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: "Cannot edit other profiles" });
  const parsed = z.object({ display_name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  await pool.query("UPDATE profiles SET display_name=$1, updated_at=now() WHERE id=$2",
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
         session_token=$3, expires_at=now() + interval '15 minutes' WHERE id=$1 RETURNING *`
    : `UPDATE access_requests SET status='denied', decided_at=now(), decided_by=$2 WHERE id=$1 RETURNING *`;
  const params = approve
    ? [req.params.id, req.user.id, crypto.randomUUID().replace(/-/g, "")]
    : [req.params.id, req.user.id];
  const { rows } = await pool.query(updateSql, params);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  await pool.query(
    "INSERT INTO audit_log(actor_id, action, target, metadata) VALUES($1,$2,$3,$4)",
    [req.user.id, approve ? "approve_access" : "deny_access", row.node_id, { request_id: row.id }]
  );
  broadcast({ table: "access_requests", type: "UPDATE", row });
  res.json(row);
});

// ---------- audit ----------
app.get("/api/audit", authRequired, adminOnly, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 200);
  const { rows } = await pool.query(
    "SELECT id, actor_id, action, target, metadata, created_at FROM audit_log ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  res.json(rows);
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- start ----------
const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  const token = url.searchParams.get("token");
  if (!token) { socket.destroy(); return; }
  try { jwt.verify(token, JWT_SECRET); }
  catch { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
    ws.on("error", () => sockets.delete(ws));
  });
});

waitForDb().then(() => {
  server.listen(PORT, () => console.log(`RemoteOps API listening on :${PORT}`));
}).catch((e) => { console.error(e); process.exit(1); });
