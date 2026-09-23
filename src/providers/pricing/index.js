// Model pricing (USD per 1M tokens) and cost estimation, shared by the runtime and the HUD (mission ledger rows).
// Dependency-free on purpose: the HUD imports it, so it must not pull in runtime constants (env / workspace checks).
//
// Rate fields: input (uncached input), cachedInput (cache read), cacheWrite (Anthropic 5-minute cache write),
// output. A missing cachedInput / cacheWrite rate falls back to the input rate (never under-reports).
// Sources: see the comment block above each table (PLACEHOLDER: filled from official pricing pages).

export const OPENAI_MODEL_PRICING_USD_PER_1M = {
  "gpt-5.2": { input: 1.75, output: 14.0 },
  "gpt-5.2-pro": { input: 12.0, output: 96.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.6, output: 2.4 },
};

export const CLAUDE_MODEL_PRICING_USD_PER_1M = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
};

export const GEMINI_MODEL_PRICING_USD_PER_1M = {};

export const GROK_MODEL_PRICING_USD_PER_1M = {};

const PRICING_TABLES = [
  OPENAI_MODEL_PRICING_USD_PER_1M,
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
];

export function resolveModelPricing(model) {
  const key = String(model || "").trim();
  for (const table of PRICING_TABLES) {
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  }
  const normalized = key.toLowerCase();
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 };
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 };
  return null;
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Estimated USD cost of one call (or a sum of calls), or null when the model has no pricing.
 * `promptTokens` is the TOTAL input (cached and cache-write included, as returned by the usage normalisers);
 * the optional split bills the cached part at cachedInput and the cache-write part at cacheWrite.
 * Called with only (model, promptTokens, completionTokens) it behaves exactly as before.
 */
export function estimateTokenCostUsd(model, promptTokens = 0, completionTokens = 0, cache = {}) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const totalInput = toCount(promptTokens);
  const cached = Math.min(toCount(cache?.cachedInputTokens), totalInput);
  const cacheWrite = Math.min(toCount(cache?.cacheWriteInputTokens), totalInput - cached);
  const uncached = totalInput - cached - cacheWrite;
  const cachedRate = Number.isFinite(pricing.cachedInput) ? pricing.cachedInput : pricing.input;
  const cacheWriteRate = Number.isFinite(pricing.cacheWrite) ? pricing.cacheWrite : pricing.input;
  const inputCost = (uncached * pricing.input + cached * cachedRate + cacheWrite * cacheWriteRate) / 1_000_000;
  const outputCost = (toCount(completionTokens) / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}
