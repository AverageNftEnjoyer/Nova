// Tiered model routing (token-efficiency Stage 6), shared by the runtime and the HUD.
//
// Every internal model call belongs to a CALL SITE, and every call site has a fixed TIER:
//   trivial   format / intent / extraction work whose answer does not need the user's model
//             (output-format correction, empty-reply recovery, Spotify intent parsing, mission classify / extract,
//             mission step suggestions, the Gmail digest)
//   standard  ordinary chat and tool-result synthesis on a routed lane (web research, email triage, ...)
//   hard      multi-step reasoning, agent tasks (planning + final synthesis), open-ended tool routing, mission
//             generation. NEVER downgraded.
// The tier of a chat turn is decided ONCE per turn by classifyTurnTier() (rules only: source, lane, request shape;
// no model call) and every call of the turn's main path (direct reply, every tool-loop step, the loop's recovery
// call) uses that turn's model. So a tool loop never changes model mid-loop (cache safety, PLAN.md Stage 6 step 4);
// the only mid-loop switch stays the Stage 4 budget degradation.
//
// Routing: trivial (and, in "cost-saving" mode, standard) calls go to the provider's ECONOMY model: the per-provider
// setting of Stage 4 (agent-tasks/budget-settings, kv_state "agent-task-budget"), the single source of truth.
// The provider never changes, so no second API key is needed.
//
// Modes (kv_state namespace "model-routing", key "settings"; nothing is stored until the user saves):
//   off           every call uses the selected model (requests are byte-identical to before Stage 6)
//   trivial       DEFAULT. Only trivial calls may use the economy model.
//   cost-saving   trivial and standard calls may use the economy model; hard calls never.
//
// Cache impact (why a route can be refused): a call routed to another model cannot read the selected model's warm
// prompt cache. A correction pass or an empty-reply recovery resends a prompt the selected model has JUST cached, so
// on the selected model most of its input bills at the cached rate, while on the economy model it bills in full.
// resolveModelRoute() therefore compares the estimated cost of the call on both models (estimateCallCostUsd, with
// each model's own cache minimum) and keeps the selected model whenever routing would not be cheaper.
// Example: a Claude correction pass with a 3,100-token cached static prompt + 1,500 other input tokens + 300 output
// on claude-sonnet-5 costs 3,100 x $0.20 + 1,500 x $2 + 300 x $10 per 1M = $0.00662; on claude-haiku-4-5 (cold, and
// under Haiku's 4,096-token cache minimum) 4,600 x $1 + 300 x $5 = $0.00610: routed, but only just. With 800 other
// input tokens Sonnet costs $0.00522 vs Haiku $0.00540, and the call stays on Sonnet.
//
// A routed call that the provider refuses because the economy model is unavailable to the key (404, "model not
// found", no access) is retried once on the selected model (runWithRouteFallback), so routing can't break a call.
//
// Dependency-light on purpose (the HUD imports it): only the db kv helpers, the pricing tables and budget-settings.

import { kvGet, kvSet } from "../../../db/index.js";
import { resolveModelPricing } from "../../../providers/pricing/index.js";
import { isValidEconomyModel, readAgentTaskBudgetSettings } from "../agent-tasks/budget-settings/index.js";

export const MODEL_ROUTING_KV_NAMESPACE = "model-routing";
export const MODEL_ROUTING_KV_KEY = "settings";

export const MODEL_TIERS = Object.freeze(["trivial", "standard", "hard"]);
export const MODEL_ROUTING_MODES = Object.freeze(["off", "trivial", "cost-saving"]);
/** Default: trivial calls only (see docs/token-efficiency/README.md, "Model routing"). */
export const DEFAULT_MODEL_ROUTING_MODE = "trivial";

/**
 * Every internal model call site and its fixed tier. "turn" = the chat turn's main path, whose tier comes from
 * classifyTurnTier(). A call site not listed here is never routed.
 */
