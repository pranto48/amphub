import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set environment variables before importing index.js
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-key-for-updates-123456";
process.env.UPDATE_SHARED_SECRET = "test-update-shared-secret-key-789";

// Clean any previous test directories
const sharedDir = path.join(__dirname, "update-shared");
if (fs.existsSync(sharedDir)) {
  fs.rmSync(sharedDir, { recursive: true, force: true });
}

// Mock git-sha.txt file for testing
const localShaPath = path.join(__dirname, "git-sha.txt");
const mockSha = "abc123mockgitcommitsha789xyz";
fs.writeFileSync(localShaPath, mockSha, "utf8");

// Import server components
const { app, server, pool } = await import("./src/index.js");

// Mock Query Handler
global.mockDbQuery = async (text, params) => {
  if (text.includes("SELECT 1 FROM user_roles") || (text.includes("Users") && text.includes("role='admin'"))) {
    return { rows: [{ 1: 1 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

// Start server on random free port
let port;
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    port = server.address().port;
    console.log(`Test server running on port ${port}`);
    resolve();
  });
});

const baseUrl = `http://127.0.0.1:${port}`;

async function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}${path}`;
    const parsedUrl = new URL(url);
    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null
          });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const adminToken = jwt.sign({ sub: "admin-uuid", email: "admin@test.com" }, process.env.JWT_SECRET);

async function runTests() {
  console.log("--- Running Integration Tests for System Updates System ---");

  // Test 1: Get update status (no auth)
  console.log("\n[Test 1] Get status without authentication...");
  const statusNoAuth = await makeRequest("GET", "/api/v1/system/status");
  assert.strictEqual(statusNoAuth.status, 401);
  console.log("-> Pass!");

  // Test 2: Get update status with admin auth
  console.log("\n[Test 2] Get status with Admin authentication...");
  const statusAuth = await makeRequest("GET", "/api/v1/system/status", null, {
    "Authorization": `Bearer ${adminToken}`
  });
  assert.strictEqual(statusAuth.status, 200);
  assert.strictEqual(statusAuth.body.current_commit, mockSha);
  assert.ok(statusAuth.body.remote_commit);
  assert.ok(statusAuth.body.update_available);
  assert.ok(statusAuth.body.last_checked);
  console.log("-> Pass! Output:", statusAuth.body);

  // Test 3: Toggle auto-update mode
  console.log("\n[Test 3] Toggle auto-update mode to true...");
  const toggleRes = await makeRequest("POST", "/api/v1/system/auto-update", { enabled: true }, {
    "Authorization": `Bearer ${adminToken}`
  });
  assert.strictEqual(toggleRes.status, 200);
  assert.strictEqual(toggleRes.body.autoUpdateEnabled, true);
  console.log("-> Pass!");

  // Check config file persistence
  const configFile = path.join(sharedDir, "config.json");
  assert.ok(fs.existsSync(configFile), `Config file should exist at ${configFile}`);
  const configContent = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.strictEqual(configContent.autoUpdateEnabled, true);
  console.log("-> Config persistence verified at", configFile);

  // Test 4: Trigger update manually
  console.log("\n[Test 4] Trigger system update manually...");
  const triggerRes = await makeRequest("POST", "/api/v1/system/trigger-update", null, {
    "Authorization": `Bearer ${adminToken}`
  });
  assert.strictEqual(triggerRes.status, 200);
  assert.strictEqual(triggerRes.body.payload.status, "TRIGGERED");
  assert.strictEqual(triggerRes.body.payload.requested_by, "admin@test.com");
  assert.ok(triggerRes.body.payload.timestamp);
  assert.ok(triggerRes.body.payload.auth_signature);
  console.log("-> Pass! Payload:", triggerRes.body.payload);

  // Verify trigger.json file content
  const triggerPath = path.join(sharedDir, "trigger.json");
  assert.ok(fs.existsSync(triggerPath), `Trigger file should exist at ${triggerPath}`);
  const triggerFileContent = JSON.parse(fs.readFileSync(triggerPath, "utf8"));
  assert.strictEqual(triggerFileContent.status, "TRIGGERED");
  assert.strictEqual(triggerFileContent.requested_by, "admin@test.com");

  // Verify HMAC-SHA256 signature in generated payload
  const timestamp = triggerRes.body.payload.timestamp;
  const signature = triggerRes.body.payload.auth_signature;
  const secret = process.env.UPDATE_SHARED_SECRET;
  const expectedSignature = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
  assert.strictEqual(signature, expectedSignature);
  console.log("-> Cryptographic signature validation passes!");

  // Clean up mock files
  try {
    if (fs.existsSync(localShaPath)) {
      fs.unlinkSync(localShaPath);
    }
    if (fs.existsSync(sharedDir)) {
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Cleanup failed:", err);
  }

  console.log("\nALL SYSTEM UPDATE TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
