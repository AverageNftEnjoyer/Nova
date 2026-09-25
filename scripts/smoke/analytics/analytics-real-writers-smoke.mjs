/**
 * Usage analytics against ledger rows written by the REAL writers (token-efficiency close-out issue 28), plus the
 * time-zone day bucketing proof (issue 25) and the budget event history (issues 19 / 24).
 *
 *   AN-1  Chat turns through the real runtime handleInput (fake OpenAI-compatible client, no network) land in the
 *         ledger as source "chat" and in today's analytics totals.
 *   AN-2  recordLlmUsageSafe rows for every source (chat, agent-task, mission, utility, embedding), several providers,
 *         cached / cache-write tokens and an unpriced model: totals, by-source (all five present, 0 where none),
 *         by-provider, by-model (priced flag), savings and the daily series match an independent row-level sum;
 *         by-tier (Stage 6 routing tier: trivial / standard / hard, NULL → untagged, all four present) likewise.
 *   AN-3  Time-zone bucketing: calls just after local midnight land on the new local day in Asia/Kolkata (+05:30),
 *         Asia/Kathmandu (+05:45), America/St_Johns (-02:30 DST and -03:30 standard, plus the DST-end day) and
 *         Europe/Berlin (whole hour); 400 seeded random calls per zone match a per-row Intl day computation;
 *         the range starts at the zone's local midnight.
 *   AN-4  The ledger read is one query that uses the (user_id, ts) index.
 *   AN-5  Budget event history: events of every kind written through the real db module for tasks created with the
 *         real HUD task store; range-limited, newest first, current user only, task names joined, deleted task
 *         (hard- or soft-deleted, or never existed) → null name, fraction, bounded with a truncation flag.
 *
 * The analytics module (hud/lib/analytics/usage-aggregation.ts + time-zone.ts + types.ts) is transpiled with
 * `typescript` and loaded in plain Node, sharing the same src/db instance (technique of scripts/smoke/lib/hud-task-store.mjs).
 * The server-only wrapper (usage-analytics.ts) only adds the agent-task parts on top of it.
 *
 * Usage: node scripts/smoke/analytics/analytics-real-writers-smoke.mjs   (needs `npm run build:agent-core` for the
 * runtime's dist tool modules; `npm run smoke:analytics` does that first)
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

process.env.NOVA_EMBEDDING_PROVIDER = "local";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { loadHudTaskStore, repoRoot } from "../lib/hud-task-store.mjs";
import { createCapture, createFakeOpenAiClient, installNetworkGuard, FAKE_OPENAI_BASE_URL } from "../token-efficiency/token-harness-lib.mjs";

const toPosix = (value) => value.replace(/\\/g, "/");
const srcUrl = (relative) => pathToFileURL(path.join(repoRoot, relative)).href;

// ── Load the analytics module (TypeScript → CommonJS, src imports pinned to the shared ESM instances) ─────────

const ANALYTICS_SOURCES = ["hud/lib/analytics/types.ts", "hud/lib/analytics/time-zone.ts", "hud/lib/analytics/usage-aggregation.ts"];
const ANALYTICS_SRC_REWRITES = {
  "../../../src/db/index.js": "src/db/index.js",
  "../../../src/db/agent-task-budget-events.js": "src/db/agent-task-budget-events.js",
  "../../../src/db/llm-usage.js": "src/db/llm-usage.js",
  "../../../src/providers/pricing/index.js": "src/providers/pricing/index.js",
};

function loadAnalytics(outDir) {
  for (const relativePath of ANALYTICS_SOURCES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.ok(!source.includes('"server-only"'), `${relativePath} must stay importable outside Next (no server-only)`);
    let output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    for (const [specifier, target] of Object.entries(ANALYTICS_SRC_REWRITES)) {
      output = output.split(`"${specifier}"`).join(JSON.stringify(toPosix(path.join(repoRoot, target))));
    }
    assert.ok(!/require\("@\//.test(output), `${relativePath} must not import "@/..." at runtime`);
    const target = path.join(outDir, relativePath.replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  }
  const require = createRequire(path.join(outDir, "loader.cjs"));
  return {
    aggregation: require("./hud/lib/analytics/usage-aggregation.js"),
    timeZone: require("./hud/lib/analytics/time-zone.js"),
    types: require("./hud/lib/analytics/types.js"),
  };
}

// ── Network guard + real runtime (after the guard so nothing escapes at import time) ─────────────────────────

const capture = createCapture();
const fakeOpenAiClient = createFakeOpenAiClient({
  capture,
  responder: async () => ({ text: "Sure, here is a short answer." }),
  usageFor: () => ({ inputTokens: 1200, outputTokens: 80 }),
});
const guard = installNetworkGuard({});

const { handleInput } = await import(srcUrl("src/runtime/modules/chat/core/chat-handler/index.js"));
const { recordLlmUsageSafe } = await import(srcUrl("src/providers/usage/index.js"));
const { estimateTokenCostUsd, resolveModelPricing } = await import(srcUrl("src/providers/pricing/index.js"));
const { getDb } = await import(srcUrl("src/db/index.js"));
const budgetEvents = await import(srcUrl("src/db/agent-task-budget-events.js"));

const outDir = path.join(isolatedDataDir, "analytics-smoke-out");
const { aggregation, timeZone, types } = loadAnalytics(outDir);
const { store } = loadHudTaskStore(path.join(isolatedDataDir, "hud-task-store-out"));

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

let failures = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error?.stack || error}`);
  }
}

const near = (actual, expected, label, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: expected ${expected}, got ${actual}`);

/** Deterministic PRNG (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Local day of an exact instant, computed per row (independent of the 15-minute buckets). */
function rowDay(iso, zone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function record(userId, row) {
  const id = recordLlmUsageSafe({ userContextId: userId, ...row });
  assert.equal(typeof id, "string", `recordLlmUsageSafe wrote a row for ${JSON.stringify(row).slice(0, 80)}`);
}

function analyticsFor(userId, days, zone, nowIso) {
  return aggregation.buildUsageAnalytics(userId, days, zone, new Date(nowIso));
}

// ── AN-1 ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("AN-1 chat turns through the real handleInput appear in the ledger and today's analytics", async () => {
  const userContextId = "an-chat-user";
  const conversationId = "an-chat-thread";
  const selection = {
    activeChatRuntime: {
      provider: "openai",
      connected: true,
      apiKey: "fake-openai-key",
      baseURL: FAKE_OPENAI_BASE_URL,
      model: "gpt-5.6-terra",
      routeReason: "analytics-smoke",
      rankedCandidates: ["openai"],
    },
    activeOpenAiCompatibleClient: fakeOpenAiClient,
    selectedChatModel: "gpt-5.6-terra",
  };
  const turns = ["Hi Nova, how are you today?", "Give me one tip for writing clear commit messages."];
  for (const text of turns) {
    await handleInput(text, {
      source: "hud",
      sender: "hud-user",
      voice: false,
      userContextId,
      conversationId,
      sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
      runtimeSelectionOverride: selection,
    });
  }
  const ledger = getDb().prepare("SELECT source, provider, model, input_tokens, output_tokens, cost_usd FROM llm_usage WHERE user_id = ?").all(userContextId);
  assert.ok(ledger.length >= turns.length, `expected at least ${turns.length} ledger rows, got ${ledger.length}`);
  assert.ok(capture.calls.length >= turns.length, "the fake client received the calls");
  const zone = timeZone.systemTimeZone();
  const today = analyticsFor(userContextId, 1, zone, new Date(Date.now() + 1000).toISOString());
  assert.equal(today.totals.calls, ledger.length, "every ledger row is counted today");
  const chat = today.bySource.find((row) => row.source === "chat");
  assert.equal(chat.calls, ledger.filter((row) => row.source === "chat").length);
  assert.ok(chat.calls >= turns.length, "chat turns are source chat");
  near(today.totals.costUsd, ledger.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0), "chat cost", 1e-7);
  assert.equal(today.totals.inputTokens, ledger.reduce((sum, row) => sum + row.input_tokens, 0));
  assert.equal(today.daily.length, 1);
  assert.equal(today.daily[0].calls, ledger.length);
});

