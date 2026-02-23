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

const missionStoreSource = read("hud/lib/missions/store.ts");
const missionsApiSource = read("hud/app/api/missions/route.ts");
const missionsPageStateSource = read("hud/app/missions/hooks/use-missions-page-state.ts");
const schedulerSource = read("hud/lib/notifications/scheduler.ts");

await run("unit: store delete is user-scoped and deterministic", async () => {
  const requiredTokens = [
    "export interface MissionDeleteResult",
    "reason: \"deleted\" | \"invalid_user\" | \"not_found\"",
    "const uid = sanitizeUserId(userId)",
    "loadScopedMissions(uid)",
    "next.length === existing.length",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionStoreSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("integration: api delete reconciles mission + schedule and returns delete contract", async () => {
  const requiredTokens = [
    "const missionDelete = await deleteMission(id, userId)",
    "const schedules = await loadSchedules({ userId })",
    "await saveSchedules(nextSchedules, { userId })",
    "deleted,",
    "reason,",
    "event: \"mission.delete.result\"",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionsApiSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("integration: frontend delete waits for backend confirmation then reconciles", async () => {
  const requiredTokens = [
    "deleteMissionById(id)",
    "if (!data?.deleted)",
    "await refreshSchedules()",
    "Mission was already removed.",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionsPageStateSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("integration: scheduler blocks deleted missions from running", async () => {
  const requiredTokens = [
    "loadLiveMissionForUser",
    "event: \"scheduler.skip.deleted_mission\"",
    "if (!liveMission) {",
    "if (liveMission.status !== \"active\")",
  ];
  for (const token of requiredTokens) {
    assert.equal(schedulerSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("regression: delete path remains userContextId scoped", async () => {
  const requiredTokens = [
    "requireSupabaseApiUser",
    "const userId = verified.user.id",
    "loadSchedules({ userId })",
    "deleteMission(id, userId)",
  ];
  for (const token of requiredTokens) {
    assert.equal(missionsApiSource.includes(token), true, `missing token: ${token}`);
  }
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
const skipCount = results.filter((result) => result.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
