// Agent-task budget settings (token-efficiency Stage 4), shared by the runtime and the HUD.
//
// Stored per user in kv_state (namespace "agent-task-budget", key "settings"). Nothing is stored until the user
// saves the settings; reads always return a complete, normalised object with the defaults filled in.
//
// Budgets are on COST by default (user decision 2026-09-24). The token budget is optional (no default limit):
// cached input tokens count as tokens but cost ~10% of the uncached rate on most providers, so a token limit trips
// long before the money it was meant to protect. A user can still set a default token limit, or one per task.
//
// Default cost budget, sized so a normal task on the MOST expensive current model does not reach it. Offline
// baseline (docs/token-efficiency/README.md): the "agent-task" harness scenario (5 tool steps + final answer)
// sends 30,754 ~tok of input over 6 calls (OpenAI shape; Claude shape 30,390), ~300 output tokens per call (1,800,
// an assumption: the fake client reports none), all input billed UNCACHED (worst case). Current picker models:
//     gpt-6-astra        30,754 x $10/M + 1,800 x $50/M = $0.3075 + $0.0900 = $0.398   <- most expensive
//     claude-fable-5-1   30,390 x $10/M + 1,800 x $50/M = $0.3039 + $0.0900 = $0.394
//     gpt-5.6-sol        30,754 x  $4/M + 1,800 x $20/M = $0.1230 + $0.0360 = $0.159
//     claude-opus-5-5    30,390 x  $4/M + 1,800 x $20/M = $0.1216 + $0.0360 = $0.158
//     gpt-5.6-terra / gemini-3.1-pro-preview $0.083, claude-sonnet-5 $0.079, grok-4.7 $0.072, the rest less.
//   3x the worst case = $1.19. With the scenario's input 25% larger (38,443 tok) astra costs $0.474 and 3x is $1.42.
//   Default: $2.00 = 5.0x today's worst case, 4.2x with +25% input (still >= 3x up to ~+87% input). Cheaper models
//   rarely come near it, which is intended: the budget is a runaway guard, not a per-model tuning knob.
//   (Legacy gpt-5.5-pro, 30 / 180 per 1M, is not a picker model: ~$1.25 per such task, so it can reach $2.00.)
//   Re-checked after the per-turn context fix (2026-09-24 close-out; the scenario now sends 32,144 ~tok OpenAI shape,
//   31,782 Claude shape): gpt-6-astra 32,144 x $10/M + $0.09 = $0.411, claude-fable-5-1 $0.408; 3x = $1.23, so
//   $2.00 is 4.9x the worst case.

// Economy models: the cheapest tool-capable model of each provider in Nova's pickers (src/providers/pricing):
//   openai gpt-5.6-luna (0.20 / 1.20), claude claude-haiku-4-5-20251001 (1.00 / 5.00),
//   gemini gemini-3.1-flash-lite (0.25 / 1.50), grok grok-build-0.1 (1.00 / 2.00).
// An economy model must be one of the SAME provider's current models, so a degraded task never needs another key.
//
// Dependency-light on purpose (the HUD imports it): only the db kv helpers and the pricing tables.

import { kvGet, kvSet } from "../../../../db/index.js";
import {
  CLAUDE_MODEL_PRICING_USD_PER_1M,
  GEMINI_MODEL_PRICING_USD_PER_1M,
  GROK_MODEL_PRICING_USD_PER_1M,
  OPENAI_MODEL_PRICING_USD_PER_1M,
  resolveModelPricing,
} from "../../../../providers/pricing/index.js";

export const AGENT_TASK_BUDGET_KV_NAMESPACE = "agent-task-budget";
export const AGENT_TASK_BUDGET_KV_KEY = "settings";

export const AGENT_TASK_BUDGET_PROVIDERS = Object.freeze(["openai", "claude", "gemini", "grok"]);
export const AGENT_TASK_BUDGET_STATES = Object.freeze(["ok", "warning", "degraded", "exhausted"]);

/** Fraction of the budget at which the task turns to 'warning'. */
export const AGENT_TASK_BUDGET_WARNING_FRACTION = 0.8;