// ── AN-2 ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("AN-2 every source, providers, caching, unpriced model: totals, by-source, by-model, savings, daily", async () => {
  const user = "an-sources-user";
  const nowIso = "2026-09-21T12:00:00.000Z";
  const zone = "UTC";
  const rows = [
    { source: "chat", refId: "thread-1", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 300 }, ts: "2026-09-21T09:00:00.000Z", tier: "standard" },
    { source: "chat", refId: "thread-1", provider: "claude", model: "claude-sonnet-5", usage: { inputTokens: 12_000, cachedInputTokens: 6_000, cacheWriteInputTokens: 4_000, outputTokens: 400 }, ts: "2026-09-20T10:00:00.000Z", tier: "hard" },
    { source: "agent-task", refId: "task-1", provider: "gemini", model: "gemini-3.8-flash", usage: { inputTokens: 20_000, cachedInputTokens: 15_000, outputTokens: 900 }, ts: "2026-09-20T11:00:00.000Z" },
    { source: "mission", refId: "run-1", provider: "grok", model: "grok-4.3", usage: { inputTokens: 5_000, outputTokens: 250 }, ts: "2026-09-19T08:00:00.000Z", tier: "trivial" },
    { source: "utility", refId: "nova-suggest", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 3_000, outputTokens: 120 }, ts: "2026-09-21T10:00:00.000Z", tier: "trivial" },
    { source: "utility", refId: "test-model", provider: "openai", model: "mystery-model-x", usage: { inputTokens: 700, cachedInputTokens: 500, outputTokens: 10 }, ts: "2026-09-21T10:05:00.000Z" },
    { source: "embedding", refId: "memory-index", provider: "openai", model: "text-embedding-3-small", usage: { inputTokens: 40_000 }, ts: "2026-09-21T11:00:00.000Z" },
    // Out of range (before the 3-day window) and another user: both excluded.
    { source: "chat", refId: "old", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 99_999 }, ts: "2026-09-18T23:59:59.000Z" },
  ];
  for (const row of rows) record(user, row);
  record("an-other-user", { source: "chat", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 55_555 }, ts: "2026-09-21T09:00:00.000Z" });

  const inRange = rows.slice(0, 7);
  const result = analyticsFor(user, 3, zone, nowIso);
  assert.equal(result.range.sinceTs, "2026-09-19T00:00:00.000Z");
  assert.equal(result.range.timeZone, "UTC");
  assert.equal(result.totals.calls, inRange.length);
  const sum = (pick) => inRange.reduce((total, row) => total + pick(row), 0);
  assert.equal(result.totals.inputTokens, sum((row) => row.usage.inputTokens));
  assert.equal(result.totals.outputTokens, sum((row) => row.usage.outputTokens ?? 0));
  assert.equal(result.totals.cachedInputTokens, sum((row) => row.usage.cachedInputTokens ?? 0));
  assert.equal(result.totals.cacheWriteInputTokens, sum((row) => row.usage.cacheWriteInputTokens ?? 0));
  assert.equal(result.totals.unpricedCalls, 1, "mystery-model-x is unpriced");
  const costOf = (row, split) =>
    estimateTokenCostUsd(row.model, row.usage.inputTokens, row.usage.outputTokens ?? 0, split
      ? { cachedInputTokens: row.usage.cachedInputTokens ?? 0, cacheWriteInputTokens: row.usage.cacheWriteInputTokens ?? 0 }
      : undefined) ?? 0;
  const priced = inRange.filter((row) => resolveModelPricing(row.model) !== null);
  const expectedCost = priced.reduce((total, row) => total + costOf(row, true), 0);
  const expectedUncached = priced.reduce((total, row) => total + costOf(row, false), 0);
  near(result.totals.costUsd, expectedCost, "total cost");
  near(result.savings.costAtUncachedRatesUsd, expectedUncached, "cost at uncached rates");
  near(result.savings.savingsUsd, expectedUncached - expectedCost, "savings");
  near(result.totals.savingsUsd, expectedUncached - expectedCost, "totals.savingsUsd");
  assert.ok(result.savings.savingsUsd > 0, "caching saved money overall");
  assert.equal(result.savings.unpricedCachedInputTokens, 500);

  assert.deepEqual(result.bySource.map((row) => row.source), ["chat", "agent-task", "mission", "utility", "embedding"]);
  assert.deepEqual([...types.USAGE_SOURCES], ["chat", "agent-task", "mission", "utility", "embedding"]);
  for (const source of types.USAGE_SOURCES) {
    const expectedRows = inRange.filter((row) => row.source === source);
    const got = result.bySource.find((row) => row.source === source);
    assert.equal(got.calls, expectedRows.length, `${source} calls`);
    near(got.costUsd, expectedRows.filter((row) => resolveModelPricing(row.model)).reduce((t, row) => t + costOf(row, true), 0), `${source} cost`);
  }
  assert.equal(result.bySource.find((row) => row.source === "embedding").inputTokens, 40_000);
  assert.equal(result.bySource.find((row) => row.source === "utility").unpricedCalls, 1);

  // By routing tier: every tier present in USAGE_TIERS order; rows without a tier are "untagged".
  assert.deepEqual(result.byTier.map((row) => row.tier), ["trivial", "standard", "hard", "untagged"]);
  assert.deepEqual([...types.USAGE_TIERS], ["trivial", "standard", "hard", "untagged"]);
  for (const tier of types.USAGE_TIERS) {
    const expectedRows = inRange.filter((row) => (row.tier ?? "untagged") === tier);
    const got = result.byTier.find((row) => row.tier === tier);
    assert.equal(got.calls, expectedRows.length, `${tier} calls`);
    assert.equal(got.inputTokens + got.outputTokens, expectedRows.reduce((t, row) => t + row.usage.inputTokens + (row.usage.outputTokens ?? 0), 0), `${tier} tokens`);
    near(got.costUsd, expectedRows.filter((row) => resolveModelPricing(row.model)).reduce((t, row) => t + costOf(row, true), 0), `${tier} cost`);
  }
  near(result.byTier.reduce((t, row) => t + row.costUsd, 0), expectedCost, "tier cost adds up");

  const providers = Object.fromEntries(result.byProvider.map((row) => [row.provider, row.calls]));
  assert.deepEqual(providers, { openai: 4, claude: 1, gemini: 1, grok: 1 });
  const mystery = result.byModel.find((row) => row.model === "mystery-model-x");
  assert.equal(mystery.priced, false);
  assert.equal(mystery.costUsd, 0);
  assert.equal(result.byModel.find((row) => row.model === "text-embedding-3-small").priced, true);

  assert.deepEqual(result.daily.map((day) => day.date), ["2026-09-19", "2026-09-20", "2026-09-21"]);
  assert.deepEqual(result.daily.map((day) => day.calls), [1, 2, 4]);
  for (const day of result.daily) {
    assert.deepEqual(Object.keys(day.bySource), ["chat", "agent-task", "mission", "utility", "embedding"], "every source in every day");
  }
  assert.equal(result.daily[2].bySource.embedding.tokens, 40_000);
  assert.equal(result.daily[2].bySource["agent-task"].tokens, 0, "a source without calls that day is 0");
  near(result.daily.reduce((t, day) => t + day.costUsd, 0), expectedCost, "daily cost adds up");

  // Empty user: every source present with 0.
  const empty = analyticsFor("an-nobody", 7, zone, nowIso);
  assert.equal(empty.totals.calls, 0);
  assert.equal(empty.bySource.length, 5);
  assert.ok(empty.bySource.every((row) => row.calls === 0 && row.costUsd === 0));
  assert.equal(empty.byTier.length, 4);
  assert.ok(empty.byTier.every((row) => row.calls === 0 && row.costUsd === 0));
  assert.equal(empty.daily.length, 7);
});

