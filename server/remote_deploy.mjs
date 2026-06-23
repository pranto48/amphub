import { Client as SSHClient } from "ssh2";

const SSH_HOST = "192.168.9.9";
const SSH_USER = "it";
const SSH_PASS = "Interst0ff";
const ROOT_PASS = "Interst0ff";

const DEPLOY_CMD = [
  `cd /home/it/amphub`,
  `git pull origin main`,
  `echo "${ROOT_PASS}" | sudo -S mkdir -p /home/it/amphub/update-shared /home/it/amphub/data`,
  `echo "${ROOT_PASS}" | sudo -S chown -R 10001:10001 /home/it/amphub/update-shared /home/it/amphub/data`,
  `echo "${ROOT_PASS}" | sudo -S chmod -R 770 /home/it/amphub/update-shared /home/it/amphub/data`,
  `echo "${ROOT_PASS}" | sudo -S docker compose up --build -d`
].join(" && ");

function deployToServer() {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let output = "";
    let finished = false;

    const done = (err) => {
      if (finished) return;
      finished = true;
      conn.end();
      if (err) reject(err);
      else resolve(output);
    };

    conn.on("ready", () => {
      console.log(`[SSH] ✅ Connected to ${SSH_USER}@${SSH_HOST}`);
      console.log(`[SSH] Running: ${DEPLOY_CMD.replace(ROOT_PASS, "****")}\n`);

      conn.exec(DEPLOY_CMD, (err, stream) => {
        if (err) { output += `[ERROR] ${err.message}\n`; return done(err); }

        stream.on("close", (code) => {
          console.log(`\n[SSH] Stream closed with exit code: ${code}`);
          if (code === 0) done(null);
          else done(new Error(`Exit code ${code}`));
        });

        stream.on("data", (data) => {
          const str = data.toString();
          process.stdout.write(str);
          output += str;
        });

        stream.stderr.on("data", (data) => {
          const str = data.toString();
          // Filter out sudo password prompt
          if (!str.includes("[sudo] password for")) {
            process.stderr.write(str);
            output += str;
          }
        });
      });
    });

    conn.on("error", (err) => {
      output += `[SSH ERROR] ${err.message}\n`;
      done(err);
    });

    conn.connect({
      host: SSH_HOST,
      port: 22,
      username: SSH_USER,
      password: SSH_PASS,
      readyTimeout: 15000,
      hostVerifier: () => true
    });
  });
}

console.log("╔══════════════════════════════════════════════════╗");
console.log("║     AMPHUB Docker Server — Remote Deploy         ║");
console.log(`╠══════════════════════════════════════════════════╣`);
console.log(`║  Target  : ${SSH_USER}@${SSH_HOST}:22                ║`);
console.log(`║  Command : git pull + docker compose up --build  ║`);
console.log("╚══════════════════════════════════════════════════╝\n");

deployToServer()
  .then((out) => {
    console.log("\n✅ DEPLOYMENT SUCCEEDED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ DEPLOYMENT FAILED:", err.message);
    process.exit(1);
  });