export const MODEL_CALL_SITES = Object.freeze({
  "chat.turn": "turn",
  "chat.output-correction": "trivial",
  // Trivial, except inside a hard turn: the recovery produces that turn's answer (see resolveCallSiteTier).
  "chat.empty-reply-recovery": "trivial",
  "spotify.intent-parse": "trivial",
  "mission.ai-classify": "trivial",
  "mission.ai-extract": "trivial",
  "mission.ai-summarize": "standard",
  "mission.ai-generate": "standard",
  "mission.ai-chat": "standard",
  "mission.build-from-prompt": "hard",
  "utility.nova-suggest": "trivial",
  "utility.gmail-summary": "trivial",
});

// Minimum prompt length (tokens) a provider caches, per model. Sources (read 2026-09-23, docs/token-efficiency/README.md
// "Cache minimums"): OpenAI prompt-caching guide (1,024, automatic);
// platform.claude.com prompt-caching (512 Fable 5.1 / Opus 5.5, 1,024 Sonnet 5, 4,096 Haiku 4.5);
// ai.google.dev caching (implicit: 2,048 for 2.5, 4,096 for 3.x); docs.x.ai prompt caching (no documented minimum).
const CACHE_MIN_PREFIX_TOKENS_BY_MODEL = Object.freeze({
  "claude-fable-5-1": 512,
  "claude-opus-5-5": 512,
  "claude-sonnet-5": 1024,
  "claude-haiku-4-5-20251001": 4096,
  "claude-haiku-4-5": 4096,
});
const CACHE_MIN_PREFIX_TOKENS_BY_PROVIDER = Object.freeze({ openai: 1024, claude: 1024, gemini: 4096, grok: 0 });

/** Output tokens assumed by the routing cost estimate when a call site gives none (the reports' assumption). */
export const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 300;

function normalizeUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeModelRoutingMode(value) {
  const key = normalizeKey(value);
  return MODEL_ROUTING_MODES.includes(key) ? key : DEFAULT_MODEL_ROUTING_MODE;
}

export function normalizeModelTier(value) {
  const key = normalizeKey(value);
  return MODEL_TIERS.includes(key) ? key : null;
}

export function normalizeModelRoutingSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    mode: normalizeModelRoutingMode(source.mode),
    updatedAt: typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
      ? source.updatedAt
      : null,
  };
}

/** The user's routing settings with defaults filled in. Never throws (no user / unreadable row -> defaults). */
export function readModelRoutingSettings(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return normalizeModelRoutingSettings({});
  try {
    return normalizeModelRoutingSettings(kvGet(uid, MODEL_ROUTING_KV_NAMESPACE, MODEL_ROUTING_KV_KEY) || {});
  } catch {
    return normalizeModelRoutingSettings({});
  }
}

/** Save the mode (an invalid mode throws, so a typo can't silently fall back). Throws if userId is missing. */
export function writeModelRoutingSettings(userId, patch) {
  const uid = normalizeUserId(userId);
  if (!uid) throw new Error("A user id is required.");
  const source = patch && typeof patch === "object" ? patch : {};
  const current = readModelRoutingSettings(uid);
  let mode = current.mode;
  if (source.mode !== undefined) {
    const key = normalizeKey(source.mode);
    if (!MODEL_ROUTING_MODES.includes(key)) {
      throw new Error(`Routing mode must be one of: ${MODEL_ROUTING_MODES.join(", ")}.`);
    }
    mode = key;
  }
  const next = normalizeModelRoutingSettings({ mode, updatedAt: new Date().toISOString() });
  kvSet(uid, MODEL_ROUTING_KV_NAMESPACE, MODEL_ROUTING_KV_KEY, next);
  return next;
}

/** Does `mode` allow a call of `tier` to use the economy model? hard: never. */
export function modeRoutesTier(mode, tier) {
  const m = normalizeModelRoutingMode(mode);
  const t = normalizeModelTier(tier);
  if (t === "trivial") return m === "trivial" || m === "cost-saving";
  if (t === "standard") return m === "cost-saving";
  return false;
}

// Operator lanes whose tool loop is financial / account analysis: wrong answers cost money, so they are hard.
const HARD_REASONING_MODES = new Set(["probability-market-analysis", "portfolio-and-account-analysis"]);

