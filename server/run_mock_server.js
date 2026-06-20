// Mock server for administrative portal screenshot
process.env.NODE_ENV = "test";
process.env.PORT = "4000";
process.env.JWT_SECRET = "test-secret-key-for-sessions-123456";

// Import server
const { server, pool } = await import("./src/index.js");

// Dummy database data
const pendingRequests = [
  {
    id: "33333333-3333-3333-3333-333333333333",
    client_id: "Workstation-Win11",
    metadata: {
      clientIp: "192.168.1.105",
      requestedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    },
    status: "PENDING",
    requested_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    client_id: "DevBox-Ubuntu",
    metadata: {
      clientIp: "10.0.0.42",
      requestedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString()
    },
    status: "PENDING",
    requested_at: new Date(Date.now() - 12 * 60 * 1000).toISOString()
  }
];

const activeSessions = [
  {
    id: "55555555-5555-5555-5555-555555555555",
    client_id: "Prod-Database-Server",
    status: "APPROVED",
    approved_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString()
  }
];

// Mock database query handler
global.mockDbQuery = async (text, params) => {
  if (text.includes("SELECT * FROM session_requests") && text.includes("status = 'PENDING'")) {
    return { rows: pendingRequests, rowCount: pendingRequests.length };
  }
  if (text.includes("SELECT * FROM session_requests") && text.includes("status = 'APPROVED'")) {
    return { rows: activeSessions, rowCount: activeSessions.length };
  }
  if (text.includes("SELECT 1 FROM user_roles")) {
    return { rows: [{ 1: 1 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

// Start the server
server.listen(4000, "127.0.0.1", () => {
  console.log("Mock Admin Server running on http://127.0.0.1:4000");
});
