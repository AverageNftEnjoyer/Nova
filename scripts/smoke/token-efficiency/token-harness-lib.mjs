/**
 * Shared pieces of the offline token baseline harness (token-baseline-harness.mjs):
 *
 * - a network guard (globalThis.fetch + http/https request/get) that fails loudly on any real network call and
 *   routes only the fake provider hosts below to in-process handlers;
 * - a fake OpenAI-compatible client (chat.completions.create, streaming and non-streaming) that captures every
 *   request payload;
 * - a fake Anthropic Messages endpoint (JSON and SSE) served through the fetch guard;
 * - request metrics: input size, tool-schema share and stable-prefix length versus the previous call.
 *
 * Serialization used for all measurements (documented in the harness output):
 *   OpenAI-compatible:  JSON(tools ?? []) + "\n" + JSON(messages)            (system lives in messages[0])
 *   Anthropic:          JSON(tools ?? []) + "\n" + JSON(system ?? "") + "\n" + JSON(messages)
 * This is the order the providers build their cacheable prefix in (tools, then system, then messages). The
 * stable prefix is the number of leading characters of that string identical to the previous call's string in
 * the same scenario and provider shape. ~tokens use the runtime's own estimator (ceil(chars / 3.5)).
 * `cache_control` markers are stripped before serializing: Anthropic does not require them to match for a cache hit
 * (a breakpoint may move forward between requests), so they are not part of the cacheable content.
 *
 * Simulated provider caches (so the harness can show cache reads without a live key):
 *   - OpenAI-compatible: automatic prefix caching. cached_tokens = the longest prefix of JSON(tools)+JSON(messages)
 *     shared with an earlier request in the same scenario, rounded down to 128-token steps, and only from 1,024
 *     tokens (OpenAI prompt-caching guide).
 *   - Anthropic: explicit breakpoints only. Content is split into blocks (each tool, each system block, each message
 *     content block); a breakpoint writes its prefix; a later breakpoint reads the longest earlier-written prefix
 *     found within 20 blocks back (platform.claude.com prompt-caching: 20-block lookback, max 4 breakpoints,
 *     1,024-token minimum for claude-sonnet-5). Reads and writes are reported as cache_read_input_tokens /
 *     cache_creation_input_tokens, and input_tokens is the rest, as the real API does.
 */
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

import { countApproxTokens } from "../../../src/runtime/core/context-prompt/index.js";

export const FAKE_CLAUDE_BASE_URL = "https://fake-anthropic.invalid";
export const FAKE_OPENAI_BASE_URL = "https://fake-openai.invalid/v1";

// ── Network guard ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Replace globalThis.fetch and http(s).request/get. `routes` maps a URL prefix to an async handler
 * (url, init) => Response. Anything else is recorded in `violations` and rejected.
 */
export function installNetworkGuard(routes = {}) {
  const violations = [];
  const originalFetch = globalThis.fetch;
  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };

  const guardedFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url || "");
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return handler(url, init);
    }
    violations.push({ kind: "fetch", url });
    throw new Error(`[token-harness] network blocked: fetch ${url}`);
  };
  const blocked = (kind) => (...args) => {
    const first = args[0];
    const url = typeof first === "string" ? first : first instanceof URL ? first.href : `${first?.hostname || first?.host || "?"}${first?.path || ""}`;
    violations.push({ kind, url });
    throw new Error(`[token-harness] network blocked: ${kind} ${url}`);
  };

  globalThis.fetch = guardedFetch;
  http.request = blocked("http.request");
  http.get = blocked("http.get");
  https.request = blocked("https.request");
  https.get = blocked("https.get");
  syncBuiltinESMExports();

  return {
    violations,
    fetch: guardedFetch,
    restore() {
      globalThis.fetch = originalFetch;
      http.request = originals.httpRequest;
      http.get = originals.httpGet;
      https.request = originals.httpsRequest;
      https.get = originals.httpsGet;
      syncBuiltinESMExports();
    },
  };
}

// ── Capture ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A capture sink. `current` is the scenario label every captured call is tagged with; set it before running a
 * scenario. Requests are deep-copied at capture time because the runtime mutates its message arrays afterwards.
 */
export function createCapture() {
  const calls = [];
  return {
    calls,
    cacheState: new Map(),
    /** Per-scenario simulated cache store (see the file header). */
    cacheFor(shape) {
      const key = `${this.current.scenario}::${shape}`;
      if (!this.cacheState.has(key)) this.cacheState.set(key, { openaiPrefixes: [], claudeEntries: new Map() });
      return this.cacheState.get(key);
    },
    current: { scenario: "", shape: "" },
    push(shape, request, meta = {}) {
      const copy = JSON.parse(JSON.stringify(request));
      calls.push({ scenario: this.current.scenario, shape, request: copy, ...meta });
      return copy;
    },
  };
}

