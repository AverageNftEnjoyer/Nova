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
 * Both fakes also take an optional `usageFor(request, shape)` returning { inputTokens, outputTokens } (or null):
 * the usage the fake reports for that call. Without it, usage is estimated from the request size.
 */
export function describeRequest(request) {
  return {
    hasTools: Array.isArray(request?.tools) && request.tools.length > 0,
    lastUserText: lastUserText(request?.messages),
    messageCount: Array.isArray(request?.messages) ? request.messages.length : 0,
  };
}

// ── Fake OpenAI-compatible client ────────────────────────────────────────────────────────────────────────────

export function createFakeOpenAiClient({ capture, responder, usageFor }) {
  let callNo = 0;
  return {
    chat: {
      completions: {
        create: async (request) => {
          const copy = capture.push("openai", request, { stream: request?.stream === true });
          callNo += 1;
          const answer = await responder(copy, "openai");
          const promptTokens = countApproxTokens(JSON.stringify(copy.messages || [])) + countApproxTokens(JSON.stringify(copy.tools || []));
          const toolCalls = (answer.toolCalls || []).map((call, index) => ({
            id: `call_${callNo}_${index + 1}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
          }));
          const text = String(answer.text || "");
          const forced = typeof usageFor === "function" ? usageFor(copy, "openai") : null;
          const usage = {
            prompt_tokens: forced ? forced.inputTokens : promptTokens,
            completion_tokens: forced ? forced.outputTokens : Math.max(1, countApproxTokens(text || JSON.stringify(toolCalls))),
            prompt_tokens_details: { cached_tokens: 0 },
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

export function createFakeClaudeHandler({ capture, responder, usageFor }) {
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
    const forced = typeof usageFor === "function" ? usageFor(copy, "claude") : null;
    const inputTokens = forced
      ? forced.inputTokens
      : countApproxTokens(JSON.stringify(copy.system || "")) + countApproxTokens(JSON.stringify(copy.messages || []))
        + countApproxTokens(JSON.stringify(copy.tools || []));
    const outputTokens = forced ? forced.outputTokens : Math.max(1, countApproxTokens(text || JSON.stringify(toolUses)));
    const usage = { input_tokens: inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: outputTokens };

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

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────────────────────

export function serializeRequest(shape, request) {
  const tools = JSON.stringify(Array.isArray(request?.tools) ? request.tools : []);
  const messages = JSON.stringify(Array.isArray(request?.messages) ? request.messages : []);
  if (shape === "claude") return `${tools}\n${JSON.stringify(request?.system ?? "")}\n${messages}`;
  return `${tools}\n${messages}`;
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

function systemText(shape, request) {
  if (shape === "claude") return typeof request?.system === "string" ? request.system : JSON.stringify(request?.system ?? "");
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

/**
 * Chars of tool output inside one request: OpenAI-shape `role: "tool"` messages, Claude-shape `tool_result`
 * blocks. Only the result text is counted (no JSON wrapper), so it tracks what the tools returned.
 */
function toolResultChars(shape, request) {
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  const textOf = (content) => (typeof content === "string"
    ? content.length
    : Array.isArray(content) ? content.reduce((n, part) => n + String(part?.text ?? "").length, 0) : 0);
  let chars = 0;
  for (const message of messages) {
    if (shape !== "claude") {
      if (message?.role === "tool") chars += textOf(message.content);
      continue;
    }
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type === "tool_result") chars += textOf(block.content);
    }
  }
  return chars;
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
    const resultChars = toolResultChars(shape, request);
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
      toolResultChars: resultChars,
      toolResultTokens: Math.ceil(resultChars / 3.5), // same formula as countApproxTokens
      stablePrefixChars: prefixChars,
      stablePrefixTokens: Math.ceil(prefixChars / 3.5), // same formula as countApproxTokens
      serializedChars: serialized.length,
      stablePrefixPct: index === 0 || serialized.length === 0 ? 0 : Number(((prefixChars / serialized.length) * 100).toFixed(1)),
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
    totalToolResultTokens: sum("toolResultTokens"),
    avgStablePrefixTokens: later.length ? Math.round(later.reduce((t, m) => t + m.stablePrefixTokens, 0) / later.length) : 0,
    minStablePrefixTokens: later.length ? Math.min(...later.map((m) => m.stablePrefixTokens)) : 0,
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
  ["toolResultTokens", "tool res ~tok", 13],
  ["stablePrefixChars", "prefix chars", 12],
  ["stablePrefixTokens", "prefix ~tok", 11],
  ["stablePrefixPct", "prefix %", 8],
];

export function formatMetricsTable(title, metrics) {
  const header = COLUMNS.map(([, label, width]) => label.padStart(width)).join(" ");
  const lines = [title, header, "-".repeat(header.length)];
  for (const m of metrics) {
    lines.push(COLUMNS.map(([key, , width]) => String(m[key]).padStart(width)).join(" "));
  }
  const s = summarizeMetrics(metrics);
  lines.push(
    `  calls=${s.calls}  sum in ~tok=${s.totalInputTokens}  sum tools ~tok=${s.totalToolsTokens}  sum total ~tok=${s.totalTokens}  sum tool res ~tok=${s.totalToolResultTokens}`
    + `  stable prefix ~tok (calls 2+): avg=${s.avgStablePrefixTokens} min=${s.minStablePrefixTokens}`,
  );
  return lines.join("\n");
}
