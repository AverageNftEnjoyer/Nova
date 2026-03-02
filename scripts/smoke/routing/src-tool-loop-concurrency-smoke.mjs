import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { createToolLoopBudget, capToolCallsPerStep } from "../../../src/runtime/modules/chat/core/tool-loop-guardrails/index.js";

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

function createSeededRng(seed) {
  let state = Math.max(1, Number(seed) || 1) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulateToolLoopTurn({ userContextId, turnId, rng }) {
  const startedAt = performance.now();
  const budget = createToolLoopBudget({ maxDurationMs: 1500, minTimeoutMs: 10 });
  const metrics = {
    userContextId,
    turnId,
    steps: 0,
    cappedCalls: 0,
    budgetExhausted: false,
    timedOutTools: 0,
  };

  for (let step = 0; step < 12; step += 1) {
    metrics.steps += 1;
    if (budget.isExhausted()) {
      metrics.budgetExhausted = true;
      break;
    }

    const requestedToolCalls = Math.max(0, Math.floor(rng() * 10));
    const plannedCalls = Array.from({ length: requestedToolCalls }, (_, i) => ({ id: `${turnId}-call-${step}-${i}` }));
    const capped = capToolCallsPerStep(plannedCalls, 4);
    metrics.cappedCalls += capped.requestedCount - capped.cappedCount;

    for (const call of capped.capped) {
      const timeoutMs = budget.resolveTimeoutMs(120, 10);
      if (timeoutMs <= 0) {
        metrics.budgetExhausted = true;
        break;
      }

      const simulatedWorkMs = 10 + Math.floor(rng() * 180);
      let timedOut = false;
      await Promise.race([
        delay(simulatedWorkMs),
        delay(timeoutMs).then(() => {
          timedOut = true;
        }),
      ]);
      if (timedOut) {
        metrics.timedOutTools += 1;
      }
      if (budget.isExhausted()) {
        metrics.budgetExhausted = true;
        break;
      }
      assert.ok(String(call.id).includes(turnId));
    }
    if (metrics.budgetExhausted) break;
  }

  const elapsedMs = performance.now() - startedAt;
  return { ...metrics, elapsedMs };
}

await run("Concurrent tool-loop simulation respects per-turn time budgets", async () => {
  const userContextIds = ["u-alpha", "u-beta", "u-gamma", "u-delta", "u-epsilon"];
  const perUserTurns = 15;
  const jobs = [];
  let seed = 1337;
  for (const userContextId of userContextIds) {
    for (let i = 0; i < perUserTurns; i += 1) {
      const rng = createSeededRng(seed);
      seed += 97;
      jobs.push(simulateToolLoopTurn({ userContextId, turnId: `${userContextId}-turn-${i}`, rng }));
    }
  }

  const startedAt = performance.now();
  const outcomes = await Promise.all(jobs);
  const totalElapsedMs = performance.now() - startedAt;

  assert.equal(outcomes.length, userContextIds.length * perUserTurns);
  for (const outcome of outcomes) {
    assert.ok(outcome.elapsedMs <= 1700, `turn exceeded hard budget envelope: ${outcome.turnId} ${outcome.elapsedMs}ms`);
  }
  assert.ok(totalElapsedMs <= 45000, `concurrency run exceeded expected envelope: ${totalElapsedMs}ms`);
});

await run("Isolation: per-user aggregation remains partitioned", async () => {
  const users = ["u-1", "u-2", "u-3"];
  const turns = [];
  let seed = 999;
  for (const userContextId of users) {
    for (let i = 0; i < 8; i += 1) {
      turns.push(simulateToolLoopTurn({ userContextId, turnId: `${userContextId}-t-${i}`, rng: createSeededRng(seed += 11) }));
    }
  }
  const outcomes = await Promise.all(turns);

  const byUser = new Map();
  for (const outcome of outcomes) {
    const key = outcome.userContextId;
    if (!byUser.has(key)) byUser.set(key, { turns: 0, timedOutTools: 0, cappedCalls: 0 });
    const agg = byUser.get(key);
    agg.turns += 1;
    agg.timedOutTools += outcome.timedOutTools;
    agg.cappedCalls += outcome.cappedCalls;
  }

  assert.equal(byUser.size, users.length);
  for (const user of users) {
    const agg = byUser.get(user);
    assert.ok(agg);
    assert.equal(agg.turns, 8);
  }
});

const pass = results.filter((row) => row.status === "PASS").length;
const fail = results.filter((row) => row.status === "FAIL").length;
for (const row of results) {
  const detail = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${detail}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