// Request-shape rules for multi-step reasoning. Deliberately broad: a false "hard" only means the turn keeps the
// user's model (the pre-Stage-6 behaviour); a false "standard" matters only in cost-saving mode.
const HARD_REQUEST_PATTERN = new RegExp(
  [
    "step[- ]by[- ]step",
    "think (?:it |this )?through",
    "reason (?:it |this )?through",
    "\\bprove\\b",
    "\\bderive\\b",
    "trade-?offs?",
    "pros and cons",
    "\\bdebug",
    "root cause",
    "\\barchitect",
    "\\bdesign (?:a|an|the|my)\\b",
    "\\bplan (?:out|for|my|a|an|the)\\b",
    "\\bstrategy\\b",
    "\\bcompare\\b",
    "\\bversus\\b",
    "\\banaly[sz]",
    "\\bevaluate\\b",
    "\\boptimi[sz]",
    "\\brefactor",
    "\\balgorithm",
    "\\bcalculate\\b",
    "\\bsolve\\b",
  ].join("|"),
  "i",
);
const HARD_REQUEST_MIN_CHARS = 1500;

/**
 * Tier of one chat turn, decided before its first model call and fixed for the whole turn. Rules only:
 *   agent task                                          -> hard      "agent-task"
 *   lane with a financial / account reasoning mode      -> hard      "lane-analysis"
 *   request shape: long, code block, reasoning words    -> hard      "multi-step-reasoning"
 *   tool loop without an operator lane / worker         -> hard      "ambiguous-tool-routing"
 *   tool loop on a routed lane                          -> standard  "tool-result-synthesis"
 *   anything else                                       -> standard  "chat"
 * @param {{ source?: string, toolLoop?: boolean, operatorLane?: {id?: string}|null,
 *   operatorWorker?: {agentId?: string, reasoningMode?: string}|null, text?: string }} input
 * @returns {{ tier: "standard" | "hard", reason: string }}
 */
export function classifyTurnTier({ source, toolLoop = false, operatorLane = null, operatorWorker = null, text = "" } = {}) {
  if (normalizeKey(source) === "agent-task") return { tier: "hard", reason: "agent-task" };
  if (HARD_REASONING_MODES.has(normalizeKey(operatorWorker?.reasoningMode))) return { tier: "hard", reason: "lane-analysis" };
  const body = String(text || "");
  if (body.length >= HARD_REQUEST_MIN_CHARS || body.includes("```") || HARD_REQUEST_PATTERN.test(body)) {
    return { tier: "hard", reason: "multi-step-reasoning" };
  }
  const routedLane = Boolean(normalizeKey(operatorWorker?.agentId) || normalizeKey(operatorLane?.id));
  if (toolLoop) {
    return routedLane
      ? { tier: "standard", reason: "tool-result-synthesis" }
      : { tier: "hard", reason: "ambiguous-tool-routing" };
  }
  return { tier: "standard", reason: "chat" };
}

/**
 * Fixed tier of a call site. `turnTier` is the tier of the turn the call belongs to (chat call sites only):
 * "chat.turn" takes it, and an empty-reply recovery inside a hard turn is hard (it produces that turn's answer).
 * Unknown call sites return null (never routed).
 */
export function resolveCallSiteTier(callSite, { turnTier } = {}) {
  const site = String(callSite || "").trim();
  const fixed = Object.prototype.hasOwnProperty.call(MODEL_CALL_SITES, site) ? MODEL_CALL_SITES[site] : null;
  if (!fixed) return null;
  const turn = normalizeModelTier(turnTier);
  if (fixed === "turn") return turn || "standard";
  if (site === "chat.empty-reply-recovery" && turn === "hard") return "hard";
  return fixed;
}

/** Minimum cacheable prefix (tokens) of `model` on `provider`. */
export function resolveCacheMinPrefixTokens(provider, model) {
  const key = normalizeKey(model);
  if (Object.prototype.hasOwnProperty.call(CACHE_MIN_PREFIX_TOKENS_BY_MODEL, key)) return CACHE_MIN_PREFIX_TOKENS_BY_MODEL[key];
  const providerKey = normalizeKey(provider);
  if (providerKey === "gemini" && key.startsWith("gemini-2.5")) return 2048;
  return Object.prototype.hasOwnProperty.call(CACHE_MIN_PREFIX_TOKENS_BY_PROVIDER, providerKey)
    ? CACHE_MIN_PREFIX_TOKENS_BY_PROVIDER[providerKey]
    : 1024;
}

