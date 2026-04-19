#!/usr/bin/env node
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { homedir, hostname, networkInterfaces, platform } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const APP_NAME = 'amphub-agent';
const IS_WINDOWS = platform() === 'win32';
const BASE_DIR = IS_WINDOWS
  ? process.env.PROGRAMDATA || join(homedir(), 'AppData', 'Local', APP_NAME)
  : '/etc/amphub-agent';
const STATE_DIR = IS_WINDOWS
  ? process.env.PROGRAMDATA || join(homedir(), 'AppData', 'Local', APP_NAME)
  : '/var/lib/amphub-agent';

const DEFAULT_CONFIG_PATH = join(BASE_DIR, 'config.json');
const DEFAULT_STATE_PATH = join(STATE_DIR, 'state.json');

function clampHeartbeatSeconds(value) {
  const seconds = Number(value ?? 15);
  if (Number.isNaN(seconds)) return 15;
  return Math.min(30, Math.max(10, seconds));
}

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(path, data) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

function buildFingerprint() {
  const nics = networkInterfaces();
  const nicSummary = Object.values(nics)
    .flat()
    .filter(Boolean)
    .map((ni) => `${ni.mac || 'na'}-${ni.family}-${ni.internal}`)
    .sort()
    .join('|');

  const material = [
    hostname(),
    process.arch,
    process.platform,
    process.env.PROCESSOR_IDENTIFIER || '',
    nicSummary,
  ].join('::');

  return createHash('sha256').update(material).digest('hex');
}

function resolvePrimaryIp() {
  const nics = networkInterfaces();
  for (const entries of Object.values(nics)) {
    for (const entry of entries || []) {
      if (!entry.internal && entry.family === 'IPv4') return entry.address;
    }
  }
  return '127.0.0.1';
}

function generateNodeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

async function loadConfig(configPath, statePath) {
  let config;
  try {
    config = await readJson(configPath);
  } catch {
    throw new Error(`Missing config: ${configPath}. Run with "init-config" first.`);
  }

  let state = {};
  try {
    state = await readJson(statePath);
  } catch {
    state = {};
  }

  if (!config.remote_id) config.remote_id = state.remote_id || randomUUID();

  if (!config.private_key || !config.public_key) {
    const keys = generateNodeKeys();
    config.private_key = keys.privateKeyPem;
    config.public_key = keys.publicKeyPem;
  }

  await writeJson(configPath, config);
  await writeJson(statePath, { ...state, remote_id: config.remote_id });

  return config;
}

async function initConfig(configPath) {
  const template = {
    central_server_url: 'https://central.example.com',
    node_name: hostname(),
    remote_id: randomUUID(),
    private_key: '',
    public_key: '',
    node_token: '',
    node_certificate: '',
    heartbeat_seconds: 15,
  };

  if (!template.private_key || !template.public_key) {
    const keys = generateNodeKeys();
    template.private_key = keys.privateKeyPem;
    template.public_key = keys.publicKeyPem;
  }

  await writeJson(configPath, template);
  await writeJson(DEFAULT_STATE_PATH, { remote_id: template.remote_id });
  console.log(`Initialized config at ${configPath}`);
}

async function enroll(config, configPath) {
  if (config.node_token && config.node_certificate) return config;

  const body = {
    remote_id: config.remote_id,
    node_name: config.node_name,
    hostname: hostname(),
    os: `${process.platform}/${process.arch}`,
    hardware_fingerprint: buildFingerprint(),
    public_key: config.public_key,
  };

  const response = await fetch(`${config.central_server_url}/api/agent/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Enrollment failed (${response.status}): ${text}`);
  }

  const enrollment = await response.json();
  config.node_token = enrollment.node_token;
  config.node_certificate = enrollment.node_certificate;
  config.remote_id = enrollment.remote_id || config.remote_id;

  await writeJson(configPath, config);
  await writeJson(DEFAULT_STATE_PATH, { remote_id: config.remote_id });
  console.log(`Enrollment complete for ${config.node_name} (${config.remote_id})`);

  return config;
}

async function sendHeartbeat(config, status = 'online') {
  const payload = {
    remote_id: config.remote_id,
    node_name: config.node_name,
    status,
    local_ip: resolvePrimaryIp(),
    last_seen: new Date().toISOString(),
    os: `${process.platform}/${process.arch}`,
  };

  const response = await fetch(`${config.central_server_url}/api/agent/heartbeat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.node_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Heartbeat failed (${response.status}): ${text}`);
  }
}

async function revoke(config) {
  if (!config.node_token) return;

  await fetch(`${config.central_server_url}/api/agent/revoke`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.node_token}`,
    },
    body: JSON.stringify({ remote_id: config.remote_id, status: 'inactive' }),
  });
}

async function runAgent(configPath, statePath) {
  let config = await loadConfig(configPath, statePath);
  config = await enroll(config, configPath);
  const heartbeatSeconds = clampHeartbeatSeconds(config.heartbeat_seconds);
  console.log(`Starting heartbeat loop (${heartbeatSeconds}s)`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await sendHeartbeat(config, 'offline');
      await revoke(config);
    } catch (error) {
      console.error(`Shutdown cleanup warning: ${error.message}`);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    try {
      await sendHeartbeat(config, 'online');
    } catch (error) {
      console.error(error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, heartbeatSeconds * 1000));
  }
}

async function runCleanup(configPath, statePath) {
  const config = await loadConfig(configPath, statePath);
  await sendHeartbeat(config, 'offline');
  await revoke(config);
  await writeJson(statePath, { remote_id: config.remote_id, revoked_at: new Date().toISOString() });
  console.log('Cleanup complete: node marked inactive and token revoked.');
}

const command = process.argv[2] || 'run';
const configPath = process.env.AMPHUB_AGENT_CONFIG || DEFAULT_CONFIG_PATH;
const statePath = process.env.AMPHUB_AGENT_STATE || DEFAULT_STATE_PATH;

if (command === 'init-config') {
  await initConfig(configPath);
} else if (command === 'cleanup') {
  await runCleanup(configPath, statePath);
} else {
  await runAgent(configPath, statePath);
}
