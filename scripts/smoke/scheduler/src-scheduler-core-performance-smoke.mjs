import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { runMissionScheduleTick } = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/services/missions/scheduler-core/index.js")).href,
);

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

function makeMission(id, userId, status = "active") {
  return {
    id,
    userId,
    status,
    nodes: [
      {
        id: `trigger-${id}`,
        type: "schedule-trigger",
        triggerMode: "daily",
        triggerTimezone: "UTC",
      },
    ],
    settings: {
      retryOnFail: true,
      retryCount: 2,
      timezone: "UTC",
    },
    lastSentLocalDate: "",
    lastRunStatus: "",
    lastRunAt: "",
    failureCount: 0,
    successCount: 0,
  };
}

await run("P1-SCHED-1 scheduler-core reloads each active user's missions once per tick", async () => {
  const allMissions = [
    makeMission("a-1", "user-a"),
    makeMission("a-2", "user-a"),
    makeMission("a-3", "user-a"),
    makeMission("b-1", "user-b"),
    makeMission("b-2", "user-b"),
    makeMission("c-paused", "user-c", "paused"),
  ];
  const loadCounts = new Map();
  const enqueued = [];

  const result = await runMissionScheduleTick({
    loadMissions: async (options = {}) => {
      const key = options.allUsers ? "__allUsers__" : String(options.userId || "");
      loadCounts.set(key, Number(loadCounts.get(key) || 0) + 1);
      if (options.allUsers) return allMissions;
      return allMissions.filter((mission) => mission.userId === options.userId);
    },
    getRescheduleOverride: async () => null,
    getLocalParts: () => ({ dayStamp: "2026-03-07" }),
    resolveTimezone: () => "UTC",
    jobLedger: {
      reclaimExpiredLeases: async () => 0,
      enqueue: async (input) => {
        enqueued.push(input);
        return { ok: true, jobRun: input };
      },
    },
    warn: () => {},
    error: () => {},
  });

  assert.equal(loadCounts.get("__allUsers__"), 1);
  assert.equal(loadCounts.get("user-a"), 1);
  assert.equal(loadCounts.get("user-b"), 1);
  assert.equal(loadCounts.has("user-c"), false, "paused-only users should not reload");
  assert.equal(result.dueCount, 5);
  assert.equal(result.runCount, 5);
  assert.deepEqual(
    enqueued.map((entry) => entry.mission_id).sort(),
    ["a-1", "a-2", "a-3", "b-1", "b-2"],
  );
});

await run("P1-SCHED-2 scheduler-core preserves per-user enqueue caps while round-robining users", async () => {
  const allMissions = [
    makeMission("a-1", "user-a"),
    makeMission("a-2", "user-a"),
    makeMission("a-3", "user-a"),
    makeMission("a-4", "user-a"),
    makeMission("a-5", "user-a"),
    makeMission("a-6", "user-a"),
    makeMission("b-1", "user-b"),
    makeMission("b-2", "user-b"),
    makeMission("b-3", "user-b"),
  ];
  const enqueued = [];

  const result = await runMissionScheduleTick({
    loadMissions: async (options = {}) => {
      if (options.allUsers) return allMissions;
      return allMissions.filter((mission) => mission.userId === options.userId);
    },
    getRescheduleOverride: async () => null,
    getLocalParts: () => ({ dayStamp: "2026-03-07" }),
    resolveTimezone: () => "UTC",
    jobLedger: {
      reclaimExpiredLeases: async () => 0,
      enqueue: async (input) => {
        enqueued.push(input);
        return { ok: true, jobRun: input };
      },
    },
    warn: () => {},
    error: () => {},
  });

  const byUser = enqueued.reduce((acc, entry) => {
    const key = String(entry.user_id || "");
    acc.set(key, Number(acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  assert.equal(result.dueCount, 9);
  assert.equal(result.runCount, 7);
  assert.equal(byUser.get("user-a"), 4, "user-a should be capped at 4 runs per tick");
  assert.equal(byUser.get("user-b"), 3);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
