import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

const diffEngineSource = read("hud/lib/missions/workflow/diff/engine.ts");
const diffJournalSource = read("hud/lib/missions/workflow/diff/journal.ts");
const missionRouteSource = read("hud/app/api/missions/route.ts");

await run("P2-C1 diff engine supports transactional mission operations", async () => {
  const requiredTokens = [
    "export function applyMissionDiff",
    'type === "addNode"',
    'type === "removeNode"',
    'type === "updateNode"',
    'type === "moveNode"',
    'type === "addConnection"',
    'type === "removeConnection"',
    "diff.version_conflict",
  ];
  for (const token of requiredTokens) {
    assert.equal(diffEngineSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P2-C2 operation journal is persisted per user context", async () => {
  const requiredTokens = [
    "mission-operation-journal.jsonl",
    "appendMissionOperationJournalEntry",
    "sanitizeUserContextId",
    ".agent",
    "user-context",
  ];
  for (const token of requiredTokens) {
    assert.equal(diffJournalSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P2-C3 mission API applies diff operations and writes journal", async () => {
  const requiredTokens = [
    "requestedOperations",
    "applyMissionDiff",
    "appendMissionOperationJournalEntry",
    "deriveDiffOperationsFromMissionSnapshot",
    "Mission diff apply failed.",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionRouteSource.includes(token), true, `missing token: ${token}`);
  }
});

const passCount = results.filter((row) => row.status === "PASS").length;
const failCount = results.filter((row) => row.status === "FAIL").length;
const skipCount = results.filter((row) => row.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
