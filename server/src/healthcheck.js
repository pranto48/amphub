import http from "node:http";

const PORT = process.env.PORT || 4000;

const options = {
  hostname: "127.0.0.1",
  port: PORT,
  path: "/api/health",
  timeout: 2000,
};

const req = http.get(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  }
  process.exit(1);
});

req.on("error", (err) => {
  console.error("Health check failed:", err.message);
  process.exit(1);
});

req.end();
