// Per-turn LLM usage recorder (token-efficiency Stage 0).
//
// One recorder per chat/agent turn. Every call site calls record() exactly once per SUCCESSFUL API response, with
// that response's normalised usage (../../../../../../providers/usage). record() writes the llm_usage ledger row
// and adds the call to the turn total, so the run summary can report every call made so far even when a later
// step throws. A call that throws before returning a response is never recorded (no usage is available for it).

import { addLlmUsage, emptyLlmUsage, recordLlmUsageSafe } from "../../../../../../providers/usage/index.js";

/**
 * @param {{ userContextId?: string, conversationId?: string, provider?: string }} context
 *   provider is the active runtime's provider ("openai" | "claude" | "grok" | "gemini"); the ledger source/ref
 *   are derived from conversationId (agent-task-<id> -> agent-task, otherwise chat).
 */
export function createLlmUsageRecorder({ userContextId = "", conversationId = "", provider = "" } = {}) {
  let total = emptyLlmUsage();
  let calls = 0;
  return {
    /** Record one completed API call. Returns the call's normalised usage. Never throws. */
    record({ model, usage, provider: callProvider } = {}) {
      const callUsage = addLlmUsage(usage);
      total = addLlmUsage(total, callUsage);
      calls += 1;
      recordLlmUsageSafe({
        userContextId,
        conversationId,
        provider: callProvider || provider,
        model,
        usage: callUsage,
      });
      return callUsage;
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
