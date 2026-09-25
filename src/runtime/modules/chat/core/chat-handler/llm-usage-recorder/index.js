// Per-turn LLM usage recorder (token-efficiency Stage 0).
//
// One recorder per chat/agent turn. Every call site calls record() exactly once per SUCCESSFUL API response, with
// that response's normalised usage (../../../../../../providers/usage). record() writes the llm_usage ledger row
// and adds the call to the turn total, so the run summary can report every call made so far even when a later
// step throws. A call that throws before returning a response is never recorded (no usage is available for it).

import { addLlmUsage, emptyLlmUsage, recordLlmUsageSafe } from "../../../../../../providers/usage/index.js";
import { estimateTokenCostUsd } from "../../../../../../providers/pricing/index.js";

/**
 * @param {{ userContextId?: string, conversationId?: string, provider?: string, tier?: string|null }} context
 *   provider is the active runtime's provider ("openai" | "claude" | "grok" | "gemini"); the ledger source/ref
 *   are derived from conversationId (agent-task-<id> -> agent-task, otherwise chat). tier is the turn's routing tier
 *   (Stage 6, model-routing): the default tier of every row; a call site with its own tier passes it to record().
 */
export function createLlmUsageRecorder({ userContextId = "", conversationId = "", provider = "", tier = null } = {}) {
  let total = emptyLlmUsage();
  let calls = 0;
  let totalCostUsd = 0;
  let costKnown = true;
  const models = new Set();
  let defaultTier = tier;
  return {
    /** Record one completed API call. Returns the call's normalised usage. Never throws. */
    record({ model, usage, provider: callProvider, tier: callTier } = {}) {
      const callUsage = addLlmUsage(usage);
      total = addLlmUsage(total, callUsage);
      calls += 1;
      const modelId = String(model || "").trim();
      if (modelId) models.add(modelId);
      const cost = modelId
        ? estimateTokenCostUsd(modelId, callUsage.inputTokens, callUsage.outputTokens, {
          cachedInputTokens: callUsage.cachedInputTokens,
          cacheWriteInputTokens: callUsage.cacheWriteInputTokens,
        })
        : null;
      if (cost === null || !Number.isFinite(Number(cost))) costKnown = false;
      else totalCostUsd += Number(cost);
      recordLlmUsageSafe({
        userContextId,
        conversationId,
        provider: callProvider || provider,
        model,
        usage: callUsage,
        tier: callTier || defaultTier,
      });
      return callUsage;
    },
    /**
     * Sum of the per-call cost estimates (each call priced at its own model), or null when any call's model is
     * unpriced. The turn estimate uses it when routing sent the calls of one turn to more than one model.
     */
    getTotalCostUsd() {
      return costKnown ? Number(totalCostUsd.toFixed(6)) : null;
    },
    /**
     * Set the default tier of the rows recorded from now on. The chat turn creates its recorder before the turn's
     * tier is known (the tier needs the prompt context and the offered tools; the recorder must exist first so the
     * error path can report calls made before a failure) and sets the tier once it is decided, before the first
     * model call. The tool loops record without a per-call tier, so their rows take this default.
     */
    setDefaultTier(nextTier) {
      defaultTier = nextTier || null;
    },
    /** Distinct model IDs recorded so far. */
    getModels() {
      return [...models];
    },
    /** Sum of every call recorded so far (normalised shape). */
    getTotal() {
      return { ...total };
    },
    getCallCount() {
      return calls;
    },
  };
}

/** Use the turn's recorder when the caller passed one; otherwise a local one so the call is still ledgered. */
export function resolveLlmUsageRecorder(usageRecorder, context) {
  return usageRecorder && typeof usageRecorder.record === "function"
    ? usageRecorder
    : createLlmUsageRecorder(context);
}
