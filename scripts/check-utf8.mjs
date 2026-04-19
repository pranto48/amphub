import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const decoder = new TextDecoder("utf-8", { fatal: true });

const output = execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" });
const files = output
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => /\.(ts|tsx|js|mjs|json|css|md|yml|yaml)$/.test(file));

let hasError = false;

for (const file of files) {
  try {
    const buffer = readFileSync(file);
    decoder.decode(buffer);

    if (buffer.includes(0)) {
      console.error(`NUL byte found in ${file}`);
      hasError = true;
    }
  } catch (error) {
    hasError = true;
    console.error(`Invalid UTF-8 encoding in ${file}`);
    if (error instanceof Error) {
      console.error(error.message);
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log("Staged text files are valid UTF-8.");