function lastUserText(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content.find((part) => part?.type === "text");
      if (text) return String(text.text || "");
      return ""; // tool_result turn
    }
  }
  return "";
}

/**
 * Model behaviour shared by both fake providers. `responder(request, shape)` returns
 *   { text } or { toolCalls: [{ name, input }] }.
 */
export function describeRequest(request) {
  return {
    hasTools: Array.isArray(request?.tools) && request.tools.length > 0,
    lastUserText: lastUserText(request?.messages),
    messageCount: Array.isArray(request?.messages) ? request.messages.length : 0,
  };
}

// ── Fake OpenAI-compatible client ────────────────────────────────────────────────────────────────────────────

export function createFakeOpenAiClient({ capture, responder }) {
  let callNo = 0;
  return {
    chat: {
      completions: {
        create: async (request) => {
          const copy = capture.push("openai", request, { stream: request?.stream === true });
          callNo += 1;
          const answer = await responder(copy, "openai");
          const promptTokens = countApproxTokens(JSON.stringify(copy.messages || [])) + countApproxTokens(JSON.stringify(copy.tools || []));
          const cachedTokens = Math.min(promptTokens, simulateOpenAiCachedTokens(capture.cacheFor("openai"), copy));
          capture.calls[capture.calls.length - 1].simulatedCache = { readTokens: cachedTokens, writeTokens: 0, breakpoints: 0 };
          const toolCalls = (answer.toolCalls || []).map((call, index) => ({
            id: `call_${callNo}_${index + 1}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
          }));
          const text = String(answer.text || "");
          const usage = {
            prompt_tokens: promptTokens,
            completion_tokens: Math.max(1, countApproxTokens(text || JSON.stringify(toolCalls))),
            prompt_tokens_details: { cached_tokens: cachedTokens },
          };
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          if (request?.stream === true) {
            return (async function* stream() {
              if (text) {
                const mid = Math.ceil(text.length / 2);
                yield { choices: [{ index: 0, delta: { role: "assistant", content: text.slice(0, mid) } }] };
                yield { choices: [{ index: 0, delta: { content: text.slice(mid) } }] };
              }
              yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
              yield { choices: [], usage };
            })();
          }
          return {
            id: `chatcmpl-fake-${callNo}`,
            object: "chat.completion",
            model: String(copy.model || ""),
            choices: [{
              index: 0,
              finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
              message: { role: "assistant", content: toolCalls.length > 0 ? null : text, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) },
            }],
            usage,
          };
        },
      },
    },
  };
}

// ── Fake Anthropic Messages endpoint (served through the fetch guard) ────────────────────────────────────────

export function createFakeClaudeHandler({ capture, responder }) {
  let callNo = 0;
  return async (url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    const copy = capture.push("claude", body, { stream: body.stream === true });
    callNo += 1;
    const answer = await responder(copy, "claude");
    const text = String(answer.text || "");
    const toolUses = (answer.toolCalls || []).map((call, index) => ({
      type: "tool_use",
      id: `toolu_${callNo}_${index + 1}`,
      name: call.name,
      input: call.input || {},
    }));
    const content = [...(text ? [{ type: "text", text }] : []), ...toolUses];
    const inputTokens = countApproxTokens(JSON.stringify(copy.system || "")) + countApproxTokens(JSON.stringify(copy.messages || []))
      + countApproxTokens(JSON.stringify(copy.tools || []));
    const outputTokens = Math.max(1, countApproxTokens(text || JSON.stringify(toolUses)));
    const cache = simulateClaudeCache(capture.cacheFor("claude"), copy);
    capture.calls[capture.calls.length - 1].simulatedCache = cache;
    const usage = {
      input_tokens: Math.max(0, inputTokens - cache.readTokens - cache.writeTokens),
      cache_creation_input_tokens: cache.writeTokens,
      cache_read_input_tokens: cache.readTokens,
      output_tokens: outputTokens,
    };

    if (body.stream === true) {
      const events = [
        ["message_start", { type: "message_start", message: { id: `msg_fake_${callNo}`, type: "message", role: "assistant", content: [], model: body.model, usage: { ...usage, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } }],
        ["message_stop", { type: "message_stop" }],
      ];
      const sse = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
      const bytes = new TextEncoder().encode(sse);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(
      JSON.stringify({
        id: `msg_fake_${callNo}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
        usage,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

// ── Simulated provider caches (rules in the file header) ─────────────────────────────────────────────────────

const OPENAI_CACHE_MIN_TOKENS = 1024;
const OPENAI_CACHE_STEP_TOKENS = 128;
const CLAUDE_CACHE_MIN_TOKENS = 1024;
const CLAUDE_LOOKBACK_BLOCKS = 20;
const CLAUDE_MAX_BREAKPOINTS = 4;

/** Deep copy without `cache_control` keys. */
export function stripCacheControl(value) {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== "cache_control") out[key] = stripCacheControl(inner);
    }
    return out;
  }
  return value;
}

function simulateOpenAiCachedTokens(state, request) {
  const serialized = serializeRequest("openai", request);
  let best = 0;
  for (const earlier of state.openaiPrefixes) best = Math.max(best, commonPrefixLength(earlier, serialized));
  state.openaiPrefixes.push(serialized);
  const tokens = Math.floor(best / 3.5);
  if (tokens < OPENAI_CACHE_MIN_TOKENS) return 0;
  return Math.floor(tokens / OPENAI_CACHE_STEP_TOKENS) * OPENAI_CACHE_STEP_TOKENS;
}

/** Cacheable blocks in Anthropic prefix order: tools, system blocks, then each message's content blocks. */
export function claudeCacheBlocks(request) {
  const blocks = [];
  for (const tool of Array.isArray(request?.tools) ? request.tools : []) blocks.push(tool);
  const system = request?.system;
  if (typeof system === "string" && system) blocks.push({ type: "text", text: system });
  else if (Array.isArray(system)) blocks.push(...system);
  for (const message of Array.isArray(request?.messages) ? request.messages : []) {
    const content = typeof message?.content === "string" ? [{ type: "text", text: message.content }] : message?.content || [];
    for (const block of content) blocks.push({ role: message.role, ...block });
  }
  return blocks;
}

function simulateClaudeCache(state, request) {
  const blocks = claudeCacheBlocks(request);
  const prefixKeys = [];
  const prefixTokens = [];
  let running = "";
  for (const block of blocks) {
    running += `${JSON.stringify(stripCacheControl(block))}\n`;
    prefixKeys.push(running);
    prefixTokens.push(countApproxTokens(running));
  }
  const breakpoints = blocks
    .map((block, index) => (block && typeof block === "object" && block.cache_control ? index : -1))
    .filter((index) => index >= 0);
  if (breakpoints.length > CLAUDE_MAX_BREAKPOINTS) {
    throw new Error(`[token-harness] Anthropic request has ${breakpoints.length} cache breakpoints (max ${CLAUDE_MAX_BREAKPOINTS})`);
  }
  let readTokens = 0;
  for (const bp of breakpoints) {
    for (let pos = bp; pos >= 0 && pos > bp - CLAUDE_LOOKBACK_BLOCKS; pos -= 1) {
      if (state.claudeEntries.has(prefixKeys[pos])) {
        readTokens = Math.max(readTokens, prefixTokens[pos]);
        break;
      }
    }
  }
  let writeTokens = 0;
  const lastBreakpoint = breakpoints.length > 0 ? breakpoints[breakpoints.length - 1] : -1;
  if (lastBreakpoint >= 0 && prefixTokens[lastBreakpoint] >= CLAUDE_CACHE_MIN_TOKENS) {
    writeTokens = Math.max(0, prefixTokens[lastBreakpoint] - readTokens);
  }
  for (const bp of breakpoints) {
    if (prefixTokens[bp] >= CLAUDE_CACHE_MIN_TOKENS) state.claudeEntries.set(prefixKeys[bp], true);
  }
  return { readTokens, writeTokens, breakpoints: breakpoints.length };
}

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────────────────────

export function serializeRequest(shape, request) {
  const clean = stripCacheControl(request || {});
  const tools = JSON.stringify(Array.isArray(clean?.tools) ? clean.tools : []);
  const messages = JSON.stringify(Array.isArray(clean?.messages) ? clean.messages : []);
  if (shape === "claude") return `${tools}\n${JSON.stringify(clean?.system ?? "")}\n${messages}`;
  return `${tools}\n${messages}`;
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

export function systemText(shape, request) {
  if (shape === "claude") {
    if (typeof request?.system === "string") return request.system;
    if (Array.isArray(request?.system)) return request.system.map((block) => String(block?.text || "")).join("\n\n");
    return "";
  }
  const first = Array.isArray(request?.messages) ? request.messages.find((m) => m?.role === "system") : null;
  return first ? String(first.content || "") : "";
}

function classifyCall(call) {
  const request = call.request;
  if (Array.isArray(request?.tools) && request.tools.length > 0) return "tool-step";
  if (call.stream) return "stream";
  const last = Array.isArray(request?.messages) ? request.messages[request.messages.length - 1] : null;
  if (typeof last?.content === "string" && /^Provide the final answer to the user using the tool results above/.test(last.content)) {
    return "loop-recovery";
  }
  return "direct";
}

/** Metrics for every call of one scenario+shape, in call order. */
export function computeCallMetrics(calls) {
  let previous = "";
  return calls.map((call, index) => {
    const { shape, request } = call;
    const toolsJson = Array.isArray(request?.tools) && request.tools.length > 0 ? JSON.stringify(request.tools) : "";
    const inputJson = shape === "claude"
      ? `${JSON.stringify(request?.system ?? "")}${JSON.stringify(request?.messages || [])}`
      : JSON.stringify(request?.messages || []);
    const serialized = serializeRequest(shape, request);
    const totalChars = inputJson.length + toolsJson.length;
    const prefixChars = index === 0 ? 0 : commonPrefixLength(previous, serialized);
    previous = serialized;
    const system = systemText(shape, request);
    return {
      call: index + 1,
      kind: classifyCall(call),
      messages: Array.isArray(request?.messages) ? request.messages.length : 0,
      tools: Array.isArray(request?.tools) ? request.tools.length : 0,
      inputChars: inputJson.length,
      inputTokens: countApproxTokens(inputJson),
      systemChars: system.length,
      systemTokens: countApproxTokens(system),
      toolsChars: toolsJson.length,
      toolsTokens: countApproxTokens(toolsJson),
      totalChars,
      totalTokens: countApproxTokens(inputJson) + countApproxTokens(toolsJson),
      toolSharePct: totalChars > 0 ? Number(((toolsJson.length / totalChars) * 100).toFixed(1)) : 0,
      stablePrefixChars: prefixChars,
      stablePrefixTokens: Math.ceil(prefixChars / 3.5), // same formula as countApproxTokens
      serializedChars: serialized.length,
      stablePrefixPct: index === 0 || serialized.length === 0 ? 0 : Number(((prefixChars / serialized.length) * 100).toFixed(1)),
      simCachedTokens: Number(call.simulatedCache?.readTokens || 0),
      simCacheWriteTokens: Number(call.simulatedCache?.writeTokens || 0),
      cacheBreakpoints: Number(call.simulatedCache?.breakpoints || 0),
    };
  });
}

export function summarizeMetrics(metrics) {
  const sum = (key) => metrics.reduce((total, m) => total + m[key], 0);
  const later = metrics.slice(1);
  return {
    calls: metrics.length,
    totalInputTokens: sum("inputTokens"),
    totalToolsTokens: sum("toolsTokens"),
    totalTokens: sum("totalTokens"),
    avgStablePrefixTokens: later.length ? Math.round(later.reduce((t, m) => t + m.stablePrefixTokens, 0) / later.length) : 0,
    minStablePrefixTokens: later.length ? Math.min(...later.map((m) => m.stablePrefixTokens)) : 0,
    simCachedTokens: sum("simCachedTokens"),
    simCacheWriteTokens: sum("simCacheWriteTokens"),
    simCacheHitCallsAfterFirst: later.filter((m) => m.simCachedTokens > 0).length,
  };
}

// ── Table output ─────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNS = [
  ["call", "#", 3],
  ["kind", "kind", 13],
  ["messages", "msgs", 4],
  ["tools", "tools", 5],
  ["inputChars", "in chars", 9],
  ["inputTokens", "in ~tok", 8],
  ["systemTokens", "sys ~tok", 8],
  ["toolsTokens", "tools ~tok", 10],
  ["totalTokens", "total ~tok", 10],
  ["toolSharePct", "tools %", 7],
  ["stablePrefixChars", "prefix chars", 12],
  ["stablePrefixTokens", "prefix ~tok", 11],
  ["stablePrefixPct", "prefix %", 8],
  ["simCachedTokens", "sim cached", 10],
  ["simCacheWriteTokens", "sim write", 9],
];

export function formatMetricsTable(title, metrics) {
  const header = COLUMNS.map(([, label, width]) => label.padStart(width)).join(" ");
  const lines = [title, header, "-".repeat(header.length)];
  for (const m of metrics) {
    lines.push(COLUMNS.map(([key, , width]) => String(m[key]).padStart(width)).join(" "));
  }
  const s = summarizeMetrics(metrics);
  lines.push(
    `  calls=${s.calls}  sum in ~tok=${s.totalInputTokens}  sum tools ~tok=${s.totalToolsTokens}  sum total ~tok=${s.totalTokens}`
    + `  stable prefix ~tok (calls 2+): avg=${s.avgStablePrefixTokens} min=${s.minStablePrefixTokens}`
    + `  sim cache: read=${s.simCachedTokens} write=${s.simCacheWriteTokens} hits(calls 2+)=${s.simCacheHitCallsAfterFirst}/${Math.max(0, s.calls - 1)}`,
  );
  return lines.join("\n");
}
