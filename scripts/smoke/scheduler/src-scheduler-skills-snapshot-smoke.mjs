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

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const snapshotSource = read("hud/lib/missions/skills/snapshot.ts");
const schedulerSource = read("hud/lib/notifications/scheduler.ts");
const triggerRouteSource = read("hud/app/api/notifications/trigger/route.ts");
const triggerStreamRouteSource = read("hud/app/api/notifications/trigger/stream/route.ts");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");
const missionTypesSource = read("hud/lib/missions/types.ts");
const coinbaseSkillSource = read("skills/coinbase/SKILL.md");

await run("P20-C1 mission skill snapshot module exists and fingerprints skills", async () => {
  assert.equal(snapshotSource.includes("export interface MissionSkillSnapshot"), true);
  assert.equal(snapshotSource.includes("export async function loadMissionSkillSnapshot"), true);
  assert.equal(snapshotSource.includes("createHash(\"sha256\")"), true);
});

await run("P20-C2 scheduler loads per-user snapshot and injects into execution", async () => {
  assert.equal(schedulerSource.includes("loadMissionSkillSnapshot"), true);
  assert.equal(schedulerSource.includes("skillSnapshotsByUser"), true);
  assert.equal(schedulerSource.includes("skillSnapshot,"), true);
});

await run("P20-C3 manual trigger routes also use skill snapshots", async () => {
  assert.equal(triggerRouteSource.includes("loadMissionSkillSnapshot"), true);
  assert.equal(triggerRouteSource.includes("skillSnapshot,"), true);
  assert.equal(triggerStreamRouteSource.includes("loadMissionSkillSnapshot"), true);
  assert.equal(triggerStreamRouteSource.includes("skillSnapshot,"), true);
});

await run("P20-C4 workflow execution contract carries skill snapshot through mission runtime context", async () => {
  assert.equal(missionTypesSource.includes("skillSnapshot?: {"), true);
  assert.equal(executeMissionSource.includes("skillSnapshot: input.skillSnapshot"), true);
  assert.equal(executeMissionSource.includes("scope: input.scope"), true);
});

await run("P20-C5 Coinbase skill doc exists with deterministic aliases and admin controls", async () => {
  assert.equal(coinbaseSkillSource.includes("price btc"), true);
  assert.equal(coinbaseSkillSource.includes("my crypto report"), true);
  assert.equal(coinbaseSkillSource.includes("weekly pnl"), true);
  assert.equal(coinbaseSkillSource.includes("NOVA_COINBASE_COMMAND_CATEGORIES"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