/**
 * Estimated USD of one call (an ESTIMATE from list prices; null for an unpriced model).
 *   warmPrefixTokens   leading input tokens this model has cached right now (billed at the cached rate when the
 *                      prefix reaches the model's cache minimum)
 *   writePrefixTokens  leading input tokens the request asks the provider to cache (Claude cache_control), billed
 *                      at the cache-write rate when not warm and at least the minimum
 */
export function estimateCallCostUsd({
  provider,
  model,
  inputTokens = 0,
  outputTokens = DEFAULT_ESTIMATED_OUTPUT_TOKENS,
  warmPrefixTokens = 0,
  writePrefixTokens = 0,
} = {}) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const input = toCount(inputTokens);
  const output = toCount(outputTokens);
  const minPrefix = resolveCacheMinPrefixTokens(provider, model);
  const warm = Math.min(input, toCount(warmPrefixTokens));
  const cached = warm > 0 && warm >= minPrefix ? warm : 0;
  const write = cached === 0 ? Math.min(input, toCount(writePrefixTokens)) : 0;
  const written = write > 0 && write >= minPrefix ? write : 0;
  const inputRate = toCount(pricing.input);
  const cachedRate = pricing.cachedInput === undefined ? inputRate : toCount(pricing.cachedInput);
  const writeRate = pricing.cacheWrite === undefined ? inputRate : toCount(pricing.cacheWrite);
  const usd = (cached * cachedRate + written * writeRate + (input - cached - written) * inputRate + output * toCount(pricing.output)) / 1e6;
  return Number(usd.toFixed(8));
}

/** The provider's economy model when it is valid for that provider (budget-settings), else null. */
export function resolveEconomyModelForProvider(userId, provider) {
  const providerKey = normalizeKey(provider);
  const candidate = normalizeKey(readAgentTaskBudgetSettings(normalizeUserId(userId)).economyModels?.[providerKey]);
  return candidate && isValidEconomyModel(providerKey, candidate) ? candidate : null;
}

function rateSum(pricing) {
  return toCount(pricing?.input) + toCount(pricing?.output);
}

/**
 * Decide the model of one call. Never switches provider. Never downgrades hard. Pure except for reading the two
 * settings rows when `settings` / `economyModel` are not passed.
 *
 * @param {object} input
 * @param {string} input.userContextId
 * @param {string} input.provider           the active provider (returned unchanged)
 * @param {string} input.model              the model the call would use without routing (the user's selection)
 * @param {string} input.callSite           a MODEL_CALL_SITES key
 * @param {string} [input.turnTier]         tier of the enclosing chat turn (chat call sites)
 * @param {string} [input.tier]             explicit tier (chat.turn passes classifyTurnTier().tier)
 * @param {boolean} [input.explicitModel]   the user picked this model for this call (mission node model): never routed
 * @param {{mode: string}} [input.settings] readModelRoutingSettings(userId), read once per turn by the caller
 * @param {string|null} [input.economyModel] override for the economy model lookup (tests)
 * @param {object} [input.estimate]         { inputTokens, outputTokens?, mainWarmPrefixTokens?, economyWarmPrefixTokens?,
 *                                            writePrefixTokens? } for the cache-aware cost check; omitted = rate check only
 * @returns {{ provider: string, model: string, selectedModel: string, tier: string|null, mode: string,
 *   routed: boolean, reason: string, estimatedCostUsd: {selected: number|null, economy: number|null}|null }}
 */
