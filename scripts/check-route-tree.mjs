import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const routeTreePath = "src/routeTree.gen.ts";

if (!existsSync(routeTreePath)) {
  console.error(`Missing generated route tree: ${routeTreePath}`);
  process.exit(1);
}

const before = readFileSync(routeTreePath, "utf8");

const buildResult = spawnSync("npm", ["run", "build:dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CI: "1",
  },
});

if (buildResult.status !== 0) {
  console.error("Route generation failed while running build:dev.");
  process.exit(buildResult.status ?? 1);
}

const after = readFileSync(routeTreePath, "utf8");

if (before !== after) {
  console.error("src/routeTree.gen.ts is stale. Run `npm run routes:generate` and commit the changes.");
  process.exit(1);
}

console.log("Route tree is up to date.");
