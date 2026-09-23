/**
 * Token-efficiency Stage 0: provider usage normalisation (src/providers/usage).
 *
 * Feeds recorded-shape `usage` payloads from all four providers through the shared helper and asserts the
 * normalised shape { inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens } where inputTokens is
 * ALWAYS the total input (cached + cache-write included). Payload shapes follow each provider's documented
 * response format (OpenAI Chat Completions, Gemini OpenAI-compat, xAI Chat Completions, Anthropic Messages and
 * its SSE events). No network, no API keys.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";

import {
  addLlmUsage,
  emptyLlmUsage,
  mergeAnthropicStreamUsage,
  normalizeAnthropicUsage,
  normalizeLlmUsage,
  normalizeOpenAiCompatibleUsage,
  resolveLlmUsageSource,
  toLegacyUsageFields,
} from "../../../src/providers/usage/index.js";

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

// ── Recorded provider payloads ──────────────────────────────────────────────────────────────────────────────

// OpenAI Chat Completions (non-streaming, or the final include_usage chunk of a stream).
const OPENAI_USAGE = {
  prompt_tokens: 2006,
  completion_tokens: 300,
  total_tokens: 2306,
  prompt_tokens_details: { cached_tokens: 1920, audio_tokens: 0 },
  completion_tokens_details: {
    reasoning_tokens: 0,
    audio_tokens: 0,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  },
};

// Gemini via the OpenAI-compatible endpoint: implicit-cache hits add prompt_tokens_details, misses omit it.
const GEMINI_USAGE_NO_DETAILS = { prompt_tokens: 1520, completion_tokens: 88, total_tokens: 1608 };
const GEMINI_USAGE_WITH_CACHE = {
  prompt_tokens: 4210,
  completion_tokens: 140,
  total_tokens: 4350,
  prompt_tokens_details: { cached_tokens: 3072 },
};

// xAI (Grok) Chat Completions.
const GROK_USAGE = {
  prompt_tokens: 199,
  completion_tokens: 1,
  total_tokens: 200,
  prompt_tokens_details: { text_tokens: 199, audio_tokens: 0, image_tokens: 0, cached_tokens: 163 },
  completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
  num_sources_used: 0,
};

// Anthropic Messages, non-streaming. input_tokens EXCLUDES cache reads and cache writes.
const ANTHROPIC_USAGE = {
  input_tokens: 50,
  cache_creation_input_tokens: 1200,
  cache_read_input_tokens: 3000,
  output_tokens: 420,
  service_tier: "standard",
};

// Anthropic streaming: message_start carries input + cache fields and a small output count.
const ANTHROPIC_MESSAGE_START = {
  type: "message_start",
  message: {
    id: "msg_smoke",
    type: "message",
    role: "assistant",
    content: [],
    model: "claude-sonnet-5",
    stop_reason: null,
    usage: { input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 2900, output_tokens: 1 },
  },
};
// message_delta carrying only the (cumulative) output count.
const ANTHROPIC_MESSAGE_DELTA_OUTPUT_ONLY = {
  type: "message_delta",
  delta: { stop_reason: "end_turn", stop_sequence: null },
  usage: { output_tokens: 350 },
};
// message_delta carrying cumulative input/cache fields too (e.g. after server tool use).
const ANTHROPIC_MESSAGE_DELTA_CUMULATIVE = {
  type: "message_delta",
  delta: { stop_reason: "end_turn", stop_sequence: null },
  usage: { input_tokens: 40, cache_creation_input_tokens: 512, cache_read_input_tokens: 2900, output_tokens: 355 },
};
// message_start with no usage object at all.
const ANTHROPIC_MESSAGE_START_NO_USAGE = {
  type: "message_start",
  message: { id: "msg_smoke_2", type: "message", role: "assistant", content: [], model: "claude-sonnet-5" },
};

// ── Tests ────────────────────────────────────────────────────────────────────────────────────────────────────

await run("TU-N1 OpenAI usage: prompt_tokens is total input, cached_tokens is the cached subset", async () => {
  assert.deepEqual(normalizeOpenAiCompatibleUsage(OPENAI_USAGE), {
    inputTokens: 2006,
    outputTokens: 300,
    cachedInputTokens: 1920,
    cacheWriteInputTokens: 0,
  });
  assert.deepEqual(normalizeLlmUsage("openai", OPENAI_USAGE), normalizeOpenAiCompatibleUsage(OPENAI_USAGE));
});

await run("TU-N2 Gemini OpenAI-compat usage with and without prompt_tokens_details", async () => {
  assert.deepEqual(normalizeLlmUsage("gemini", GEMINI_USAGE_NO_DETAILS), {
    inputTokens: 1520,
    outputTokens: 88,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
  });
  assert.deepEqual(normalizeLlmUsage("gemini", GEMINI_USAGE_WITH_CACHE), {
    inputTokens: 4210,
    outputTokens: 140,
    cachedInputTokens: 3072,
    cacheWriteInputTokens: 0,
  });
});

await run("TU-N3 xAI/Grok usage with cached_tokens (extra detail fields ignored)", async () => {
  assert.deepEqual(normalizeLlmUsage("grok", GROK_USAGE), {
    inputTokens: 199,
    outputTokens: 1,
    cachedInputTokens: 163,
    cacheWriteInputTokens: 0,
  });
});

await run("TU-N4 Anthropic non-streaming: total input = input + cache_read + cache_creation", async () => {
  const expected = { inputTokens: 4250, outputTokens: 420, cachedInputTokens: 3000, cacheWriteInputTokens: 1200 };
  assert.deepEqual(normalizeAnthropicUsage(ANTHROPIC_USAGE), expected);
  assert.deepEqual(normalizeLlmUsage("claude", ANTHROPIC_USAGE), expected);
  assert.deepEqual(normalizeLlmUsage(" Claude ", ANTHROPIC_USAGE), expected, "provider name is trimmed/case-insensitive");
});

await run("TU-N5 Anthropic stream: message_start + output-only message_delta", async () => {
  let acc = mergeAnthropicStreamUsage({}, ANTHROPIC_MESSAGE_START.message.usage);
  acc = mergeAnthropicStreamUsage(acc, ANTHROPIC_MESSAGE_DELTA_OUTPUT_ONLY.usage);
  assert.deepEqual(normalizeAnthropicUsage(acc), {
    inputTokens: 2925,
    outputTokens: 350,
    cachedInputTokens: 2900,
    cacheWriteInputTokens: 0,
  });
});

await run("TU-N6 Anthropic stream: cumulative message_delta input/cache fields replace message_start values", async () => {
  let acc = mergeAnthropicStreamUsage({}, ANTHROPIC_MESSAGE_START.message.usage);
  acc = mergeAnthropicStreamUsage(acc, ANTHROPIC_MESSAGE_DELTA_CUMULATIVE.usage);
  assert.deepEqual(normalizeAnthropicUsage(acc), {
    inputTokens: 40 + 2900 + 512,
    outputTokens: 355,
    cachedInputTokens: 2900,
    cacheWriteInputTokens: 512,
  });
});

await run("TU-N7 Anthropic stream: message_start without usage, then output-only delta", async () => {
  let acc = mergeAnthropicStreamUsage(undefined, ANTHROPIC_MESSAGE_START_NO_USAGE.message.usage);
  assert.deepEqual(acc, {});
  acc = mergeAnthropicStreamUsage(acc, { output_tokens: 12 });
  assert.deepEqual(normalizeAnthropicUsage(acc), { inputTokens: 0, outputTokens: 12, cachedInputTokens: 0, cacheWriteInputTokens: 0 });
  // Accumulator is not mutated in place.
  const frozen = Object.freeze({ output_tokens: 3 });
  assert.deepEqual(mergeAnthropicStreamUsage(frozen, { output_tokens: 9 }), { output_tokens: 9 });
});

await run("TU-N8 malformed payloads normalise to zeros; cached is clamped to total input", async () => {
  assert.deepEqual(normalizeOpenAiCompatibleUsage(null), emptyLlmUsage());
  assert.deepEqual(normalizeAnthropicUsage("nope"), emptyLlmUsage());
  assert.deepEqual(normalizeLlmUsage("openai", { prompt_tokens: -5, completion_tokens: "x" }), emptyLlmUsage());
  assert.equal(
    normalizeOpenAiCompatibleUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 150 } }).cachedInputTokens,
    100,
  );
});

await run("TU-N9 toLegacyUsageFields keeps promptTokens == total input", async () => {
  assert.deepEqual(toLegacyUsageFields(normalizeAnthropicUsage(ANTHROPIC_USAGE)), { promptTokens: 4250, completionTokens: 420 });
  assert.deepEqual(toLegacyUsageFields(normalizeLlmUsage("grok", GROK_USAGE)), { promptTokens: 199, completionTokens: 1 });
  assert.deepEqual(toLegacyUsageFields(null), { promptTokens: 0, completionTokens: 0 });
});

await run("TU-N10 addLlmUsage sums every field and ignores missing/partial entries", async () => {
  const total = addLlmUsage(
    normalizeLlmUsage("openai", OPENAI_USAGE),
    normalizeLlmUsage("claude", ANTHROPIC_USAGE),
    null,
    { outputTokens: 5 },
    undefined,
  );
  assert.deepEqual(total, {
    inputTokens: 2006 + 4250,
    outputTokens: 300 + 420 + 5,
    cachedInputTokens: 1920 + 3000,
    cacheWriteInputTokens: 1200,
  });
  assert.deepEqual(addLlmUsage(), emptyLlmUsage());
});

await run("TU-N11 resolveLlmUsageSource: explicit source, agent-task conversation prefix, chat default", async () => {
  assert.deepEqual(resolveLlmUsageSource({ source: "mission", refId: "run-1" }), { source: "mission", refId: "run-1" });
  assert.deepEqual(resolveLlmUsageSource({ conversationId: "agent-task-abc123" }), { source: "agent-task", refId: "abc123" });
  assert.deepEqual(resolveLlmUsageSource({ conversationId: "conv-1" }), { source: "chat", refId: "conv-1" });
  assert.deepEqual(resolveLlmUsageSource({ source: "bogus", conversationId: "agent-task-x" }), { source: "agent-task", refId: "x" });
  assert.deepEqual(resolveLlmUsageSource({ source: "agent-task", conversationId: "agent-task-t9" }), {
    source: "agent-task",
    refId: "agent-task-t9",
  });
  assert.deepEqual(resolveLlmUsageSource(), { source: "chat", refId: "" });
});

for (const result of results) summarize(result);
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nusage-normalize: ${results.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