// ── AN-3 ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Boundary cases: `before` is local 23:50 of day D-1, `after` local 00:10 of day D, both in the SAME UTC hour for
 * the half-hour / 45-minute zones (the old UTC-hour bucketing put both on D-1).
 */
const ZONE_CASES = [
  { zone: "Asia/Kolkata", day: "2026-09-20", before: "2026-09-19T18:20:00.000Z", after: "2026-09-19T18:40:00.000Z", sinceDays1: "2026-09-20T18:30:00.000Z", now: "2026-09-21T12:00:00.000Z" },
  { zone: "Asia/Kathmandu", day: "2026-09-20", before: "2026-09-19T18:10:00.000Z", after: "2026-09-19T18:20:00.000Z", sinceDays1: "2026-09-20T18:15:00.000Z", now: "2026-09-21T12:00:00.000Z" },
  { zone: "America/St_Johns", day: "2026-09-20", before: "2026-09-20T02:20:00.000Z", after: "2026-09-20T02:40:00.000Z", sinceDays1: "2026-09-21T02:30:00.000Z", now: "2026-09-21T12:00:00.000Z" },
  { zone: "America/St_Johns", day: "2026-12-10", before: "2026-12-10T03:20:00.000Z", after: "2026-12-10T03:40:00.000Z", sinceDays1: "2026-12-11T03:30:00.000Z", now: "2026-12-11T12:00:00.000Z" },
  { zone: "Europe/Berlin", day: "2026-09-20", before: "2026-09-19T21:50:00.000Z", after: "2026-09-19T22:10:00.000Z", sinceDays1: "2026-09-20T22:00:00.000Z", now: "2026-09-21T12:00:00.000Z" },
];

