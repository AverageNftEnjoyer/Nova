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

const versionServiceSource = read("hud/lib/missions/workflow/versioning/service.ts");
const versionRouteSource = read("hud/app/api/missions/versions/route.ts");
const missionRouteSource = read("hud/app/api/missions/route.ts");
const canvasModalSource = read("hud/app/missions/components/mission-canvas-modal.tsx");

await run("P4-C1 version service supports immutable snapshots + retention pruning", async () => {
  const requiredTokens = [
    "appendMissionVersionEntry",
    "MISSION_VERSIONING_RETENTION_POLICY",
    "applyRetention",
    "mission-versions.jsonl",
  ];
  for (const token of requiredTokens) {
    assert.equal(versionServiceSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P4-C2 restore path enforces mandatory pre-restore backup + validation gate", async () => {
  const requiredTokens = [
    'eventType: "pre_restore_backup"',
    "validateMission",
    "Restore validation failed",
    'eventType: "restore"',
  ];
  for (const token of requiredTokens) {
    assert.equal(versionServiceSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P4-C3 versions API route exposes list + restore", async () => {
  const requiredTokens = [
    "export async function GET",
    "export async function POST",
    "listMissionVersions",
    "restoreMissionVersion",
  ];
  for (const token of requiredTokens) {
    assert.equal(versionRouteSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P4-C4 mission save path writes version snapshots", async () => {
  const requiredTokens = [
    "appendMissionVersionEntry",
    'eventType: "snapshot"',
  ];
  for (const token of requiredTokens) {
    assert.equal(missionRouteSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P4-C5 canvas UI surfaces versions + restore controls", async () => {
  const requiredTokens = [
    "Mission Versions",
    "fetchMissionVersions",
    "restoreMissionVersion",
    "Restore reason",
    "Restore",
  ];
  for (const token of requiredTokens) {
    assert.equal(canvasModalSource.includes(token), true, `missing token: ${token}`);
  }
});

const passCount = results.filter((row) => row.status === "PASS").length;
const failCount = results.filter((row) => row.status === "FAIL").length;
const skipCount = results.filter((row) => row.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
