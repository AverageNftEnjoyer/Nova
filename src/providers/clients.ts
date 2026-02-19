import { toClaudeBase } from "./runtime.js";

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAiChoice {
  message?: {
    content?: unknown;
    tool_calls?: unknown[];
  };
  delta?: {
    content?: unknown;
  };
  finish_reason?: string | null;
}

export interface OpenAiChatCompletion {
  id?: string;
  choices?: OpenAiChoice[];
  usage?: OpenAiUsage;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "request"): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeOpenAiBase(baseURL: string): string {
  const trimmed = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://api.openai.com/v1";
  if (trimmed.endsWith("/v1") || trimmed.includes("/v1beta/openai")) return trimmed;
  return `${trimmed}/v1`;
}

function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractSseDataLines(rawEvent: string): string {
  return rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
}

export function extractOpenAiChatText(completion: OpenAiChatCompletion): string {
  const raw = completion?.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: string; text?: unknown };
      return p.type === "text" ? String(p.text || "") : "";
    })
    .join("\n")
    .trim();
}

export function extractOpenAiStreamDelta(chunk: OpenAiChatCompletion): string {
  const delta = chunk?.choices?.[0]?.delta?.content;
  if (typeof delta === "string") return delta;
  if (!Array.isArray(delta)) return "";
  return delta
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { text?: unknown };
      return typeof p.text === "string" ? p.text : "";
    })
    .join("");
}

export async function openAiLikeChatCompletion(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: OpenAiChatMessage[];
  maxCompletionTokens?: number;
  timeoutMs?: number;
}): Promise<OpenAiChatCompletion> {
  const endpoint = `${normalizeOpenAiBase(params.baseURL)}/chat/completions`;
  const requestBody: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (Number.isFinite(params.maxCompletionTokens) && (params.maxCompletionTokens || 0) > 0) {
    requestBody.max_completion_tokens = Number(params.maxCompletionTokens);
  }

  const request = (async () => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
    const text = await res.text();
    const parsed = parseJsonSafe<OpenAiChatCompletion & { error?: { message?: string } }>(text);
    if (!res.ok) {
      const message = parsed?.error?.message || text || `OpenAI-compatible request failed (${res.status})`;
      throw new Error(message);
    }
    return parsed || {};
  })();

  if (params.timeoutMs && params.timeoutMs > 0) {
    return withTimeout(request, params.timeoutMs, "OpenAI-compatible chat completion");
  }
  return request;
}

export async function streamOpenAiLikeChatCompletion(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: OpenAiChatMessage[];
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}): Promise<{ reply: string; promptTokens: number; completionTokens: number; sawDelta: boolean }> {
  const endpoint = `${normalizeOpenAiBase(params.baseURL)}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(params.timeoutMs) && (params.timeoutMs || 0) > 0 ? Number(params.timeoutMs) : 45000;
  const timer = setTimeout(() => controller.abort(new Error(`OpenAI-compatible stream timed out after ${timeoutMs}ms`)), timeoutMs);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `OpenAI-compatible stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let sawDelta = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!rawEvent.trim()) continue;

        const dataRaw = extractSseDataLines(rawEvent);
        if (!dataRaw || dataRaw === "[DONE]") continue;

        const payload = parseJsonSafe<OpenAiChatCompletion>(dataRaw);
        if (!payload) continue;

        const delta = extractOpenAiStreamDelta(payload);
        if (delta.length > 0) {
          sawDelta = true;
          reply += delta;
          params.onDelta(delta);
        }

        const usage = payload.usage;
        if (usage) {
          promptTokens = Number(usage.prompt_tokens || promptTokens);
          completionTokens = Number(usage.completion_tokens || completionTokens);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return { reply, promptTokens, completionTokens, sawDelta };
}

function normalizeClaudeMessages(messages: Array<{ role?: string; content?: unknown }> | undefined, userText: string): Array<{ role: "user" | "assistant"; content: string }> {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((msg) => {
        const role: "user" | "assistant" = msg?.role === "assistant" ? "assistant" : "user";
        const content = String(msg?.content || "").trim();
        if (!content) return null;
        return { role, content };
      })
      .filter((item): item is { role: "user" | "assistant"; content: string } => Boolean(item));
  }
  return [{ role: "user", content: String(userText || "") }];
}

export async function claudeMessagesCreate(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  system: string;
  userText: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const requestMessages = normalizeClaudeMessages(params.messages, params.userText);
  const endpoint = `${toClaudeBase(params.baseURL)}/v1/messages`;

  const request = (async () => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: Number.isFinite(params.maxTokens) && (params.maxTokens || 0) > 0 ? Number(params.maxTokens) : 1200,
        system: params.system,
        messages: requestMessages,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(data?.error?.message || `Claude request failed (${res.status})`);
    }
    const text = Array.isArray(data.content)
      ? data.content.filter((item) => item?.type === "text").map((item) => String(item?.text || "")).join("\n").trim()
      : "";
    return {
      text,
      usage: {
        promptTokens: Number(data?.usage?.input_tokens || 0),
        completionTokens: Number(data?.usage?.output_tokens || 0),
      },
    };
  })();

  if (params.timeoutMs && params.timeoutMs > 0) {
    return withTimeout(request, params.timeoutMs, "Claude messages create");
  }
  return request;
}

export async function claudeMessagesStream(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  system: string;
  userText: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  maxTokens?: number;
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } }> {
  const requestMessages = normalizeClaudeMessages(params.messages, params.userText);
  const endpoint = `${toClaudeBase(params.baseURL)}/v1/messages`;
  const timeoutMs = Number.isFinite(params.timeoutMs) && (params.timeoutMs || 0) > 0 ? Number(params.timeoutMs) : 45000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Claude stream timed out after ${timeoutMs}ms`)), timeoutMs);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: Number.isFinite(params.maxTokens) && (params.maxTokens || 0) > 0 ? Number(params.maxTokens) : 1200,
      stream: true,
      system: params.system,
      messages: requestMessages,
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data?.error?.message || `Claude stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) break;
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!rawEvent.trim()) continue;

        const lines = rawEvent.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const eventName = eventLine ? eventLine.slice(6).trim() : "";
        const dataRaw = extractSseDataLines(rawEvent);
        if (!dataRaw || dataRaw === "[DONE]") continue;

        const payload = parseJsonSafe<{
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { input_tokens?: number; output_tokens?: number };
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        }>(dataRaw);
        if (!payload) continue;

        if (eventName === "message_start") {
          promptTokens = Number(payload.message?.usage?.input_tokens || promptTokens);
          completionTokens = Number(payload.message?.usage?.output_tokens || completionTokens);
          continue;
        }
        if (eventName === "content_block_delta") {
          const delta = payload.delta?.type === "text_delta" ? String(payload.delta?.text || "") : "";
          if (delta) {
            text += delta;
            params.onDelta(delta);
          }
          continue;
        }
        if (eventName === "message_delta") {
          promptTokens = Number(payload.usage?.input_tokens || promptTokens);
          completionTokens = Number(payload.usage?.output_tokens || completionTokens);
          continue;
        }
        if (eventName === "error") {
          throw new Error(payload.error?.message || "Claude stream error.");
        }
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return {
    text,
    usage: { promptTokens, completionTokens },
  };
}
