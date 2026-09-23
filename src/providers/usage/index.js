// LLM usage normalisation + per-call ledger (token-efficiency Stage 0).
//
// Every LLM call site passes the provider's raw `usage` object through one of the normalisers below and then
// calls recordLlmUsageSafe() once per API call. The normalised shape is the same for every provider:
//
//   { inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens }
//
// `inputTokens` is ALWAYS the total input for the call, including cached and cache-write tokens:
//   - OpenAI-compatible (OpenAI, Gemini, Grok): prompt_tokens already includes cached tokens;
//     prompt_tokens_details.cached_tokens is the cached subset. There is no cache-write count.
//   - Anthropic: input_tokens excludes cache reads and cache writes, so
//     total = input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
// Uncached input = inputTokens - cachedInputTokens - cacheWriteInputTokens (calculated, never stored).
//
// Legacy callers read promptTokens/completionTokens; toLegacyUsageFields() keeps them equal to
// inputTokens/outputTokens so nothing downstream changes meaning for providers without caching.

import { AsyncLocalStorage } from "node:async_hooks";

import { insertLlmUsage, maybePruneLlmUsage } from "../../db/llm-usage.js";
import { estimateTokenCostUsd } from "../pricing/index.js";

export const LLM_USAGE_SOURCES = Object.freeze(["chat", "agent-task", "mission"]);
const AGENT_TASK_CONVERSATION_PREFIX = "agent-task-";

function toCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function emptyLlmUsage() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 };
}

/** OpenAI Chat Completions usage (also Gemini / xAI OpenAI-compatible endpoints). */
export function normalizeOpenAiCompatibleUsage(raw) {
  const usage = raw && typeof raw === "object" ? raw : {};
  const inputTokens = toCount(usage.prompt_tokens);
  const cached = toCount(usage.prompt_tokens_details?.cached_tokens);
  return {
    inputTokens,
    outputTokens: toCount(usage.completion_tokens),
    // cached_tokens is a subset of prompt_tokens; clamp so a malformed payload can't produce negative uncached input.
    cachedInputTokens: Math.min(cached, inputTokens),
    cacheWriteInputTokens: 0,
  };
}

/** Anthropic Messages usage (non-streaming response, or the merged stream usage from mergeAnthropicStreamUsage). */
export function normalizeAnthropicUsage(raw) {
  const usage = raw && typeof raw === "object" ? raw : {};
  const uncached = toCount(usage.input_tokens);
  const cacheRead = toCount(usage.cache_read_input_tokens);
  const cacheWrite = toCount(usage.cache_creation_input_tokens);
  return {
    inputTokens: uncached + cacheRead + cacheWrite,
    outputTokens: toCount(usage.output_tokens),
    cachedInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
  };
}

const ANTHROPIC_USAGE_FIELDS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

/**
 * Streaming: fold the raw `usage` of a `message_start` (payload.message.usage) or `message_delta` (payload.usage)
 * event into an accumulator of raw Anthropic fields. message_delta counts are cumulative, so a field present in a
 * later event replaces the earlier value; a field absent from it keeps the earlier value.
 * Pass the result to normalizeAnthropicUsage() once the stream ends.
 */
export function mergeAnthropicStreamUsage(accumulator, rawUsage) {
  const merged = { ...(accumulator && typeof accumulator === "object" ? accumulator : {}) };
  if (!rawUsage || typeof rawUsage !== "object") return merged;
  for (const field of ANTHROPIC_USAGE_FIELDS) {
    if (rawUsage[field] === undefined || rawUsage[field] === null) continue;
    const value = Number(rawUsage[field]);
    if (Number.isFinite(value)) merged[field] = value;
  }
  return merged;
}

/** Provider name as used by the runtime ("openai" | "claude" | "grok" | "gemini"). Only "claude" differs. */
export function normalizeLlmUsage(provider, raw) {
  return String(provider || "").trim().toLowerCase() === "claude"
    ? normalizeAnthropicUsage(raw)
    : normalizeOpenAiCompatibleUsage(raw);
}