export function resolveModelRoute({
  userContextId,
  provider,
  model,
  callSite,
  turnTier,
  tier: explicitTier,
  explicitModel = false,
  settings,
  economyModel: economyOverride,
  estimate,
} = {}) {
  const selectedModel = String(model || "").trim();
  const mode = normalizeModelRoutingMode((settings || readModelRoutingSettings(userContextId)).mode);
  const tier = normalizeModelTier(explicitTier) || resolveCallSiteTier(callSite, { turnTier });
  const base = { provider: String(provider || ""), model: selectedModel, selectedModel, tier, mode, routed: false, estimatedCostUsd: null };
  if (!tier) return { ...base, reason: "unknown-call-site" };
  if (mode === "off") return { ...base, reason: "routing-off" };
  if (tier === "hard") return { ...base, reason: "hard-never-routed" };
  if (!modeRoutesTier(mode, tier)) return { ...base, reason: "tier-not-routed" };
  if (explicitModel) return { ...base, reason: "explicit-model" };
  if (!selectedModel) return { ...base, reason: "no-selected-model" };

  const economyModel = economyOverride === undefined
    ? resolveEconomyModelForProvider(userContextId, provider)
    : (economyOverride && isValidEconomyModel(provider, economyOverride) ? normalizeKey(economyOverride) : null);
  if (!economyModel) return { ...base, reason: "no-economy-model" };
  if (economyModel === normalizeKey(selectedModel)) return { ...base, reason: "already-economy" };

  const selectedPricing = resolveModelPricing(selectedModel);
  const economyPricing = resolveModelPricing(economyModel);
  // An unpriced selected model can't be shown to cost more; never route blind.
  if (!selectedPricing || !economyPricing) return { ...base, reason: "unpriced" };
  if (rateSum(economyPricing) >= rateSum(selectedPricing)) return { ...base, reason: "economy-not-cheaper" };

  if (estimate && typeof estimate === "object") {
    const inputTokens = toCount(estimate.inputTokens);
    const outputTokens = estimate.outputTokens === undefined ? DEFAULT_ESTIMATED_OUTPUT_TOKENS : toCount(estimate.outputTokens);
    const selectedCost = estimateCallCostUsd({
      provider,
      model: selectedModel,
      inputTokens,
      outputTokens,
      warmPrefixTokens: estimate.mainWarmPrefixTokens,
    });
    const economyCost = estimateCallCostUsd({
      provider,
      model: economyModel,
      inputTokens,
      outputTokens,
      warmPrefixTokens: estimate.economyWarmPrefixTokens,
      writePrefixTokens: estimate.writePrefixTokens,
    });
    const estimatedCostUsd = { selected: selectedCost, economy: economyCost };
    if (selectedCost === null || economyCost === null || economyCost >= selectedCost) {
      return { ...base, estimatedCostUsd, reason: "cache-makes-selected-cheaper" };
    }
    return { ...base, model: economyModel, routed: true, estimatedCostUsd, reason: "routed" };
  }
  return { ...base, model: economyModel, routed: true, reason: "routed" };
}

/** True for a provider error that means the model is not available to this key (so the selected model can retry). */
export function isModelUnavailableError(err) {
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
  const message = String(err?.message || err || "").toLowerCase();
  if (status === 404) return true;
  if (/model/.test(message) && /(not[ _]found|does not exist|do not have access|does not have access|not available|no access|unsupported model|invalid model|unknown model|not supported)/.test(message)) {
    return true;
  }
  return false;
}

const reportedFallbacks = new Set();

/**
 * Run `call(model)` on the routed model; if the provider refuses the economy model (isModelUnavailableError), log
 * once per model and run it again on the selected model. Unrouted calls and other errors pass straight through.
 * Returns `{ result, model }` with the model that actually answered.
 */
export async function runWithRouteFallback(route, call) {
  if (!route?.routed) return { result: await call(route?.model), model: route?.model };
  try {
    return { result: await call(route.model), model: route.model };
  } catch (err) {
    if (!isModelUnavailableError(err)) throw err;
    const key = `${route.provider}:${route.model}`;
    if (!reportedFallbacks.has(key)) {
      reportedFallbacks.add(key);
      console.warn(`[ModelRouting] economy model ${route.model} (${route.provider}) was refused; using ${route.selectedModel} instead.`);
    }
    return { result: await call(route.selectedModel), model: route.selectedModel };
  }
}

/** Approximate tokens of any request body, using the runtime estimator (ceil(chars / 3.5)). */
export function approxTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(String(text || "").length / 3.5);
}
