import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
/**
 * Runs the mission legacy-node audit ops tool (scripts/ops/mission-legacy-node-audit.mjs --strict --no-report)
 * against a TEMP data dir seeded with representative missions, so smoke:src-missions never reads the real nova.db.
 * Also proves the audit opens the database read-only (no migrations, file unchanged).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { closeDb, getDb } from "../../../src/db/index.js";
import { replaceMissionRecords } from "../../../src/runtime/modules/services/missions/persistence/sqlite-store.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const auditScript = path.join(repoRoot, "scripts", "ops", "mission-legacy-node-audit.mjs");
const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.message : String(error) });
  }
}

function runAudit(dataDir, extraArgs = [], env = {}) {
  const out = spawnSync(process.execPath, [auditScript, "--strict", "--no-report", ...extraArgs], {
    cwd: repoRoot,
    env: { ...process.env, NOVA_DATA_DIR: dataDir, NOVA_LEGACY_AUDIT_USER_CONTEXT_ID: "", ...env },
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: out.status, stdout: String(out.stdout || ""), stderr: String(out.stderr || "") };
}

const now = "2026-09-24T00:00:00.000Z";
function mission(id, label, nodeTypes) {
  return {
    id,
    label,
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: nodeTypes.map((type, index) => ({ id: `${id}-n${index}`, type, label: `${type} ${index}` })),
    connections: [],
  };
}

const CLEAN = [
  mission("m-clean-1", "Morning brief", ["schedule-trigger", "web-search", "ai-summarize", "telegram-output"]),
  mission("m-clean-2", "Subworkflow handoff", ["manual-trigger", "agent-subworkflow", "discord-output"]),
];
const LEGACY = mission("m-legacy", "Legacy chain", ["schedule-trigger", "sub-workflow", "email-output"]);

replaceMissionRecords("audit-user-a", CLEAN);
replaceMissionRecords("audit-user-b", [CLEAN[0], LEGACY]);
closeDb();
const dbFile = path.join(isolatedDataDir, "nova.db");

await run("LA-1 the audit reads the temp data dir, never the real one", async () => {
  const out = runAudit(isolatedDataDir);
  assert.ok(out.stdout.includes(`database: ${dbFile}`), out.stdout);
});

await run("LA-2 a legacy sub-workflow node fails --strict (exit 2) and is reported", async () => {
  const out = runAudit(isolatedDataDir);
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /scanned userContexts=2 missions=4 findings=1 readErrors=0/);
  assert.match(out.stdout, /finding user=audit-user-b mission=m-legacy node=m-legacy-n1 type=sub-workflow/);
});

await run("LA-3 --user-context-id scopes the audit (clean user passes)", async () => {
  const out = runAudit(isolatedDataDir, ["--user-context-id", "audit-user-a"]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /scanned userContexts=1 missions=2 findings=0/);
});

await run("LA-4 the audit is read-only: nova.db bytes are unchanged", async () => {
  const before = fs.readFileSync(dbFile);
  runAudit(isolatedDataDir);
  assert.equal(Buffer.compare(before, fs.readFileSync(dbFile)), 0);
});

await run("LA-5 --data-dir overrides NOVA_DATA_DIR; a data dir without nova.db exits 0", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "nova-legacy-audit-empty-"));
  try {
    const out = runAudit(isolatedDataDir, ["--data-dir", empty]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /No database found to scan/);
    assert.equal(fs.existsSync(path.join(empty, "nova.db")), false, "the audit must not create a database");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

await run("LA-6 remediated data passes --strict", async () => {
  replaceMissionRecords("audit-user-b", [CLEAN[0], mission("m-legacy", "Legacy chain", ["schedule-trigger", "agent-subworkflow", "email-output"])]);
  closeDb();
  const out = runAudit(isolatedDataDir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /scanned userContexts=2 missions=4 findings=0 readErrors=0/);
});

await run("LA-7 an unreadable mission row fails --strict", async () => {
  getDb()
    .prepare("INSERT INTO missions (user_id, id, data_json, label, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)")
    .run("audit-user-c", "m-broken", "{not json", "Broken", now, now);
  closeDb();
  const out = runAudit(isolatedDataDir);
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /readErrors=1/);
});

for (const { status, name, detail } of results) console.log(`[${status}] ${name}${detail ? ` :: ${detail}` : ""}`);
const failCount = results.filter((r) => r.status === "FAIL").length;
console.log(`\nSummary: pass=${results.length - failCount} fail=${failCount} skip=0`);
if (failCount > 0) process.exit(1);