export const DEFAULT_AGENT_TASK_COST_BUDGET_USD = 2;
/** No default token limit: budgets are on cost (see the header). A user default or a per-task value may set one. */
export const DEFAULT_AGENT_TASK_TOKEN_BUDGET = null;

export const AGENT_TASK_COST_BUDGET_LIMITS = Object.freeze({ min: 0.01, max: 100 });
export const AGENT_TASK_TOKEN_BUDGET_LIMITS = Object.freeze({ min: 1_000, max: 10_000_000 });

export const DEFAULT_ECONOMY_MODELS = Object.freeze({
  openai: "gpt-5.6-luna",
  claude: "claude-haiku-4-5-20251001",
  gemini: "gemini-3.1-flash-lite",
  grok: "grok-build-0.1",
});

const PROVIDER_MODEL_TABLES = Object.freeze({
  openai: OPENAI_MODEL_PRICING_USD_PER_1M,
  claude: CLAUDE_MODEL_PRICING_USD_PER_1M,
  gemini: GEMINI_MODEL_PRICING_USD_PER_1M,
  grok: GROK_MODEL_PRICING_USD_PER_1M,
});

/** The provider's current (picker) model IDs, which are the valid economy-model choices for that provider. */
export function listEconomyModelCandidates(provider) {
  const table = PROVIDER_MODEL_TABLES[String(provider || "").trim().toLowerCase()];
  return table ? Object.keys(table) : [];
}

export function isValidEconomyModel(provider, model) {
  const key = String(model || "").trim().toLowerCase();
  return key.length > 0 && listEconomyModelCandidates(provider).includes(key);
}

/**
 * A cost budget in USD, or null. Accepts numbers / numeric strings inside AGENT_TASK_COST_BUDGET_LIMITS
 * (rounded to 4 decimals); anything else (empty, 0, negative, NaN, out of range) is null.
 */
export function normalizeCostBudgetUsd(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < AGENT_TASK_COST_BUDGET_LIMITS.min || parsed > AGENT_TASK_COST_BUDGET_LIMITS.max) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

/** A token budget (integer), or null when missing / out of AGENT_TASK_TOKEN_BUDGET_LIMITS. */
export function normalizeTokenBudget(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < AGENT_TASK_TOKEN_BUDGET_LIMITS.min || rounded > AGENT_TASK_TOKEN_BUDGET_LIMITS.max) return null;
  return rounded;
}

export function normalizeBudgetState(value) {
  const key = String(value || "").trim().toLowerCase();
  return AGENT_TASK_BUDGET_STATES.includes(key) ? key : "ok";
}

/**
 * Normalise stored / submitted settings. A default budget field that is explicitly null (or 0 / empty) means
 * "no default limit" for that dimension; a field that is absent (undefined) takes the built-in default
 * ($2.00 for cost, no limit for tokens). A token default the user saved is kept as saved.
 */
export function normalizeAgentTaskBudgetSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const economySource = source.economyModels && typeof source.economyModels === "object" ? source.economyModels : {};
  const economyModels = {};
  for (const provider of AGENT_TASK_BUDGET_PROVIDERS) {
    const candidate = String(economySource[provider] || "").trim().toLowerCase();
    economyModels[provider] = isValidEconomyModel(provider, candidate) ? candidate : DEFAULT_ECONOMY_MODELS[provider];
  }
  return {
    defaultCostBudgetUsd: source.defaultCostBudgetUsd === undefined
      ? DEFAULT_AGENT_TASK_COST_BUDGET_USD
      : normalizeCostBudgetUsd(source.defaultCostBudgetUsd),
    defaultTokenBudget: source.defaultTokenBudget === undefined
      ? DEFAULT_AGENT_TASK_TOKEN_BUDGET
      : normalizeTokenBudget(source.defaultTokenBudget),
    economyModels,
    updatedAt: typeof source.updatedAt === "string" && Number.isFinite(Date.parse(source.updatedAt))
      ? source.updatedAt
      : null,
  };
}

function normalizeUserId(userId) {
  return String(userId || "").trim().toLowerCase();
}