await run("AN-3a local-midnight boundary per zone (half-hour, 45-minute, DST / standard, whole hour)", async () => {
  ZONE_CASES.forEach((c, index) => {
    const user = `an-tz-${index}`;
    assert.equal(rowDay(c.before, c.zone), aggregation.resolveUsageRange(1, c.zone, new Date(c.before)).dayKeys[0], "sanity");
    record(user, { source: "chat", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 100, outputTokens: 1 }, ts: c.before });
    record(user, { source: "utility", provider: "openai", model: "gpt-5.6-terra", usage: { inputTokens: 200, outputTokens: 2 }, ts: c.after });
    const result = analyticsFor(user, 7, c.zone, c.now);
    const byDate = Object.fromEntries(result.daily.map((day) => [day.date, day]));
    const previous = timeZone.addDaysToKey(c.day, -1);
    assert.equal(byDate[previous]?.calls, 1, `${c.zone}: 23:50 stays on ${previous}`);
    assert.equal(byDate[previous]?.inputTokens, 100, `${c.zone}: ${previous} holds the 23:50 call`);
    assert.equal(byDate[c.day]?.calls, 1, `${c.zone}: 00:10 lands on ${c.day}`);
    assert.equal(byDate[c.day]?.bySource.utility.tokens, 202, `${c.zone}: ${c.day} holds the 00:10 call`);
    const oneDay = aggregation.resolveUsageRange(1, c.zone, new Date(c.now));
    assert.equal(oneDay.since.toISOString(), c.sinceDays1, `${c.zone}: today starts at local midnight`);
  });
});

