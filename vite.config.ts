// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execSync } from "child_process";

let commitCount = "201";
try {
  commitCount = execSync("git rev-list --count HEAD").toString().trim();
} catch (e) {
  console.error("Failed to get git commit count", e);
}
const version = `V2.${(parseInt(commitCount) - 200).toString().padStart(2, '0')}`;

export default defineConfig({
  tanstackStart: {
    spa: {
      enabled: true,
    },
  },
  vite: {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    }
  }
});