/** Sum any number of normalised usages (missing / partial objects count as zero). */
export function addLlmUsage(...usages) {
  const total = emptyLlmUsage();
  for (const usage of usages) {
    if (!usage || typeof usage !== "object") continue;
    total.inputTokens += toCount(usage.inputTokens);
    total.outputTokens += toCount(usage.outputTokens);
    total.cachedInputTokens += toCount(usage.cachedInputTokens);
    total.cacheWriteInputTokens += toCount(usage.cacheWriteInputTokens);
  }
  return total;
}

/** Backward-compatible fields for existing consumers (promptTokens == total input). */
export function toLegacyUsageFields(usage) {
  return { promptTokens: toCount(usage?.inputTokens), completionTokens: toCount(usage?.outputTokens) };
}

/**
 * Ledger source + ref for a runtime call. Agent tasks run through handleInput with conversationId
 * `agent-task-<taskId>`; everything else that goes through the chat runtime is "chat".
 */
export function resolveLlmUsageSource({ source, refId, conversationId } = {}) {
  const explicit = String(source || "").trim();
  if (LLM_USAGE_SOURCES.includes(explicit)) return { source: explicit, refId: String(refId || conversationId || "").trim() };
  const conversation = String(conversationId || "").trim();
  if (conversation.startsWith(AGENT_TASK_CONVERSATION_PREFIX)) {
    return { source: "agent-task", refId: conversation.slice(AGENT_TASK_CONVERSATION_PREFIX.length) };
  }
  return { source: "chat", refId: String(refId || conversation).trim() };
}

// Observers let a caller (e.g. the agent-task service) see every call recorded inside one async scope, so it can
// total an attempt's usage even when the run throws. They are notified even if the ledger write fails.
const observerStorage = new AsyncLocalStorage();

/** Run `fn` with `observer(record)` notified for every recordLlmUsageSafe() call made inside it (nested scopes stack). */
export function withLlmUsageObserver(observer, fn) {
  const parent = observerStorage.getStore() || [];
  const next = typeof observer === "function" ? [...parent, observer] : parent;
  return observerStorage.run(next, fn);
}

/**
 * Record one LLM API call. NEVER throws into the request path: bad input, an unavailable database or a failing
 * observer is swallowed. Returns the ledger row id, or null when nothing was written.
 * `usage` must already be normalised (see normalizers above).
 */
export function recordLlmUsageSafe(input) {
  let record = null;
  try {
    // A default parameter only replaces undefined; null or a non-object must not throw either.
    const { userContextId, source, refId, conversationId, provider, model, usage, ts } =
      input && typeof input === "object" ? input : {};
    const normalized = addLlmUsage(usage);
    const resolved = resolveLlmUsageSource({ source, refId, conversationId });
    const cost = estimateTokenCostUsd(String(model || ""), normalized.inputTokens, normalized.outputTokens, {
      cachedInputTokens: normalized.cachedInputTokens,
      cacheWriteInputTokens: normalized.cacheWriteInputTokens,
    });
    record = {
      userId: String(userContextId || "").trim(),
      ts: ts || new Date().toISOString(),
      source: resolved.source,
      refId: resolved.refId,
      provider: String(provider || "").trim().toLowerCase(),
      model: String(model || "").trim(),
      ...normalized,
      costUsd: Number.isFinite(Number(cost)) && cost !== null ? Number(cost) : null,
    };
  } catch {
    return null;
  }

  for (const observer of observerStorage.getStore() || []) {
    try {
      observer(record);
    } catch {
      // An observer must never break the request path.
    }
  }

  if (!record.userId) return null;
  try {
    const id = insertLlmUsage(record);
    try {
      maybePruneLlmUsage();
    } catch {
      // Retention is best-effort; the next write retries.
    }
    return id;
  } catch {
    return null;
  }
}