await run("AN-3b 400 seeded calls per zone match a per-row local-day computation (incl. the St John's DST end)", async () => {
  const zones = ["Asia/Kolkata", "Asia/Kathmandu", "America/St_Johns", "Europe/Berlin", "Australia/Lord_Howe", "UTC"];
  // St John's leaves DST on Sun 2026-11-01 (25-hour local day); Lord Howe has a 30-minute DST shift (Oct 4).
  const windows = [
    { start: Date.parse("2026-09-17T00:00:00.000Z"), now: "2026-09-21T12:00:00.000Z" },
    { start: Date.parse("2026-10-29T00:00:00.000Z"), now: "2026-11-03T06:00:00.000Z" },
    { start: Date.parse("2026-10-01T00:00:00.000Z"), now: "2026-10-06T06:00:00.000Z" },
  ];
  const random = prng(2509);
  let userNo = 0;
  for (const zone of zones) {
    for (const window of windows) {
      const user = `an-tz-rand-${userNo++}`;
      const expected = new Map();
      const range = aggregation.resolveUsageRange(4, zone, new Date(window.now));
      for (let i = 0; i < 400; i++) {
        const ms = window.start + Math.floor(random() * (Date.parse(window.now) - window.start));
        const iso = new Date(ms).toISOString();
        const tokens = 1 + Math.floor(random() * 50);
        record(user, { source: "mission", provider: "gemini", model: "gemini-3.8-flash", usage: { inputTokens: tokens }, ts: iso });
        if (ms >= range.since.getTime()) {
          const day = rowDay(iso, zone);
          expected.set(day, (expected.get(day) ?? 0) + tokens);
        }
      }
      const result = analyticsFor(user, 4, zone, window.now);
      assert.deepEqual(result.daily.map((day) => day.date), range.dayKeys);
      for (const day of result.daily) {
        assert.equal(day.inputTokens, expected.get(day.date) ?? 0, `${zone} ${day.date}`);
      }
      assert.equal(result.totals.inputTokens, [...expected.values()].reduce((a, b) => a + b, 0), `${zone} range total`);
      // The range really starts at the local day boundary: one minute earlier is the previous local day.
      assert.equal(rowDay(range.since.toISOString(), zone), range.dayKeys[0]);
      assert.equal(rowDay(new Date(range.since.getTime() - 60_000).toISOString(), zone), timeZone.addDaysToKey(range.dayKeys[0], -1));
    }
  }
});

