import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.SQLITE_DB_PATH || '/app/data/amphub.db';

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log(`[DB-INIT] Initializing SQLite database at ${dbPath}`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 1. Users table (Consolidates users, profiles, and user_roles)
db.prepare(`
  CREATE TABLE IF NOT EXISTS Users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 2. RemoteSessions table (previously session_requests)
db.prepare(`
  CREATE TABLE IF NOT EXISTS RemoteSessions (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    metadata TEXT DEFAULT '{}',
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    expires_at TEXT,
    token TEXT
  )
`).run();

// 3. ActionLogs table (previously audit_log)
db.prepare(`
  CREATE TABLE IF NOT EXISTS ActionLogs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 4. AdminPermissions table (previously admin_access_policies)
db.prepare(`
  CREATE TABLE IF NOT EXISTS AdminPermissions (
    id TEXT PRIMARY KEY,
    auto_deny_outside_business_hours INTEGER NOT NULL DEFAULT 0,
    business_hours_start TEXT NOT NULL DEFAULT '08:00',
    business_hours_end TEXT NOT NULL DEFAULT '18:00',
    require_two_step_sensitive_nodes INTEGER NOT NULL DEFAULT 0,
    sensitive_node_ids TEXT NOT NULL DEFAULT '[]',
    max_session_duration_by_role TEXT NOT NULL DEFAULT '{"user": 30, "admin": 120}',
    updated_by TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 5. desktop_nodes table
db.prepare(`
  CREATE TABLE IF NOT EXISTS desktop_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    remote_id TEXT NOT NULL,
    local_ip TEXT NOT NULL,
    os TEXT NOT NULL DEFAULT 'windows',
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen TEXT,
    master_password_hash TEXT,
    owner_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 6. access_requests table
db.prepare(`
  CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    decided_by TEXT,
    session_token TEXT,
    expires_at TEXT
  )
`).run();

// --- Seed Initial Data ---

// Seed default policy row in AdminPermissions
db.prepare(`
  INSERT OR IGNORE INTO AdminPermissions (id)
  VALUES ('00000000-0000-0000-0000-000000000001')
`).run();

// Seed custom admin user: admin@amphub.com / Interst0ff
// bcrypt hash of "Interst0ff" (cost 10)
db.prepare(`
  INSERT OR IGNORE INTO Users (id, email, password_hash, display_name, role)
  VALUES ('00000000-0000-0000-0000-000000000002', 'admin@amphub.com',
          '$2b$10$3UFknKDg56eCZn2oKJeE3OXBC6UFn2kOhw8c9zUdobRIXI3tEgB96', 'Admin', 'admin')
`).run();

// Seed bootstrap admin user if BOOTSTRAP_DEFAULT_ADMIN is true
const bootstrapDefaultAdmin = String(process.env.BOOTSTRAP_DEFAULT_ADMIN || 'false').toLowerCase() === 'true';
if (bootstrapDefaultAdmin) {
  // bcrypt hash of "password" (cost 10)
  db.prepare(`
    INSERT OR IGNORE INTO Users (id, email, password_hash, display_name, role)
    VALUES ('00000000-0000-0000-0000-000000000001', 'admin@admin.com',
            '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'Administrator', 'admin')
  `).run();
  console.log('[DB-INIT] Seeded bootstrap admin user (admin@admin.com).');
}

// Seed default desktop nodes if table is empty
const nodeCount = db.prepare('SELECT COUNT(*) as count FROM desktop_nodes').get().count;
if (nodeCount === 0) {
  const insertNode = db.prepare(`
    INSERT INTO desktop_nodes (id, name, remote_id, local_ip, os, status, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const nodes = [
    ['00000000-0000-0000-0000-000000000003', 'Workstation-01', 'RM-7421-A19F', '192.168.1.42', 'windows', 'online', new Date().toISOString()],
    ['00000000-0000-0000-0000-000000000004', 'LinuxBox-Dev', 'RM-3308-C71B', '192.168.1.55', 'linux', 'online', new Date().toISOString()],
    ['00000000-0000-0000-0000-000000000005', 'FileServer', 'RM-9013-E22D', '192.168.1.10', 'linux', 'offline', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()]
  ];
  
  for (const node of nodes) {
    insertNode.run(...node);
  }
  console.log('[DB-INIT] Seeded default desktop nodes.');
}

console.log('[DB-INIT] SQLite database initialization complete.');
db.close();
