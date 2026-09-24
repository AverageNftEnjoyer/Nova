// Per-task budget controller (token-efficiency Stage 4): graceful degradation for one agent-task attempt.
//
// One controller per attempt. It watches every LLM call of the attempt (observe, via withLlmUsageObserver) and is
// asked before EVERY model call of the tool loops (beforeModelCall). Spend = the task's earlier attempts (prior)
// plus this attempt. The budget has a cost and/or a token dimension; the fraction spent is the larger of the two.
//
//   ok        -> warning    at >= 80% spent (event only; nothing changes for the model).
//   warning   -> degraded   the next call is projected to go over: ONCE, earlier tool results in the loop's history
//                           are shortened and the provider's economy model is used from then on.
//   degraded  -> exhausted  a call would still go over: the loop throws AgentTaskBudgetExhaustedError BEFORE the
//                           call, and the agent-task service pauses the task (pause_reason 'budget').
//
// Projection of the next call (deliberately conservative): input = max(last call's input, estimate of the request
// about to be sent), billed entirely at the UNCACHED input rate; output = last call's output (256 before any call).
// An unpriced model projects no cost (its tokens still count against a token budget). With the default cost-only
// budget such a task is never stopped: it is not blocked, the service logs it and the HUD shows it on the task.
//
// Calls outside the loops (direct completion without tools, the output-constraint correction pass after a loop)
// can't be trimmed or moved to the economy model, so execute-chat-request only asks guardCall() before them:
// a task that has already spent its budget pauses as exhausted instead of making the call (Stage 5 issue 17).
//
// The projection stays at the uncached input rate (Stage 5 issue 18, kept on purpose): the cached share of the
// NEXT call is unknown until the provider answers, and under-projecting would let a call go over the budget.
// The cost of being safe is small: a task can pause (or degrade) one call earlier than strictly necessary.

import { resolveModelPricing } from "../../../../providers/pricing/index.js";
import {
  AGENT_TASK_BUDGET_WARNING_FRACTION,
  budgetStateForSpend,
  computeBudgetFraction,
  isValidEconomyModel,
} from "../budget-settings/index.js";

export const AGENT_TASK_BUDGET_EXHAUSTED = "AGENT_TASK_BUDGET_EXHAUSTED";

const DEFAULT_PROJECTED_OUTPUT_TOKENS = 256;

export class AgentTaskBudgetExhaustedError extends Error {
  constructor(snapshot) {
    super("This agent task reached its budget.");
    this.name = "AgentTaskBudgetExhaustedError";
    this.code = AGENT_TASK_BUDGET_EXHAUSTED;
    this.snapshot = snapshot;
  }
}

function toNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundUsd(value) {
  return Number(toNonNegative(value).toFixed(6));
}

function normalizeModelId(model) {
  return String(model || "").trim();
}

/** Input + output rate (USD per 1M) of a priced model, or null. */
function pricingRateSum(model) {
  const pricing = resolveModelPricing(model);
  return pricing ? toNonNegative(pricing.input) + toNonNegative(pricing.output) : null;
}

/**
 * The economy model to degrade to: the configured one for `provider` when it is one of that provider's models and
 * is priced strictly cheaper than `model`. Otherwise null (the task keeps its model; only the context is trimmed).
 */
function resolveEconomyModel(provider, model, economyModels) {
  const providerKey = String(provider || "").trim().toLowerCase();
  const candidate = normalizeModelId(economyModels?.[providerKey]).toLowerCase();
  if (!candidate || !isValidEconomyModel(providerKey, candidate)) return null;
  const candidateRate = pricingRateSum(candidate);
  const currentRate = pricingRateSum(model);
  if (candidateRate === null || currentRate === null) return null;
  return candidateRate < currentRate ? candidate : null;
}

/**
 * A budget controller for one attempt, or null when no budget applies (budget.active false): callers then run
 * exactly as before Stage 4.
 *
 * @param {object} input
 * @param {string} input.userContextId
 * @param {string} input.taskId
 * @param {{ costUsd: number|null, tokens: number|null, active: boolean }} input.budget  resolveEffectiveTaskBudget()
 * @param {{ spentUsd: number, spentTokens: number }} [input.prior]  spend of earlier attempts
 * @param {Record<string, string>} [input.economyModels]  provider -> economy model id
 * @param {(event: object) => void} [input.onEvent]  called on warning / degraded / exhausted; errors are swallowed
 */