/** The user's settings with defaults filled in. Never throws: a missing user or unreadable row gives the defaults. */
export function readAgentTaskBudgetSettings(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return normalizeAgentTaskBudgetSettings({});
  try {
    return normalizeAgentTaskBudgetSettings(kvGet(uid, AGENT_TASK_BUDGET_KV_NAMESPACE, AGENT_TASK_BUDGET_KV_KEY) || {});
  } catch {
    return normalizeAgentTaskBudgetSettings({});
  }
}

/**
 * Merge a patch into the stored settings and save. Patch fields that are undefined keep the current value;
 * null clears a default budget ("no limit"). Returns the saved, normalised settings. Throws if userId is missing.
 */
export function writeAgentTaskBudgetSettings(userId, patch) {
  const uid = normalizeUserId(userId);
  if (!uid) throw new Error("A user id is required.");
  const current = readAgentTaskBudgetSettings(uid);
  const source = patch && typeof patch === "object" ? patch : {};
  const next = normalizeAgentTaskBudgetSettings({
    defaultCostBudgetUsd: source.defaultCostBudgetUsd === undefined ? current.defaultCostBudgetUsd : source.defaultCostBudgetUsd,
    defaultTokenBudget: source.defaultTokenBudget === undefined ? current.defaultTokenBudget : source.defaultTokenBudget,
    economyModels: { ...current.economyModels, ...(source.economyModels && typeof source.economyModels === "object" ? source.economyModels : {}) },
    updatedAt: new Date().toISOString(),
  });
  kvSet(uid, AGENT_TASK_BUDGET_KV_NAMESPACE, AGENT_TASK_BUDGET_KV_KEY, next);
  return next;
}

/**
 * The budget that applies to one task: its own value when set, otherwise the user's default.
 * `active` is false when neither dimension has a limit (the task then runs exactly as before Stage 4).
 */
export function resolveEffectiveTaskBudget({ costBudgetUsd, tokenBudget }, settings) {
  const ownCost = normalizeCostBudgetUsd(costBudgetUsd);
  const ownTokens = normalizeTokenBudget(tokenBudget);
  const effectiveCost = ownCost ?? settings?.defaultCostBudgetUsd ?? null;
  const effectiveTokens = ownTokens ?? settings?.defaultTokenBudget ?? null;
  return {
    costUsd: effectiveCost,
    tokens: effectiveTokens,
    costSource: ownCost !== null ? "task" : effectiveCost !== null ? "default" : "none",
    tokenSource: ownTokens !== null ? "task" : effectiveTokens !== null ? "default" : "none",
    active: effectiveCost !== null || effectiveTokens !== null,
  };
}

/**
 * Share of the budget spent: the larger of cost and token use; a dimension without a limit does not count (with the
 * default cost-only budget this is the cost share alone; 0 when no dimension has a limit).
 * spentTokens = total tokens (input incl. cached + output). spentUsd of an unpriced model is 0, so a cost-only budget
 * can never trip for it (see isCostBudgetBlind); a token limit, if set, still counts.
 */
export function computeBudgetFraction({ spentUsd, spentTokens }, budget) {
  const costFraction = budget?.costUsd ? Math.max(0, Number(spentUsd) || 0) / budget.costUsd : 0;
  const tokenFraction = budget?.tokens ? Math.max(0, Number(spentTokens) || 0) / budget.tokens : 0;
  return Math.max(costFraction, tokenFraction);
}

/** State implied by the spend alone (used when a task is (re)queued): 'ok' below 80%, else 'warning'. */
export function budgetStateForSpend(spend, budget) {
  if (!budget?.active) return "ok";
  return computeBudgetFraction(spend, budget) >= AGENT_TASK_BUDGET_WARNING_FRACTION ? "warning" : "ok";
}

/**
 * True when the budget cannot stop a task on `model`: the only limit is cost and Nova has no price for the model
 * (its calls are recorded at $0). Such a task is NOT blocked; the runtime logs it and the HUD says so on the task,
 * so the user can add a token budget. Every model in Nova's pickers is priced, so this only affects custom IDs.
 */
export function isCostBudgetBlind(budget, model) {
  if (!budget?.active || (budget.tokens !== null && budget.tokens !== undefined)) return false;
  return budget.costUsd !== null && budget.costUsd !== undefined && resolveModelPricing(model) === null;
}
