import assert from "node:assert/strict";

import { createRequestScheduler } from "../../../src/runtime/infrastructure/request-scheduler/index.js";

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

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PERF = {
  users: toInt(process.env.NOVA_SMOKE_SCHED_SOAK_USERS, 12, 2, 64),
  turnsPerUser: toInt(process.env.NOVA_SMOKE_SCHED_SOAK_TURNS_PER_USER, 16, 4, 80),
  maxInFlightGlobal: toInt(process.env.NOVA_SMOKE_SCHED_SOAK_MAX_INFLIGHT, 8, 2, 64),
  maxInFlightPerUser: toInt(process.env.NOVA_SMOKE_SCHED_SOAK_MAX_INFLIGHT_PER_USER, 2, 1, 8),
  queueP95Ms: toInt(process.env.NOVA_SMOKE_SCHED_QUEUE_P95_MS, 900, 50, 10_000),
  queueP99Ms: toInt(process.env.NOVA_SMOKE_SCHED_QUEUE_P99_MS, 1_350, 80, 20_000),
  e2eP95Ms: toInt(process.env.NOVA_SMOKE_SCHED_E2E_P95_MS, 950, 60, 20_000),
  e2eP99Ms: toInt(process.env.NOVA_SMOKE_SCHED_E2E_P99_MS, 1_450, 80, 30_000),
};

await run("SCHED-SOAK-1 concurrent soak keeps queue latency and e2e latency within p95/p99 targets", async () => {
  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightGlobal: PERF.maxInFlightGlobal,
    maxInFlightPerUser: PERF.maxInFlightPerUser,
    maxInFlightPerConversation: 1,
    maxQueueSize: PERF.users * PERF.turnsPerUser + 10,
    maxQueueSizePerUser: PERF.turnsPerUser + 4,
  });

  const queueWaitLatencies = [];
  const e2eLatencies = [];
  const startedByUser = new Map();
  const completedByUser = new Map();
  let inFlight = 0;
  let maxInFlightSeen = 0;

  const jobs = [];
  const lanes = ["fast", "default", "tool"];
  for (let userIdx = 0; userIdx < PERF.users; userIdx += 1) {
    const userId = `soak-user-${userIdx + 1}`;
    for (let turn = 0; turn < PERF.turnsPerUser; turn += 1) {
      const lane = lanes[turn % lanes.length];
      const conversationId = `${userId}-thread-${(turn % 3) + 1}`;
      const enqueuedAt = Date.now();
      const supersedeKey = `${conversationId}:turn:${turn}`;

      jobs.push(
        scheduler.enqueue({
          lane,
          userId,
          conversationId,
          supersedeKey,
          run: async () => {
            const startedAt = Date.now();
            queueWaitLatencies.push(startedAt - enqueuedAt);
            startedByUser.set(userId, Number(startedByUser.get(userId) || 0) + 1);

            inFlight += 1;
            maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
            await sleep(18 + ((turn + userIdx) % 7) * 4);
            inFlight = Math.max(0, inFlight - 1);

            const completedAt = Date.now();
            e2eLatencies.push(completedAt - enqueuedAt);
            completedByUser.set(userId, Number(completedByUser.get(userId) || 0) + 1);
            return { userId, turn, lane };
          },
        }),
      );
    }
  }

  await Promise.all(jobs);

  const queueP95 = Number(percentile(queueWaitLatencies, 95));
  const queueP99 = Number(percentile(queueWaitLatencies, 99));
  const e2eP95 = Number(percentile(e2eLatencies, 95));
  const e2eP99 = Number(percentile(e2eLatencies, 99));
  const expectedTotal = PERF.users * PERF.turnsPerUser;
  console.log(
    `SCHED-SOAK-METRICS users=${PERF.users} turns=${PERF.turnsPerUser} ` +
      `inFlightGlobal=${PERF.maxInFlightGlobal} queueP95=${queueP95}ms queueP99=${queueP99}ms ` +
      `e2eP95=${e2eP95}ms e2eP99=${e2eP99}ms`,
  );

  assert.equal(queueWaitLatencies.length, expectedTotal);
  assert.equal(e2eLatencies.length, expectedTotal);
  assert.equal(maxInFlightSeen <= PERF.maxInFlightGlobal, true);
  assert.equal(maxInFlightSeen >= Math.min(PERF.maxInFlightGlobal, 4), true);
  assert.equal(queueP95 <= PERF.queueP95Ms, true, `queue p95 ${queueP95}ms > ${PERF.queueP95Ms}ms`);
  assert.equal(queueP99 <= PERF.queueP99Ms, true, `queue p99 ${queueP99}ms > ${PERF.queueP99Ms}ms`);
  assert.equal(e2eP95 <= PERF.e2eP95Ms, true, `e2e p95 ${e2eP95}ms > ${PERF.e2eP95Ms}ms`);
  assert.equal(e2eP99 <= PERF.e2eP99Ms, true, `e2e p99 ${e2eP99}ms > ${PERF.e2eP99Ms}ms`);

  for (let userIdx = 0; userIdx < PERF.users; userIdx += 1) {
    const userId = `soak-user-${userIdx + 1}`;
    assert.equal(Number(startedByUser.get(userId) || 0), PERF.turnsPerUser);
    assert.equal(Number(completedByUser.get(userId) || 0), PERF.turnsPerUser);
  }

  const snapshot = scheduler.getSnapshot();
  assert.equal(Number(snapshot.counters.started || 0), expectedTotal);
  assert.equal(Number(snapshot.counters.completed || 0), expectedTotal);
  assert.equal(Number(snapshot.counters.queueFull || 0), 0);
});

await run("SCHED-SOAK-2 queue saturation returns bounded retryAfterMs and queue_full code", async () => {
  const scheduler = createRequestScheduler({
    strictUserIsolation: true,
    maxInFlightGlobal: 1,
    maxInFlightPerUser: 1,
    maxInFlightPerConversation: 1,
    maxQueueSize: 2,
    maxQueueSizePerUser: 2,
  });

  const blocker = scheduler.enqueue({
    lane: "default",
    userId: "sat-user",
    conversationId: "sat-thread-1",
    supersedeKey: "sat-thread-1:0",
    run: async () => {
      await sleep(110);
      return "ok";
    },
  });
  await sleep(10);

  const queuedA = scheduler.enqueue({
    lane: "default",
    userId: "sat-user",
    conversationId: "sat-thread-2",
    supersedeKey: "sat-thread-2:0",
    run: async () => "queued-a",
  });
  const queuedB = scheduler.enqueue({
    lane: "default",
    userId: "sat-user",
    conversationId: "sat-thread-3",
    supersedeKey: "sat-thread-3:0",
    run: async () => "queued-b",
  });
  const rejected = scheduler.enqueue({
    lane: "default",
    userId: "sat-user",
    conversationId: "sat-thread-4",
    supersedeKey: "sat-thread-4:0",
    run: async () => "queued-c",
  }).catch((err) => err);

  const [b, a, c, err] = await Promise.all([blocker, queuedA, queuedB, rejected]);
  assert.equal(b, "ok");
  assert.equal(a, "queued-a");
  assert.equal(c, "queued-b");
  assert.equal(String(err?.code || ""), "queue_full");
  assert.equal(Number(err?.retryAfterMs || 0) > 0, true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