export function createTaskBudgetController({
  userContextId,
  taskId,
  budget,
  prior = { spentUsd: 0, spentTokens: 0 },
  economyModels,
  onEvent,
} = {}) {
  if (!budget?.active) return null;

  const priorSpend = {
    spentUsd: toNonNegative(prior?.spentUsd),
    spentTokens: toNonNegative(prior?.spentTokens),
  };
  let spentUsd = priorSpend.spentUsd;
  let spentTokens = priorSpend.spentTokens;
  let lastCallInputTokens = 0;
  let lastCallOutputTokens = 0;
  let state = budgetStateForSpend(priorSpend, budget);
  let degraded = false;
  let economyModel = null;
  let lastModel = "";

  const fractionOf = (usd, tokens) => computeBudgetFraction({ spentUsd: usd, spentTokens: tokens }, budget);

  function snapshot() {
    return {
      state,
      spentUsd: roundUsd(spentUsd),
      spentTokens: Math.round(spentTokens),
      costBudgetUsd: budget.costUsd ?? null,
      tokenBudget: budget.tokens ?? null,
      fraction: Number(fractionOf(spentUsd, spentTokens).toFixed(4)),
      degraded,
      economyModel,
      lastModel,
    };
  }

  function emit(reason, model, extra = {}) {
    if (typeof onEvent !== "function") return;
    const current = snapshot();
    try {
      onEvent({
        type: "agent-task-budget",
        userContextId: String(userContextId || ""),
        taskId: String(taskId || ""),
        state: current.state,
        reason,
        spentUsd: current.spentUsd,
        spentTokens: current.spentTokens,
        costBudgetUsd: current.costBudgetUsd,
        tokenBudget: current.tokenBudget,
        fraction: current.fraction,
        model: normalizeModelId(model),
        economyModel: current.economyModel,
        ...extra,
        ts: Date.now(),
      });
    } catch {
      // A failing listener must never break the task.
    }
  }

  function exhaust(model) {
    state = "exhausted";
    emit("exhausted", model);
    throw new AgentTaskBudgetExhaustedError(snapshot());
  }

  /** Would the next call with `model` take the spend to >= 100%? */
  function wouldExceed(model, estimateInput) {
    const pricing = resolveModelPricing(model);
    const estOutput = lastCallOutputTokens || DEFAULT_PROJECTED_OUTPUT_TOKENS;
    const estCost = pricing
      ? (estimateInput * toNonNegative(pricing.input) + estOutput * toNonNegative(pricing.output)) / 1e6
      : 0;
    return fractionOf(spentUsd + estCost, spentTokens + estimateInput + estOutput) >= 1;
  }

  /** withLlmUsageObserver observer: totals the attempt's calls. Never throws. */
  function observe(record) {
    try {
      const inputTokens = toNonNegative(record?.inputTokens);
      const outputTokens = toNonNegative(record?.outputTokens);
      const cost = record?.costUsd === null || record?.costUsd === undefined ? 0 : toNonNegative(record.costUsd);
      spentUsd += cost;
      spentTokens += inputTokens + outputTokens;
      lastCallInputTokens = inputTokens;
      lastCallOutputTokens = outputTokens;
      const model = normalizeModelId(record?.model);
      if (model) lastModel = model;
      if (state === "ok" && fractionOf(spentUsd, spentTokens) >= AGENT_TASK_BUDGET_WARNING_FRACTION) {
        state = "warning";
        emit("warning", lastModel);
      }
    } catch {
      // Observers must never break the request path.
    }
  }

  /**
   * Guard for a call that cannot be degraded (no tool loop around it): throws AgentTaskBudgetExhaustedError, before
   * the call, when the task is exhausted or has already spent its budget. Otherwise returns and the call proceeds.
   */
  function guardCall({ model } = {}) {
    const requestedModel = normalizeModelId(model) || lastModel;
    if (state === "exhausted" || fractionOf(spentUsd, spentTokens) >= 1) exhaust(requestedModel);
  }

  /**
   * Decide the next model call: `{ model, trimContext }`, or throws AgentTaskBudgetExhaustedError (no call is made).
   * `estimateInputTokens` (optional) returns the approximate input tokens of the request about to be sent.
   */
  function beforeModelCall({ provider, model, estimateInputTokens } = {}) {
    const requestedModel = normalizeModelId(model);
    if (state === "exhausted") exhaust(requestedModel);

    let estimatedRequest = 0;
    if (typeof estimateInputTokens === "function") {
      try {
        estimatedRequest = toNonNegative(estimateInputTokens());
      } catch {
        estimatedRequest = 0;
      }
    }
    const estInput = Math.max(lastCallInputTokens, estimatedRequest);
    const alreadyOver = fractionOf(spentUsd, spentTokens) >= 1;

    if (degraded) {
      const chosen = economyModel || requestedModel;
      if (alreadyOver || wouldExceed(chosen, estInput)) exhaust(chosen);
      lastModel = chosen;
      return { model: chosen, trimContext: false };
    }

    if (!alreadyOver && !wouldExceed(requestedModel, estInput)) {
      lastModel = requestedModel;
      return { model: requestedModel, trimContext: false };
    }
    // Nothing can bring an attempt that is already over its budget back under it.
    if (alreadyOver) exhaust(requestedModel);

    // Degrade once: cheaper model of the same provider (if one is configured and cheaper) + trimmed context.
    economyModel = resolveEconomyModel(provider, requestedModel, economyModels);
    const chosen = economyModel || requestedModel;
    degraded = true;
    state = "degraded";
    emit("degraded", requestedModel, { fromModel: requestedModel, toModel: chosen });
    // The trimmed context is smaller, but the last call's input still bounds the projection (conservative).
    if (wouldExceed(chosen, estInput)) exhaust(chosen);
    lastModel = chosen;
    return { model: chosen, trimContext: true };
  }

  return {
    observe,
    beforeModelCall,
    guardCall,
    snapshot,
    getState: () => state,
  };
}