await run("AN-3c resolveTimeZone accepts IANA zones and falls back to the system zone", async () => {
  assert.equal(timeZone.resolveTimeZone("Asia/Kathmandu"), "Asia/Kathmandu");
  assert.equal(timeZone.resolveTimeZone("Not/AZone"), timeZone.systemTimeZone());
  assert.equal(timeZone.resolveTimeZone(""), timeZone.systemTimeZone());
  assert.equal(timeZone.resolveTimeZone("x".repeat(200)), timeZone.systemTimeZone());
  assert.equal(aggregation.resolveAnalyticsDays("7"), 7);
  assert.equal(aggregation.resolveAnalyticsDays("500"), 90);
  assert.equal(aggregation.resolveAnalyticsDays("nope"), 30);
});

// ── AN-4 ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("AN-4 the ledger read is one range query on the (user_id, ts) index", async () => {
  const plan = getDb().prepare(`EXPLAIN QUERY PLAN ${aggregation.USAGE_BUCKET_SQL}`).all("u", "2026-01-01", "2026-12-31");
  const text = plan.map((row) => row.detail).join(" | ");
  assert.match(text, /idx_llm_usage_user_ts/, `plan: ${text}`);
  assert.doesNotMatch(text, /SCAN llm_usage(?! USING)/, `plan: ${text}`);
});

