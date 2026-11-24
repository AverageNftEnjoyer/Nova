// Model pricing (USD per 1M tokens) and cost estimation, shared by the runtime and the HUD (pickers, ledger rows).
// Dependency-free on purpose: the HUD imports it, so it must not pull in runtime constants (env / workspace checks).
//
// Rate fields: input (uncached input), cachedInput (cache read / cached prompt tokens), cacheWrite (cache write;
// Anthropic 5-minute rate), output. A missing cachedInput / cacheWrite rate falls back to the input rate, which
// never under-reports. Only the standard tier is modelled: long-context tiers (Gemini Pro and xAI > 200k prompt
// tokens, OpenAI GPT-6 Sol / GPT-5.6 > 272k) are billed higher by the providers and are not applied here.
//
// Every rate below was read from the provider's official pricing page on 2026-09-23 (never estimated):
//   OpenAI     https://developers.openai.com/api/docs/pricing  (+ /api/docs/models, /api/docs/deprecations)
//   Anthropic  https://platform.claude.com/docs/en/about-claude/pricing  (+ /models/overview, /model-deprecations)
//   Google     https://ai.google.dev/gemini-api/docs/pricing  (+ /gemini-api/docs/models)
//   xAI        https://docs.x.ai/developers/models  (+ /developers/migration/may-15-retirement)
// Embedding rates (EMBEDDING_MODEL_PRICING_USD_PER_1M) were read from https://developers.openai.com/api/docs/pricing
// ("Embeddings", standard tier) on 2026-09-24.
// Models with no verifiable rate are deliberately absent (cost is then null and logged once, see below).
//
// *_MODEL_PRICING_USD_PER_1M tables hold the CURRENT models offered in Nova's pickers.
// LEGACY_MODEL_PRICING_USD_PER_1M holds models that still answer API calls (deprecated or superseded, but not
// shut down) so cost stays correct for users whose stored configuration still names one. Retired models
// (requests fail) are not priced.

export const OPENAI_MODEL_PRICING_USD_PER_1M = Object.freeze({
  "gpt-6-astra": { input: 10.0, cachedInput: 1.0, output: 50.0 },
  // Chat Completions does not report cache writes, so cacheWrite is informational for this model.
  "gpt-6-sol": { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 10.0 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-5.6-sol": { input: 4.0, cachedInput: 0.4, output: 20.0 },
  "gpt-5.6-terra": { input: 2.0, cachedInput: 0.2, output: 12.0 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
});

export const CLAUDE_MODEL_PRICING_USD_PER_1M = Object.freeze({
  "claude-opus-5-5": { input: 4.0, cachedInput: 0.2, cacheWrite: 5.0, output: 20.0 },
  "claude-sonnet-5": { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 10.0 },
  "claude-fable-5-1": { input: 10.0, cachedInput: 0.25, cacheWrite: 12.5, output: 50.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
});

export const GEMINI_MODEL_PRICING_USD_PER_1M = Object.freeze({
  // Standard paid tier. gemini-3.8-flash rises to 1.50 / 0.15 / 7.50 after 2026-12-31 (per the pricing page).
  "gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.1-pro-preview": { input: 2.0, cachedInput: 0.2, output: 12.0 },
  "gemini-3.5-flash-lite": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, cachedInput: 0.025, output: 1.5 },
});

export const GROK_MODEL_PRICING_USD_PER_1M = Object.freeze({
  "grok-4.7": { input: 2.0, cachedInput: 0.5, output: 6.0 },
  "grok-4.3": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-build-0.1": { input: 1.0, cachedInput: 0.2, output: 2.0 },
});

export const LEGACY_MODEL_PRICING_USD_PER_1M = Object.freeze({
  // OpenAI: superseded or deprecated but still served (gpt-5 / -mini / -nano snapshots shut down 2026-12-11,
  // gpt-4.1-nano 2026-10-23). "-pro" models have no cached-input rate.
  "gpt-5.5": { input: 5.0, cachedInput: 0.5, output: 30.0 },
  "gpt-5.5-pro": { input: 30.0, output: 180.0 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14.0 },
  "gpt-5.2-pro": { input: 21.0, output: 168.0 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10.0 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Anthropic: "Legacy models (still available)". Pre-4.6 models use dated IDs plus a short alias.
  "claude-haiku-4-5": { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
  "claude-fable-5": { input: 10.0, cachedInput: 1.0, cacheWrite: 12.5, output: 50.0 },
  "claude-opus-5": { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  "claude-opus-4-5-20251101": { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  // Google: older stable / preview / limited-access models.
  "gemini-3.7-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, cachedInput: 0.15, output: 9.0 },
  "gemini-3-flash-preview": { input: 0.5, cachedInput: 0.05, output: 3.0 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.125, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cachedInput: 0.01, output: 0.4 },
  // xAI: older current-generation models (grok-4.20-* are still listed on docs.x.ai/developers/models at the
  // grok-4.3 rates; re-checked 2026-09-24), plus the slugs retired on 2026-05-15 that now redirect to grok-4.3 and
  // are "billed at grok-4.3 pricing" (migration doc). grok-code-fast-1 (-> grok-build-0.1) and grok-3-mini have
  // no documented billing rate and are left unpriced.
  "grok-4.6": { input: 2.0, cachedInput: 0.5, output: 6.0 },
  "grok-4.5": { input: 2.0, cachedInput: 0.3, output: 6.0 },
  "grok-4.3-latest": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4.20-0309-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4.20-0309-non-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4.20-multi-agent-0309": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4-0709": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4-fast-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4-fast-non-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4-1-fast-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-4-1-fast-non-reasoning": { input: 1.25, cachedInput: 0.2, output: 2.5 },
  "grok-3": { input: 1.25, cachedInput: 0.2, output: 2.5 },
});

// Embedding models bill input tokens only (the pricing page lists no cached-input or output rate).
export const EMBEDDING_MODEL_PRICING_USD_PER_1M = Object.freeze({
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "text-embedding-ada-002": { input: 0.1, output: 0 },
});

const PRICING_TABLES = [
  OPENAI_MODEL_PRICING_USD_PER_1M,
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  LEGACY_MODEL_PRICING_USD_PER_1M,
  EMBEDDING_MODEL_PRICING_USD_PER_1M,
];

/** Exact-ID lookup (case-insensitive). No family-prefix guessing: an unknown ID returns null. */
export function resolveModelPricing(model) {
  const key = String(model || "").trim().toLowerCase();
  if (!key) return null;
  for (const table of PRICING_TABLES) {
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  }
  return null;
}

// Unpriced model IDs already reported by estimateTokenCostUsd (one warning per ID per process).
const reportedUnpricedModels = new Set();

function reportUnpricedModel(model) {
  const key = String(model || "").trim();
  if (!key || reportedUnpricedModels.has(key)) return;
  reportedUnpricedModels.add(key);
  console.warn(`[Pricing] No verified price for model "${key}"; its cost is recorded as unknown.`);
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Estimated USD cost of one call (or a sum of calls), or null when the model has no pricing (logged once per ID).
 * `promptTokens` is the TOTAL input (cached and cache-write included, as returned by the usage normalisers);
 * the optional split bills the cached part at cachedInput and the cache-write part at cacheWrite.
 * Called with only (model, promptTokens, completionTokens) it bills all input at the input rate, as before.
 */
export function estimateTokenCostUsd(model, promptTokens = 0, completionTokens = 0, cache = {}) {
  const pricing = resolveModelPricing(model);
  if (!pricing) {
    reportUnpricedModel(model);
    return null;
  }
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
