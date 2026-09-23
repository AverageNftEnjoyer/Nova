/**
 * Token-efficiency Stage 0: cost math (src/providers/pricing).
 *
 * Rates are read from the exported tables (they are maintained from the providers' pricing pages), so the tests
 * check the arithmetic and the fallback rules rather than hard-coding every price. TC-C8 pins two known values.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

import {
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  estimateTokenCostUsd,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  LEGACY_MODEL_PRICING_USD_PER_1M,
  OPENAI_MODEL_PRICING_USD_PER_1M,
  resolveModelPricing,
} from "../../../src/providers/pricing/index.js";

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

const round6 = (value) => Number(value.toFixed(6));
// The implementation rounds once to 6 decimals; allow one unit of float noise in the last place.
function assertCost(actual, expected, label) {
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) <= 1.000001e-6,
    `${label}: expected ~${expected}, got ${actual}`,
  );
}
const ALL_TABLES = {
  openai: OPENAI_MODEL_PRICING_USD_PER_1M,
  claude: CLAUDE_MODEL_PRICING_USD_PER_1M,
  gemini: GEMINI_MODEL_PRICING_USD_PER_1M,
  grok: GROK_MODEL_PRICING_USD_PER_1M,
  legacy: LEGACY_MODEL_PRICING_USD_PER_1M,
};

function findModel(predicate) {
  for (const table of Object.values(ALL_TABLES)) {
    for (const [model, rate] of Object.entries(table)) {
      if (predicate(rate, model)) return { model, rate };
    }
  }
  return null;
}

await run("TC-C1 every current provider table is non-empty (Gemini and Grok are priced)", async () => {
  for (const [name, table] of Object.entries(ALL_TABLES)) {
    assert.ok(Object.keys(table).length > 0, `${name} pricing table is empty`);
    for (const [model, rate] of Object.entries(table)) {
      assert.ok(Number.isFinite(rate.input) && rate.input >= 0, `${model}.input`);
      assert.ok(Number.isFinite(rate.output) && rate.output >= 0, `${model}.output`);
    }
  }
});

await run("TC-C2 backward-compatible 3-arg call bills all input at the input rate", async () => {
  for (const table of Object.values(ALL_TABLES)) {
    for (const [model, rate] of Object.entries(table)) {
      const expected = round6((12_345 * rate.input + 678 * rate.output) / 1_000_000);
      assertCost(estimateTokenCostUsd(model, 12_345, 678), expected, model);
      assert.equal(estimateTokenCostUsd(model, 12_345, 678, {}), estimateTokenCostUsd(model, 12_345, 678), `${model} (empty cache split)`);
    }
  }
});

await run("TC-C3 cache split: cached at cachedInput, cache-write at cacheWrite, rest at input", async () => {
  const hit = findModel((rate) => Number.isFinite(rate.cachedInput) && Number.isFinite(rate.cacheWrite));
  assert.ok(hit, "no model with both cachedInput and cacheWrite rates");
  const { model, rate } = hit;
  const total = 10_000;
  const cached = 6_000;
  const write = 1_500;
  const expected = round6(
    ((total - cached - write) * rate.input + cached * rate.cachedInput + write * rate.cacheWrite + 800 * rate.output) / 1_000_000,
  );
  assertCost(
    estimateTokenCostUsd(model, total, 800, { cachedInputTokens: cached, cacheWriteInputTokens: write }),
    expected,
    model,
  );
  // A cache hit must never cost more than the same call uncached when cachedInput < input.
  if (rate.cachedInput < rate.input) {
    assert.ok(
      estimateTokenCostUsd(model, total, 800, { cachedInputTokens: cached }) < estimateTokenCostUsd(model, total, 800),
      "cached call should be cheaper",
    );
  }
});

await run("TC-C4 missing cachedInput / cacheWrite rates fall back to the input rate", async () => {
  const noCached = findModel((rate) => !Number.isFinite(rate.cachedInput));
  assert.ok(noCached, "no model without a cachedInput rate to test the fallback");
  assert.equal(
    estimateTokenCostUsd(noCached.model, 5_000, 100, { cachedInputTokens: 4_000 }),
    estimateTokenCostUsd(noCached.model, 5_000, 100),
    `${noCached.model}: cached tokens billed at input rate`,
  );
  const noWrite = findModel((rate) => !Number.isFinite(rate.cacheWrite));
  assert.ok(noWrite, "no model without a cacheWrite rate to test the fallback");
  const { model, rate } = noWrite;
  const cachedRate = Number.isFinite(rate.cachedInput) ? rate.cachedInput : rate.input;
  assertCost(
    estimateTokenCostUsd(model, 5_000, 100, { cachedInputTokens: 1_000, cacheWriteInputTokens: 2_000 }),
    round6((2_000 * rate.input + 1_000 * cachedRate + 2_000 * rate.input + 100 * rate.output) / 1_000_000),
    `${model}: cache-write tokens billed at input rate`,
  );
});

await run("TC-C5 cache split is clamped to the total input (never negative uncached input)", async () => {
  const { model, rate } = findModel((r) => Number.isFinite(r.cachedInput) && Number.isFinite(r.cacheWrite));
  assertCost(
    estimateTokenCostUsd(model, 1_000, 0, { cachedInputTokens: 5_000, cacheWriteInputTokens: 5_000 }),
    round6((1_000 * rate.cachedInput) / 1_000_000),
    model,
  );
  assert.equal(estimateTokenCostUsd(model, 0, 0), 0);
  assert.equal(estimateTokenCostUsd(model, -10, "x"), 0);
});

await run("TC-C6 unknown model returns null; lookup is exact and case-insensitive", async () => {
  assert.equal(estimateTokenCostUsd("not-a-real-model-xyz", 1000, 1000), null);
  assert.equal(estimateTokenCostUsd("", 1000, 1000), null);
  assert.equal(resolveModelPricing("not-a-real-model-xyz"), null);
  const [anyModel] = Object.keys(CLAUDE_MODEL_PRICING_USD_PER_1M);
  assert.deepEqual(resolveModelPricing(anyModel.toUpperCase()), CLAUDE_MODEL_PRICING_USD_PER_1M[anyModel]);
});

await run("TC-C7 Gemini / Grok models are priced (gemini-2.5-pro, grok-4-0709, gemini-3.8-flash, grok-4.3)", async () => {
  for (const model of ["gemini-2.5-pro", "grok-4-0709", "gemini-3.8-flash", "grok-4.3"]) {
    const cost = estimateTokenCostUsd(model, 1_000_000, 1_000_000);
    assert.ok(cost !== null && cost > 0, `${model} is unpriced`);
  }
});

await run("TC-C8 pinned known values (claude-sonnet-5, gpt-4.1-mini)", async () => {
  // claude-sonnet-5: $2 / $10 per 1M, cache read $0.20, cache write $2.50 (pricing page, 2026-09-23).
  assert.equal(estimateTokenCostUsd("claude-sonnet-5", 1_000_000, 1_000_000), 12);
  assert.equal(
    estimateTokenCostUsd("claude-sonnet-5", 1_000_000, 0, { cachedInputTokens: 500_000, cacheWriteInputTokens: 500_000 }),
    1.35,
  );
  // gpt-4.1-mini (legacy table): $0.40 input, $0.10 cached, $1.60 output.
  assert.equal(estimateTokenCostUsd("gpt-4.1-mini", 1_000_000, 1_000_000), 2);
  assert.equal(estimateTokenCostUsd("gpt-4.1-mini", 1_000_000, 0, { cachedInputTokens: 1_000_000 }), 0.1);
});

for (const result of results) summarize(result);
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\ncost-math: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