// ── AN-5 ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("AN-5 budget event history: kinds, order, range, user scope, task names, deleted tasks, bound", async () => {
  const user = "an-budget-user";
  const alpha = await store.createTask(user, { name: "Refactor billing", prompt: "Refactor billing", agent: "openai", model: "gpt-5.6-terra", costBudgetUsd: 2 });
  const beta = await store.createTask(user, { name: "Write release notes", prompt: "Write notes", agent: "claude", model: "claude-sonnet-5", tokenBudget: 100_000 });
  const doomed = await store.createTask(user, { name: "Scratch task", prompt: "tmp", agent: "openai", model: "gpt-5.6-terra" });
  const write = (event) => assert.equal(typeof budgetEvents.recordAgentTaskBudgetEventSafe({ userId: user, ...event }), "string");
  const cost = { costBudgetUsd: 2, tokenBudget: null, model: "gpt-5.6-terra" };
  write({ taskId: alpha.id, kind: "warning", state: "warning", ts: "2026-09-20T08:00:00.000Z", spentUsd: 1.6, spentTokens: 50_000, ...cost });
  write({ taskId: alpha.id, kind: "degraded", state: "degraded", ts: "2026-09-20T08:05:00.000Z", spentUsd: 1.8, spentTokens: 60_000, ...cost, economyModel: "gpt-5.6-mini" });
  write({ taskId: alpha.id, kind: "exhausted", state: "exhausted", ts: "2026-09-20T08:10:00.000Z", spentUsd: 2.05, spentTokens: 70_000, ...cost });
  write({ taskId: alpha.id, kind: "raised", state: "ok", ts: "2026-09-20T09:00:00.000Z", spentUsd: 2.05, spentTokens: 70_000, costBudgetUsd: 5, model: "gpt-5.6-terra" });
  write({ taskId: beta.id, kind: "warning", state: "warning", ts: "2026-09-21T07:00:00.000Z", spentUsd: 0.4, spentTokens: 85_000, tokenBudget: 100_000, model: "claude-sonnet-5" });
  write({ taskId: doomed.id, kind: "warning", state: "warning", ts: "2026-09-21T07:30:00.000Z", spentUsd: 0.1, spentTokens: 10, costBudgetUsd: 0.12 });
  write({ taskId: "task-that-never-existed", kind: "exhausted", state: "exhausted", ts: "2026-09-21T07:45:00.000Z", spentUsd: 1, costBudgetUsd: 1 });
  write({ taskId: alpha.id, kind: "warning", state: "warning", ts: "2026-09-10T08:00:00.000Z", spentUsd: 1.6, ...cost }); // before the range
  assert.equal(typeof budgetEvents.recordAgentTaskBudgetEventSafe({ userId: "an-budget-other", taskId: alpha.id, kind: "warning", state: "warning", ts: "2026-09-21T08:00:00.000Z" }), "string");

  // Soft delete: the row stays with deleted_at until cleanup; its name must no longer be shown.
  getDb().prepare("UPDATE agent_tasks SET deleted_at = ? WHERE user_id = ? AND id = ?").run("2026-09-21T08:00:00.000Z", user, doomed.id);

  const since = aggregation.resolveUsageRange(7, "UTC", new Date("2026-09-21T12:00:00.000Z")).since.toISOString();
  const { history, historyTruncated } = aggregation.readBudgetEventHistory(user, since);
  assert.equal(historyTruncated, false);
  assert.equal(history.length, 7, "in-range events of this user only");
  assert.deepEqual(history.map((event) => event.kind), ["exhausted", "warning", "warning", "raised", "exhausted", "degraded", "warning"]);
  assert.deepEqual(history.map((event) => event.taskName), [null, null, "Write release notes", "Refactor billing", "Refactor billing", "Refactor billing", "Refactor billing"]);
  const degraded = history.find((event) => event.kind === "degraded");
  assert.equal(degraded.economyModel, "gpt-5.6-mini");
  near(degraded.fraction, 0.9, "degraded fraction");
  near(history.find((event) => event.kind === "exhausted" && event.taskName).fraction, 1.025, "exhausted fraction");
  near(history.find((event) => event.taskName === "Write release notes").fraction, 0.85, "token fraction");
  const raised = history.find((event) => event.kind === "raised");
  assert.equal(raised.state, "ok");
  assert.equal(raised.costBudgetUsd, 5);

  // Hard delete through the real store removes the task's history with it.
  await store.deleteTask(user, beta.id);
  const afterDelete = aggregation.readBudgetEventHistory(user, since).history;
  assert.equal(afterDelete.some((event) => event.taskId === beta.id), false, "deleteTask removes the task's events");

  // Bound + truncation flag.
  const busy = "an-budget-busy";
  for (let i = 0; i < types.BUDGET_HISTORY_LIMIT + 5; i++) {
    budgetEvents.insertAgentTaskBudgetEvent({ userId: busy, taskId: "t", kind: "warning", state: "warning", ts: new Date(Date.parse("2026-09-20T00:00:00.000Z") + i * 60_000).toISOString() });
  }
  const bounded = aggregation.readBudgetEventHistory(busy, since);
  assert.equal(bounded.history.length, types.BUDGET_HISTORY_LIMIT);
  assert.equal(bounded.historyTruncated, true);
  assert.ok(bounded.history[0].ts > bounded.history[bounded.history.length - 1].ts, "newest first");
});

guard.restore();
assert.deepEqual(guard.violations, [], "no network calls");

if (failures > 0) {
  console.error(`\n${failures} analytics check(s) failed.`);
  process.exit(1);
}
console.log("\nAnalytics real-writer smoke: all checks passed.");
process.exit(0);
