import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const childEnv = {
  ...process.env,
  NOVA_COINBASE_READINESS_MODE: "1",
};

const npmExecPath = String(process.env.npm_execpath || "").trim();
const result = npmExecPath
  ? spawnSync(process.execPath, [npmExecPath, "run", "smoke:src-coinbase-phase12"], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
    })
  : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "smoke:src-coinbase-phase12"], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
      shell: true,
    });

assert.equal(result.status, 0, "phase12 rollout smoke failed while running readiness mode");

const readinessPath = path.join(
  process.cwd(),
  "archive",
  "logs",
  "coinbase-phase12-readiness-report.json",
);
assert.equal(fs.existsSync(readinessPath), true, "missing readiness report artifact");

const report = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
assert.equal(Boolean(report?.health?.pass), true, "readiness health.pass must be true");

console.log(`[coinbase:readiness-gate] PASS health.pass=${report.health.pass} report=${readinessPath}`);
