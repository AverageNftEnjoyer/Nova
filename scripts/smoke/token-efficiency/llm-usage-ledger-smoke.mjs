/**
 * Token-efficiency Stage 0: per-call usage ledger (llm_usage) and agent-task token persistence.
 *
 * - recordLlmUsageSafe writes exactly one row with the right fields and cost, and never throws.
 * - withLlmUsageObserver sees records even when no row is written (no user).
 * - Retention pruning (NOVA_LLM_USAGE_RETENTION_DAYS) and purgeLocalUserData.
 * - The real agent-task service (startAgentTaskService) persists tokens_in / tokens_out / cached / cache-write /
 *   cost for failed and approval-paused attempts, cumulatively across attempts. The injected handleInput records
 *   usage through recordLlmUsageSafe exactly as the runtime call sites do, then throws / pauses / completes.
 *
 * Runs against a temp NOVA_DATA_DIR. No network, no API keys.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

process.env.NOVA_AGENT_TASK_POLL_MS = "10";
process.env.NOVA_AGENT_TASK_HEARTBEAT_MS = "20";
process.env.NOVA_AGENT_TASK_LEASE_MS = "2000";
process.env.NOVA_AGENT_TASK_CONTROL_MS = "25";
delete process.env.NOVA_LLM_USAGE_RETENTION_DAYS;

const { getDb, closeDb, purgeLocalUserData } = await import("../../../src/db/index.js");
const ledger = await import("../../../src/db/llm-usage.js");
const { recordLlmUsageSafe, withLlmUsageObserver, normalizeLlmUsage, addLlmUsage } = await import(
  "../../../src/providers/usage/index.js"
);
const { estimateTokenCostUsd } = await import("../../../src/providers/pricing/index.js");
const { startAgentTaskService } = await import("../../../src/runtime/modules/agent-tasks/index.js");

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

function waitFor(predicate, label, timeoutMs = 5_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      let ok = false;
      try {
        ok = predicate();
      } catch {
        ok = false;
      }
      if (ok) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 10);
  });
}

const db = getDb();
const PRICED_MODEL = "claude-sonnet-5";
const DAY_MS = 24 * 60 * 60 * 1000;

function countRows(userId) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM llm_usage WHERE user_id = ?").get(userId).n);
}

// ── Ledger ───────────────────────────────────────────────────────────────────────────────────────────────────

await run("TL-1 recordLlmUsageSafe writes exactly one row with the right fields and cost", async () => {
  const user = "ledger-user-1";
  const usage = normalizeLlmUsage("claude", {
    input_tokens: 50,
    cache_read_input_tokens: 3000,
    cache_creation_input_tokens: 1200,
    output_tokens: 420,
  });
  const id = recordLlmUsageSafe({
    userContextId: user,
    conversationId: "conv-ledger-1",
    provider: "Claude",
    model: PRICED_MODEL,
    usage,
  });
  assert.equal(typeof id, "string");
  assert.equal(countRows(user), 1);
  const [row] = ledger.listLlmUsage(user);
  assert.equal(row.id, id);
  assert.equal(row.source, "chat");
  assert.equal(row.refId, "conv-ledger-1");
  assert.equal(row.provider, "claude");
  assert.equal(row.model, PRICED_MODEL);
  assert.equal(row.inputTokens, 4250);
  assert.equal(row.outputTokens, 420);
  assert.equal(row.cachedInputTokens, 3000);
  assert.equal(row.cacheWriteInputTokens, 1200);
  const expectedCost = estimateTokenCostUsd(PRICED_MODEL, 4250, 420, { cachedInputTokens: 3000, cacheWriteInputTokens: 1200 });
  assert.ok(expectedCost > 0);
  assert.equal(row.costUsd, expectedCost);
  assert.ok(Number.isFinite(Date.parse(row.ts)));
});

await run("TL-2 agent-task and mission sources land with the right source/ref", async () => {
  const user = "ledger-user-2";
  recordLlmUsageSafe({ userContextId: user, conversationId: "agent-task-t42", provider: "openai", model: "gpt-4.1-mini", usage: { inputTokens: 10, outputTokens: 2 } });
  recordLlmUsageSafe({ userContextId: user, source: "mission", refId: "run-7", provider: "gemini", model: "gemini-2.5-pro", usage: { inputTokens: 20, outputTokens: 3 } });
  assert.equal(ledger.listLlmUsage(user, { source: "agent-task" })[0].refId, "t42");
  assert.equal(ledger.listLlmUsage(user, { source: "mission", refId: "run-7" }).length, 1);
  const sum = ledger.sumLlmUsage(user);
  assert.equal(sum.calls, 2);
  assert.equal(sum.inputTokens, 30);
  assert.equal(sum.outputTokens, 5);
});

await run("TL-3 recordLlmUsageSafe never throws: missing user -> null and no row; garbage input tolerated", async () => {
  const before = Number(db.prepare("SELECT COUNT(*) AS n FROM llm_usage").get().n);
  assert.equal(recordLlmUsageSafe({ provider: "openai", model: "gpt-4.1-mini", usage: { inputTokens: 5 } }), null);
  assert.equal(recordLlmUsageSafe({ userContextId: "   ", usage: { inputTokens: 5 } }), null);
  assert.equal(recordLlmUsageSafe(), null);
  assert.equal(recordLlmUsageSafe(null), null);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM llm_usage").get().n), before);
  // Garbage usage and unknown model: still one row, zero tokens, cost NULL (unpriced).
  const user = "ledger-user-3";
  assert.doesNotThrow(() => recordLlmUsageSafe({ userContextId: user, model: "unknown-model-zz", usage: "not-an-object" }));
  const [row] = ledger.listLlmUsage(user);
  assert.equal(row.inputTokens, 0);
  assert.equal(row.costUsd, null);
});

await run("TL-4 withLlmUsageObserver sees every record, even without a user (nested scopes stack)", async () => {
  const outer = [];
  const inner = [];
  await withLlmUsageObserver((r) => outer.push(r), async () => {
    recordLlmUsageSafe({ provider: "openai", model: "gpt-4.1-mini", usage: { inputTokens: 7, outputTokens: 1 } });
    await withLlmUsageObserver((r) => inner.push(r), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      recordLlmUsageSafe({ userContextId: "ledger-user-4", provider: "openai", model: "gpt-4.1-mini", usage: { inputTokens: 3 } });
    });
  });
  assert.equal(outer.length, 2);
  assert.equal(inner.length, 1);
  assert.equal(outer[0].userId, "");
  assert.equal(outer[0].inputTokens, 7);
  assert.equal(countRows("ledger-user-4"), 1);
  // An observer that throws never breaks the write.
  await withLlmUsageObserver(() => { throw new Error("observer boom"); }, async () => {
    assert.equal(typeof recordLlmUsageSafe({ userContextId: "ledger-user-4", usage: { inputTokens: 1 } }), "string");
  });
  assert.equal(countRows("ledger-user-4"), 2);
});

await run("TL-5 retention prune removes old rows and keeps recent ones (NOVA_LLM_USAGE_RETENTION_DAYS)", async () => {
  const user = "ledger-prune";
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const insertAt = (daysAgo) => ledger.insertLlmUsage({
    userId: user,
    ts: new Date(now - daysAgo * DAY_MS).toISOString(),
    source: "chat",
    refId: `d${daysAgo}`,
    inputTokens: 1,
  });
  for (const daysAgo of [200, 95, 20, 1]) insertAt(daysAgo);
  assert.equal(ledger.resolveLlmUsageRetentionDays(), 90, "default retention");
  ledger.pruneLlmUsage({ now });
  assert.deepEqual(ledger.listLlmUsage(user).map((r) => r.refId).sort(), ["d1", "d20"]);

  process.env.NOVA_LLM_USAGE_RETENTION_DAYS = "10";
  try {
    assert.equal(ledger.resolveLlmUsageRetentionDays(), 10);
    ledger.pruneLlmUsage({ now });
    assert.deepEqual(ledger.listLlmUsage(user).map((r) => r.refId), ["d1"]);
    process.env.NOVA_LLM_USAGE_RETENTION_DAYS = "garbage";
    assert.equal(ledger.resolveLlmUsageRetentionDays(), 90, "invalid env falls back to 90");
  } finally {
    delete process.env.NOVA_LLM_USAGE_RETENTION_DAYS;
  }
  // Explicit retentionDays wins over the env.
  insertAt(5);
  ledger.pruneLlmUsage({ retentionDays: 2, now });
  assert.deepEqual(ledger.listLlmUsage(user).map((r) => r.refId), ["d1"]);
});

await run("TL-6 purgeLocalUserData removes that user's llm_usage rows only", async () => {
  recordLlmUsageSafe({ userContextId: "purge-me", usage: { inputTokens: 4 } });
  recordLlmUsageSafe({ userContextId: "purge-me", usage: { inputTokens: 5 } });
  recordLlmUsageSafe({ userContextId: "keep-me", usage: { inputTokens: 6 } });
  const deleted = purgeLocalUserData("purge-me");
  assert.equal(deleted.llm_usage, 2);
  assert.equal(countRows("purge-me"), 0);
  assert.equal(countRows("keep-me"), 1);
});

// ── Agent tasks (real service, fake handleInput) ─────────────────────────────────────────────────────────────

const TASK_USER = "ledger-task-user";
const CALLS = {
  call1: { input_tokens: 800, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400, output_tokens: 120 },
  call2: { input_tokens: 300, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0, output_tokens: 80 },
  call3: { input_tokens: 150, cache_read_input_tokens: 3200, cache_creation_input_tokens: 100, output_tokens: 60 },
};
const norm = (name) => normalizeLlmUsage("claude", CALLS[name]);
const costOf = (...names) => Number(
  names.reduce((sum, name) => {
    const u = norm(name);
    return sum + estimateTokenCostUsd(PRICED_MODEL, u.inputTokens, u.outputTokens, {
      cachedInputTokens: u.cachedInputTokens,
      cacheWriteInputTokens: u.cacheWriteInputTokens,
    });
  }, 0).toFixed(6),
);

function insertTask(id) {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_tasks
       (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress,
        tokens_in, tokens_out, cost_usd, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'claude', ?, 'queued', 'normal', 'default', 0, 0, 0, 0, ?, ?)`,
  ).run(TASK_USER, id, id, `prompt-${id}`, PRICED_MODEL, ts, ts);
}

function taskRow(id) {
  return db.prepare("SELECT * FROM agent_tasks WHERE user_id = ? AND id = ?").get(TASK_USER, id);
}

function recordCall(opts, name) {
  recordLlmUsageSafe({
    userContextId: opts.userContextId,
    conversationId: opts.conversationId,
    provider: "claude",
    model: PRICED_MODEL,
    usage: norm(name),
  });
}

let resumeAttempts = 0;
const stop = startAgentTaskService({
  handleInput: async (prompt, opts) => {
    if (prompt === "prompt-task-fail") {
      recordCall(opts, "call1");
      recordCall(opts, "call2");
      throw new Error("model provider exploded mid-loop");
    }
    if (prompt === "prompt-task-pause-result") {
      recordCall(opts, "call1");
      return {
        ok: false,
        error: "Approval required before running elevated tool \"write\".",
        errorCode: "AGENT_TASK_APPROVAL_REQUIRED",
        pendingApproval: { toolName: "write", reason: "Approval required.", approvalKey: "write:k1" },
      };
    }
    if (prompt === "prompt-task-pause-throw") {
      resumeAttempts += 1;
      if (resumeAttempts === 1) {
        recordCall(opts, "call1");
        recordCall(opts, "call2");
        const error = new Error("Approval required for exec.");
        error.code = "AGENT_TASK_APPROVAL_REQUIRED";
        error.toolName = "exec";
        error.approvalKey = "exec:k2";
        throw error;
      }
      recordCall(opts, "call3");
      return { ok: true, reply: "done after approval", toolCalls: ["exec"] };
    }
    return { ok: true, reply: "noop" };
  },
});

try {
  await run("TL-7 failed agent task persists tokens, cached/cache-write split and cost", async () => {
    insertTask("task-fail");
    await waitFor(() => taskRow("task-fail")?.status === "failed", "failed task");
    const row = taskRow("task-fail");
    const total = addLlmUsage(norm("call1"), norm("call2"));
    assert.equal(row.tokens_in, total.inputTokens);
    assert.equal(row.tokens_out, total.outputTokens);
    assert.equal(row.cached_input_tokens, total.cachedInputTokens);
    assert.equal(row.cache_write_input_tokens, total.cacheWriteInputTokens);
    assert.ok(Math.abs(row.cost_usd - costOf("call1", "call2")) <= 2e-6, `cost ${row.cost_usd} vs ${costOf("call1", "call2")}`);
    assert.match(String(row.error || ""), /exploded/);
    // One ledger row per call, attributed to the task.
    assert.equal(ledger.listLlmUsage(TASK_USER, { source: "agent-task", refId: "task-fail" }).length, 2);
  });

  await run("TL-8 approval pause (returned result) persists tokens and cost", async () => {
    insertTask("task-pause-result");
    await waitFor(() => taskRow("task-pause-result")?.status === "paused", "paused task (result)");
    const row = taskRow("task-pause-result");
    const u = norm("call1");
    assert.equal(row.pause_reason, "approval");
    assert.equal(row.tokens_in, u.inputTokens);
    assert.equal(row.tokens_out, u.outputTokens);
    assert.equal(row.cached_input_tokens, u.cachedInputTokens);
    assert.equal(row.cache_write_input_tokens, u.cacheWriteInputTokens);
    assert.ok(Math.abs(row.cost_usd - costOf("call1")) <= 1e-6);
  });

  await run("TL-9 approval pause (thrown) persists tokens; resume adds the next attempt cumulatively", async () => {
    insertTask("task-pause-throw");
    await waitFor(() => taskRow("task-pause-throw")?.status === "paused", "paused task (thrown)");
    let row = taskRow("task-pause-throw");
    const first = addLlmUsage(norm("call1"), norm("call2"));
    assert.equal(row.pause_reason, "approval");
    assert.equal(row.tokens_in, first.inputTokens);
    assert.equal(row.cached_input_tokens, first.cachedInputTokens);
    assert.ok(Math.abs(row.cost_usd - costOf("call1", "call2")) <= 2e-6);

    // Resume (what the HUD does after approval): back to queued.
    db.prepare("UPDATE agent_tasks SET status = 'queued', paused_at = NULL, pause_reason = NULL WHERE user_id = ? AND id = ?")
      .run(TASK_USER, "task-pause-throw");
    await waitFor(() => taskRow("task-pause-throw")?.status === "completed", "resumed task completes");
    row = taskRow("task-pause-throw");
    const all = addLlmUsage(first, norm("call3"));
    assert.equal(row.tokens_in, all.inputTokens);
    assert.equal(row.tokens_out, all.outputTokens);
    assert.equal(row.cached_input_tokens, all.cachedInputTokens);
    assert.equal(row.cache_write_input_tokens, all.cacheWriteInputTokens);
    assert.ok(Math.abs(row.cost_usd - costOf("call1", "call2", "call3")) <= 3e-6);
    assert.equal(ledger.listLlmUsage(TASK_USER, { refId: "task-pause-throw" }).length, 3);
  });
} finally {
  stop();
}

for (const result of results) summarize(result);
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nllm-usage-ledger: ${results.length - failed} passed, ${failed} failed`);
closeDb();
process.exit(failed > 0 ? 1 : 0);
