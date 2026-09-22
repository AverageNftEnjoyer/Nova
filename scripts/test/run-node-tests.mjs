// `npm run test:node` entry. Runs node:test on an isolated temp NOVA_DATA_DIR.
// With no arguments it runs the unit suites explicitly (src/**/*.test.*, compiled dist/**/*.test.js) instead of
// node's default discovery, which also grabs manual scripts that merely start with "test-" (e.g. scripts/test-*.mjs).
// With arguments (`npm run test:node -- <files>`) it runs exactly those files.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ["src/**/*.test.ts", "src/**/*.test.mjs", "src/**/*.test.js", "dist/**/*.test.js"];
const result = spawnSync(
  process.execPath,
  ["--import", "./scripts/smoke/lib/isolated-data-dir.mjs", "--test", "--test-isolation=none", ...targets],
  { cwd: repoRoot, stdio: "inherit" },
);
process.exit(result.status ?? 1);
