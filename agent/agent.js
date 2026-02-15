// ===== imports (ESM) =====
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { execSync, exec, spawn } from "child_process";
import { createDecipheriv, createHash } from "crypto";
import OpenAI from "openai";
import { FishAudioClient } from "fish-audio";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import {
  buildSystemPrompt,
  countTokens,
  extractFacts
} from "./memory.js";
import { startMetricsBroadcast, getSystemMetrics } from "./metrics.js";

// ===== __dirname fix =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== load shared .env from project root =====
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const INTEGRATIONS_CONFIG_PATH = path.join(__dirname, "..", "hud", "data", "integrations-config.json");
const ENCRYPTION_KEY_PATH = path.join(__dirname, "..", "hud", "data", ".nova_encryption_key");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_GROK_MODEL = "grok-4-0709";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const OPENAI_FALLBACK_MODEL = String(process.env.NOVA_OPENAI_FALLBACK_MODEL || "").trim();
const OPENAI_MODEL_PRICING_USD_PER_1M = {
  "gpt-5.2": { input: 1.75, output: 14.0 },
  "gpt-5.2-pro": { input: 12.0, output: 96.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.6, output: 2.4 }
};
const CLAUDE_MODEL_PRICING_USD_PER_1M = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 }
};

const openAiClientCache = new Map();
const OPENAI_REQUEST_TIMEOUT_MS = 45000;
const MIC_RECORD_SECONDS = Number.parseFloat(process.env.NOVA_MIC_RECORD_SECONDS || "4");
const MIC_RETRY_SECONDS = Number.parseFloat(process.env.NOVA_MIC_RETRY_SECONDS || "2");
const MIC_IDLE_DELAY_MS = Number.parseInt(process.env.NOVA_MIC_IDLE_DELAY_MS || "250", 10);
const VOICE_WAKE_COOLDOWN_MS = Number.parseInt(process.env.NOVA_WAKE_COOLDOWN_MS || "1800", 10);
const VOICE_POST_RESPONSE_GRACE_MS = Number.parseInt(process.env.NOVA_POST_RESPONSE_GRACE_MS || "900", 10);
const VOICE_DUPLICATE_TEXT_COOLDOWN_MS = Number.parseInt(process.env.NOVA_DUPLICATE_TEXT_COOLDOWN_MS || "12000", 10);
const VOICE_DUPLICATE_COMMAND_COOLDOWN_MS = Number.parseInt(process.env.NOVA_DUPLICATE_COMMAND_COOLDOWN_MS || "120000", 10);
const VOICE_AFTER_WAKE_SUPPRESS_MS = Number.parseInt(process.env.NOVA_AFTER_WAKE_SUPPRESS_MS || "2500", 10);
const VOICE_AFTER_TTS_SUPPRESS_MS = Number.parseInt(process.env.NOVA_AFTER_TTS_SUPPRESS_MS || "7000", 10);
const WAKE_WORD = String(process.env.NOVA_WAKE_WORD || "nova").toLowerCase();
const WAKE_WORD_VARIANTS = (process.env.NOVA_WAKE_WORD_VARIANTS || "nova")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function getEncryptionKeyMaterial() {
  const raw = String(process.env.NOVA_ENCRYPTION_KEY || "").trim();
  if (raw) {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === 32) return decoded;
    } catch {}
    return createHash("sha256").update(raw).digest();
  }

  try {
    if (fs.existsSync(ENCRYPTION_KEY_PATH)) {
      const fileRaw = fs.readFileSync(ENCRYPTION_KEY_PATH, "utf8").trim();
      const decoded = Buffer.from(fileRaw, "base64");
      if (decoded.length === 32) return decoded;
    }
  } catch {}

  return null;
}

function decryptStoredSecret(payload) {
  const input = String(payload || "").trim();
  if (!input) return "";
  const parts = input.split(".");
  if (parts.length !== 3) return "";
  try {
    const key = getEncryptionKeyMaterial();
    if (!key) return "";
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const enc = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return "";
  }
}

function unwrapStoredSecret(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const decrypted = decryptStoredSecret(raw);
  if (decrypted) return decrypted;

  const parts = raw.split(".");
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0], "base64");
      const tag = Buffer.from(parts[1], "base64");
      const enc = Buffer.from(parts[2], "base64");
      if (iv.length === 12 && tag.length === 16 && enc.length > 0) return "";
    } catch {}
  }
  return raw;
}

function toOpenAiLikeBase(baseUrl, fallbackBaseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return fallbackBaseUrl;
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function withTimeout(promise, ms, label = "request") {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function extractOpenAIChatText(completion) {
  const raw = completion?.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((part) => (part && typeof part === "object" && part.type === "text" ? String(part.text || "") : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function extractOpenAIStreamDelta(chunk) {
  const delta = chunk?.choices?.[0]?.delta?.content;
  if (typeof delta === "string") return delta;
  if (Array.isArray(delta)) {
    return delta
      .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

async function streamOpenAiChatCompletion({ client, model, messages, timeoutMs, onDelta }) {
  let timer = null;
  const controller = new AbortController();
  timer = setTimeout(() => controller.abort(new Error(`OpenAI model ${model} timed out after ${timeoutMs}ms`)), timeoutMs);

  let stream = null;
  try {
    stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true }
      },
      { signal: controller.signal }
    );
  } catch (err) {
    stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true
      },
      { signal: controller.signal }
    );
  }

  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let sawDelta = false;

  try {
    for await (const chunk of stream) {
      const delta = extractOpenAIStreamDelta(chunk);
      if (delta.length > 0) {
        sawDelta = true;
        reply += delta;
        onDelta(delta);
      }

      const usage = chunk?.usage;
      if (usage) {
        promptTokens = Number(usage.prompt_tokens || promptTokens);
        completionTokens = Number(usage.completion_tokens || completionTokens);
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { reply, promptTokens, completionTokens, sawDelta };
}

function toErrorDetails(err) {
  if (!err || typeof err !== "object") {
    return { message: String(err || "Unknown error"), status: null, code: null, type: null, requestId: null };
  }
  const anyErr = err;
  return {
    message: typeof anyErr.message === "string" ? anyErr.message : "Unknown error",
    status: typeof anyErr.status === "number" ? anyErr.status : null,
    code: typeof anyErr.code === "string" ? anyErr.code : null,
    type: typeof anyErr.type === "string" ? anyErr.type : null,
    param: typeof anyErr.param === "string" ? anyErr.param : null,
    requestId:
      typeof anyErr.request_id === "string"
        ? anyErr.request_id
        : typeof anyErr.requestId === "string"
          ? anyErr.requestId
          : null
  };
}

function normalizeWakeText(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const dp = Array.from({ length: s.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= t.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[s.length][t.length];
}

function containsWakeWord(input) {
  const normalized = normalizeWakeText(input);
  if (!normalized) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  const filler = new Set(["hey", "hi", "hello", "yo", "ok", "okay", "please"]);
  let i = 0;
  while (i < tokens.length && filler.has(tokens[i])) i += 1;
  return i < tokens.length && isWakeToken(tokens[i]);
}

function isWakeToken(token) {
  if (!token) return false;
  if (token === WAKE_WORD) return true;
  if (WAKE_WORD_VARIANTS.includes(token)) return true;
  return false;
}

function stripWakePrompt(input) {
  const normalized = normalizeWakeText(input);
  if (!normalized) return "";
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) return "";

  const filler = new Set(["hey", "hi", "hello", "yo", "ok", "okay", "please"]);
  let i = 0;
  while (i < tokens.length && filler.has(tokens[i])) i += 1;
  while (i < tokens.length && isWakeToken(tokens[i])) i += 1;
  while (i < tokens.length && filler.has(tokens[i])) i += 1;

  return tokens.slice(i).join(" ").trim();
}

function loadOpenAIIntegrationRuntime() {
  try {
    const raw = fs.readFileSync(INTEGRATIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const integration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const apiKey = unwrapStoredSecret(integration.apiKey);
    const baseURL = toOpenAiLikeBase(
      typeof integration.baseUrl === "string" ? integration.baseUrl : "",
      DEFAULT_OPENAI_BASE_URL
    );
    const model = typeof integration.defaultModel === "string" && integration.defaultModel.trim()
      ? integration.defaultModel.trim()
      : DEFAULT_CHAT_MODEL;

    return { apiKey, baseURL, model };
  } catch {
    return { apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL };
  }
}

function loadIntegrationsRuntime() {
  try {
    const raw = fs.readFileSync(INTEGRATIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const openaiIntegration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const claudeIntegration = parsed?.claude && typeof parsed.claude === "object" ? parsed.claude : {};
    const grokIntegration = parsed?.grok && typeof parsed.grok === "object" ? parsed.grok : {};
    const geminiIntegration = parsed?.gemini && typeof parsed.gemini === "object" ? parsed.gemini : {};
    const activeProvider = parsed?.activeLlmProvider === "claude"
      ? "claude"
      : parsed?.activeLlmProvider === "grok"
        ? "grok"
        : parsed?.activeLlmProvider === "gemini"
          ? "gemini"
        : "openai";
    return {
      activeProvider,
      openai: {
        connected: Boolean(openaiIntegration.connected),
        apiKey: unwrapStoredSecret(openaiIntegration.apiKey),
        baseURL: toOpenAiLikeBase(openaiIntegration.baseUrl, DEFAULT_OPENAI_BASE_URL),
        model: typeof openaiIntegration.defaultModel === "string" && openaiIntegration.defaultModel.trim()
          ? openaiIntegration.defaultModel.trim()
          : DEFAULT_CHAT_MODEL
      },
      claude: {
        connected: Boolean(claudeIntegration.connected),
        apiKey: unwrapStoredSecret(claudeIntegration.apiKey),
        baseURL: typeof claudeIntegration.baseUrl === "string" && claudeIntegration.baseUrl.trim()
          ? claudeIntegration.baseUrl.trim().replace(/\/+$/, "")
          : DEFAULT_CLAUDE_BASE_URL,
        model: typeof claudeIntegration.defaultModel === "string" && claudeIntegration.defaultModel.trim()
          ? claudeIntegration.defaultModel.trim()
          : DEFAULT_CLAUDE_MODEL
      },
      grok: {
        connected: Boolean(grokIntegration.connected),
        apiKey: unwrapStoredSecret(grokIntegration.apiKey),
        baseURL: toOpenAiLikeBase(grokIntegration.baseUrl, DEFAULT_GROK_BASE_URL),
        model: typeof grokIntegration.defaultModel === "string" && grokIntegration.defaultModel.trim()
          ? grokIntegration.defaultModel.trim()
          : DEFAULT_GROK_MODEL
      },
      gemini: {
        connected: Boolean(geminiIntegration.connected),
        apiKey: unwrapStoredSecret(geminiIntegration.apiKey),
        baseURL: toOpenAiLikeBase(geminiIntegration.baseUrl, DEFAULT_GEMINI_BASE_URL),
        model: typeof geminiIntegration.defaultModel === "string" && geminiIntegration.defaultModel.trim()
          ? geminiIntegration.defaultModel.trim()
          : DEFAULT_GEMINI_MODEL
      }
    };
  } catch {
    return {
      activeProvider: "openai",
      openai: { connected: false, apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL },
      claude: { connected: false, apiKey: "", baseURL: DEFAULT_CLAUDE_BASE_URL, model: DEFAULT_CLAUDE_MODEL },
      grok: { connected: false, apiKey: "", baseURL: DEFAULT_GROK_BASE_URL, model: DEFAULT_GROK_MODEL },
      gemini: { connected: false, apiKey: "", baseURL: DEFAULT_GEMINI_BASE_URL, model: DEFAULT_GEMINI_MODEL }
    };
  }
}

function getActiveChatRuntime(integrations) {
  if (integrations.activeProvider === "claude") {
    return {
      provider: "claude",
      apiKey: integrations.claude.apiKey,
      baseURL: integrations.claude.baseURL,
      model: integrations.claude.model
    };
  }
  if (integrations.activeProvider === "grok") {
    return {
      provider: "grok",
      apiKey: integrations.grok.apiKey,
      baseURL: integrations.grok.baseURL,
      model: integrations.grok.model
    };
  }
  if (integrations.activeProvider === "gemini") {
    return {
      provider: "gemini",
      apiKey: integrations.gemini.apiKey,
      baseURL: integrations.gemini.baseURL,
      model: integrations.gemini.model
    };
  }
  return {
    provider: "openai",
    apiKey: integrations.openai.apiKey,
    baseURL: integrations.openai.baseURL,
    model: integrations.openai.model
  };
}

function toClaudeBase(baseURL) {
  const trimmed = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_CLAUDE_BASE_URL;
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

async function claudeMessagesCreate({ apiKey, baseURL, model, system, userText, maxTokens = 300, temperature = 0.75 }) {
  const endpoint = `${toClaudeBase(baseURL)}/v1/messages`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: userText }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Claude request failed (${res.status})`;
    throw new Error(message);
  }
  const text = Array.isArray(data?.content)
    ? data.content.filter((c) => c?.type === "text").map((c) => c?.text || "").join("\n").trim()
    : "";
  return {
    text,
    usage: {
      promptTokens: Number(data?.usage?.input_tokens || 0),
      completionTokens: Number(data?.usage?.output_tokens || 0)
    }
  };
}

async function claudeMessagesStream({
  apiKey,
  baseURL,
  model,
  system,
  userText,
  maxTokens = 300,
  temperature = 0.75,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  onDelta
}) {
  const endpoint = `${toClaudeBase(baseURL)}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Claude model ${model} timed out after ${timeoutMs}ms`)), timeoutMs);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      system,
      messages: [{ role: "user", content: userText }]
    }),
    signal: controller.signal
  });

  if (!res.ok) {
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    const message = data?.error?.message || `Claude request failed (${res.status})`;
    throw new Error(message);
  }

  if (!res.body) {
    clearTimeout(timer);
    throw new Error("Claude stream returned no body.");
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
        const dataRaw = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!dataRaw || dataRaw === "[DONE]") continue;

        let payload = null;
        try {
          payload = JSON.parse(dataRaw);
        } catch {
          payload = null;
        }
        if (!payload) continue;

        if (eventName === "message_start") {
          promptTokens = Number(payload?.message?.usage?.input_tokens || promptTokens);
          completionTokens = Number(payload?.message?.usage?.output_tokens || completionTokens);
          continue;
        }

        if (eventName === "content_block_delta") {
          const delta = payload?.delta?.type === "text_delta" ? String(payload?.delta?.text || "") : "";
          if (delta.length > 0) {
            text += delta;
            onDelta(delta);
          }
          continue;
        }

        if (eventName === "message_delta") {
          promptTokens = Number(payload?.usage?.input_tokens || promptTokens);
          completionTokens = Number(payload?.usage?.output_tokens || completionTokens);
          continue;
        }

        if (eventName === "error") {
          const msg = payload?.error?.message || "Claude stream error.";
          throw new Error(msg);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {}
  }

  return {
    text,
    usage: {
      promptTokens,
      completionTokens
    }
  };
}

function getOpenAIClient(runtime) {
  const key = `${runtime.baseURL}|${runtime.apiKey}`;
  if (openAiClientCache.has(key)) return openAiClientCache.get(key);
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseURL });
  openAiClientCache.set(key, client);
  return client;
}

function resolveModelPricing(model) {
  const exact = OPENAI_MODEL_PRICING_USD_PER_1M[model] || CLAUDE_MODEL_PRICING_USD_PER_1M[model];
  if (exact) return exact;
  const normalized = String(model || "").trim().toLowerCase();
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 };
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 };
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 };
  return null;
}

function estimateTokenCostUsd(model, promptTokens = 0, completionTokens = 0) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}

const fishAudio = new FishAudioClient({
  apiKey: process.env.FISH_API_KEY
});

// ===== reference voices (from .env) =====
const REFERENCE_ID = process.env.REFERENCE_ID;
const PETER_ID = process.env.PETER_ID;
const MORD_ID = process.env.MORD_ID;
const ULTRON_ID = process.env.ULTRON_ID;

// Map voice IDs to Fish Audio reference IDs
const VOICE_MAP = {
  default: REFERENCE_ID,
  peter: PETER_ID,
  mord: MORD_ID,
  ultron: ULTRON_ID,
};

// Current voice preference (updated when HUD sends ttsVoice)
let currentVoice = "default";
// Whether TTS is enabled (updated when HUD sends voiceEnabled setting)
let voiceEnabled = true;
// Whether Nova is muted (stops listening entirely when true)
let muted = false;

// ===== paths =====
const ROOT = __dirname;
const MPV = path.join(ROOT, "mpv", "mpv.exe");
const MIC = path.join(ROOT, "mic.wav");
const THINK_SOUND = path.join(ROOT, "thinking.mp3");

// ===== WebSocket HUD server =====
const wss = new WebSocketServer({ port: 8765 });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

function broadcastState(state) {
  broadcast({ type: "state", state, ts: Date.now() });
}

function broadcastMessage(role, content, source = "hud") {
  broadcast({ type: "message", role, content, source, ts: Date.now() });
}

function createAssistantStreamId() {
  return `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function broadcastAssistantStreamStart(id, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_start", id, source, sender, ts: Date.now() });
}

function broadcastAssistantStreamDelta(id, content, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_delta", id, content, source, sender, ts: Date.now() });
}

function broadcastAssistantStreamDone(id, source = "hud", sender = undefined) {
  broadcast({ type: "assistant_stream_done", id, source, sender, ts: Date.now() });
}

function shouldBuildWorkflowFromPrompt(text) {
  const n = String(text || "").toLowerCase();
  const asksBuild = /(build|create|setup|set up|make|generate|deploy)/.test(n);
  const workflowScope = /(workflow|mission|automation|pipeline|schedule|daily report|notification)/.test(n);
  return asksBuild && workflowScope;
}

function shouldDraftOnlyWorkflow(text) {
  const n = String(text || "").toLowerCase();
  return /(draft|preview|don't deploy|do not deploy|just show|show me first)/.test(n);
}

// ===== handle incoming HUD messages =====
wss.on("connection", (ws) => {
  // Always push one snapshot to new clients so boot UI doesn't miss one-shot telemetry.
  void getSystemMetrics()
    .then((metrics) => {
      if (!metrics || ws.readyState !== 1) return;
      ws.send(JSON.stringify({
        type: "system_metrics",
        metrics,
        ts: Date.now(),
      }));
    })
    .catch(() => {});

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "interrupt") {
        console.log("[HUD] Interrupt received.");
        stopSpeaking();
        return;
      }

      if (data.type === "request_system_metrics") {
        const metrics = await getSystemMetrics();
        if (metrics && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "system_metrics",
            metrics,
            ts: Date.now(),
          }));
        }
        return;
      }

      if (data.type === "greeting") {
        console.log("[HUD] Greeting requested. voiceEnabled:", data.voiceEnabled);
        // Update voice preference if provided
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] Preference updated to:", currentVoice);
        }
        // Respect disabled voice mode: do not emit startup greeting messages.
        if (data.voiceEnabled === false || voiceEnabled === false) {
          return;
        }
        if (!busy) {
          busy = true;
          try {
            const greetingText = data.text || "Hello! What are we working on today?";
            broadcastState("speaking");
            await speak(greetingText, currentVoice);
            broadcastState("idle");
          } finally {
            busy = false;
          }
        }
        return;
      }

      if (data.type === "hud_message" && data.content) {
        // Update stored voice preference if provided
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] Preference updated to:", currentVoice);
        }
        console.log("[HUD →]", data.content, "| voice:", data.voice, "| ttsVoice:", data.ttsVoice);
        stopSpeaking();
        busy = true;
        try {
          await handleInput(data.content, { voice: data.voice !== false, ttsVoice: data.ttsVoice || currentVoice });
        } finally {
          busy = false;
        }
      }

      // Allow HUD to update voice preferences without sending a message
      if (data.type === "set_voice") {
        if (data.ttsVoice && VOICE_MAP[data.ttsVoice]) {
          currentVoice = data.ttsVoice;
          console.log("[Voice] TTS voice set to:", currentVoice);
        }
        if (typeof data.voiceEnabled === "boolean") {
          voiceEnabled = data.voiceEnabled;
          console.log("[Voice] Voice responses enabled:", voiceEnabled);
        }
      }

      // Mute/unmute - stops listening entirely
      if (data.type === "set_mute") {
        muted = data.muted === true;
        console.log("[Nova] Muted:", muted);
        if (!muted) {
          suppressVoiceWakeUntilMs = Date.now() + Math.max(0, VOICE_AFTER_TTS_SUPPRESS_MS);
          broadcast({ type: "transcript", text: "", ts: Date.now() });
        }
        broadcastState(muted ? "muted" : "idle");
      }
    } catch (e) {
      console.error("[WS] Bad message from HUD:", e.message);
    }
  });
});

// ===== mic =====
function recordMic(seconds = 3) {
  execSync(
    `sox -t waveaudio -d "${MIC}" trim 0 ${seconds}`,
    { stdio: "ignore" }
  );
}

// ===== STT =====
async function transcribe() {
  const runtime = loadOpenAIIntegrationRuntime();
  const openai = getOpenAIClient(runtime);
  const r = await openai.audio.transcriptions.create({
    file: fs.createReadStream(MIC),
    model: "gpt-4o-transcribe",
    temperature: 0,
    prompt: "The wake word is Nova. Prioritize correctly transcribing 'Nova' if spoken."
  });
  return r.text;
}

// ===== speech control =====
let currentPlayer = null;
let busy = false; // prevents main loop from overriding HUD-driven states
let suppressVoiceWakeUntilMs = 0;

function stopSpeaking() {
  if (currentPlayer) {
    currentPlayer.kill("SIGKILL");
    currentPlayer = null;
    broadcastState("idle");
  }
}

// ===== TTS (long-form safe) =====
async function speak(text, voiceId = "default") {
  const out = path.join(ROOT, `speech_${Date.now()}.mp3`);
  const referenceId = VOICE_MAP[voiceId] || REFERENCE_ID;
  console.log(`[TTS] Using voice: ${voiceId} → ${referenceId}`);

  const audio = await fishAudio.textToSpeech.convert({
    text,
    reference_id: referenceId
  });

  fs.writeFileSync(out, Buffer.from(await new Response(audio).arrayBuffer()));

  broadcastState("speaking");

  currentPlayer = spawn(MPV, [
    out,
    "--no-video",
    "--really-quiet",
    "--keep-open=no"
  ]);

  await new Promise(resolve => {
    currentPlayer.on("exit", resolve);
  });

  currentPlayer = null;
  broadcastState("idle");
  suppressVoiceWakeUntilMs = Date.now() + Math.max(0, VOICE_AFTER_TTS_SUPPRESS_MS);

  try { fs.unlinkSync(out); } catch {}
}

// ===== thinking sound (chat only) =====
function playThinking() {
  if (!fs.existsSync(THINK_SOUND)) return;
  spawn(MPV, [THINK_SOUND, "--no-video", "--really-quiet", "--keep-open=no"]);
}

// ===== token enforcement =====
const MAX_PROMPT_TOKENS = 600; // identity(300) + working(200) + buffer

function enforceTokenBound(systemPrompt, userMessage) {
  const systemTokens = countTokens(systemPrompt);
  const userTokens = countTokens(userMessage);
  const total = systemTokens + userTokens;

  if (total > MAX_PROMPT_TOKENS) {
    console.warn(`[Token] Prompt exceeds ${MAX_PROMPT_TOKENS} tokens (${total}). Truncating.`);
  }

  return { systemTokens, userTokens, total };
}

// ===== command ACKs =====
const COMMAND_ACKS = [
  "On it.",
  "Right away.",
  "Working on that now."
];

// ===== input handler =====
async function handleInput(text, opts = {}) {
  const integrationsRuntime = loadIntegrationsRuntime();
  const openaiRuntime = integrationsRuntime.openai;
  const activeChatRuntime = getActiveChatRuntime(integrationsRuntime);
  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude" ? "Claude" : activeChatRuntime.provider === "grok" ? "Grok" : activeChatRuntime.provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`Missing ${providerName} API key. Configure Integrations first.`);
  }
  const openai = openaiRuntime.apiKey ? getOpenAIClient(openaiRuntime) : null;
  const activeOpenAiCompatibleClient = activeChatRuntime.provider === "claude"
    ? null
    : getOpenAIClient({ apiKey: activeChatRuntime.apiKey, baseURL: activeChatRuntime.baseURL });
  const selectedChatModel = activeChatRuntime.model
    || (activeChatRuntime.provider === "claude"
      ? DEFAULT_CLAUDE_MODEL
      : activeChatRuntime.provider === "grok"
        ? DEFAULT_GROK_MODEL
        : activeChatRuntime.provider === "gemini"
          ? DEFAULT_GEMINI_MODEL
        : DEFAULT_CHAT_MODEL);

  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const source = opts.source || "hud";
  const n = text.toLowerCase().trim();

  // ===== ABSOLUTE SHUTDOWN =====
  if (
    n === "nova shutdown" ||
    n === "nova shut down" ||
    n === "shutdown nova"
  ) {
    stopSpeaking();
    await speak(
      "Shutting down now. If you need me again, just restart the system.",
      ttsVoice
    );
    process.exit(0);
  }

  // ===== SPOTIFY =====
  if (n.includes("spotify") || n.includes("play music") || n.includes("play some") || n.includes("put on ")) {
    stopSpeaking();

    // Ask GPT to extract the Spotify intent
    const spotifySystemPrompt = `You parse Spotify commands. Given user input, respond with ONLY a JSON object:
{
  "action": "open" | "play" | "pause" | "next" | "previous",
  "query": "search query if playing something, otherwise empty string",
  "type": "track" | "artist" | "playlist" | "album" | "genre",
  "response": "short friendly acknowledgment to say to the user"
}
Examples:
- "open spotify" → { "action": "open", "query": "", "type": "track", "response": "Opening Spotify." }
- "play some jazz" → { "action": "play", "query": "jazz", "type": "genre", "response": "Putting on some jazz for you." }
- "play my liked songs on spotify" → { "action": "play", "query": "liked songs", "type": "playlist", "response": "Playing your liked songs." }
- "play Drake" → { "action": "play", "query": "Drake", "type": "artist", "response": "Playing Drake." }
- "play Bohemian Rhapsody" → { "action": "play", "query": "Bohemian Rhapsody", "type": "track", "response": "Playing Bohemian Rhapsody." }
- "play my chill playlist" → { "action": "play", "query": "chill", "type": "playlist", "response": "Playing your chill playlist." }
- "next song" → { "action": "next", "query": "", "type": "track", "response": "Skipping to the next track." }
- "pause the music" → { "action": "pause", "query": "", "type": "track", "response": "Pausing the music." }
Output ONLY valid JSON, nothing else.`
    let spotifyRaw = "";
    if (activeChatRuntime.provider === "claude") {
      const claudeResponse = await claudeMessagesCreate({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: spotifySystemPrompt,
        userText: text,
        maxTokens: 220,
        temperature: 0
      });
      spotifyRaw = claudeResponse.text;
    } else {
      const spotifyParse = await withTimeout(activeOpenAiCompatibleClient.chat.completions.create({
        model: selectedChatModel,
        messages: [
          { role: "system", content: spotifySystemPrompt },
          { role: "user", content: text }
        ]
      }), OPENAI_REQUEST_TIMEOUT_MS, "OpenAI Spotify parse");
      spotifyRaw = extractOpenAIChatText(spotifyParse);
    }

    try {
      const intent = JSON.parse(spotifyRaw);

      if (useVoice) await speak(intent.response, ttsVoice);
      else broadcastMessage("assistant", intent.response, source);

      if (intent.action === "open") {
        exec("start spotify:");
      } else if (intent.action === "pause") {
        // Simulate media key press for pause
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"');
      } else if (intent.action === "next") {
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB0)"');
      } else if (intent.action === "previous") {
        exec('powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB1)"');
      } else if (intent.action === "play" && intent.query) {
        // Use Spotify URI search to play content
        const encoded = encodeURIComponent(intent.query);
        if (intent.type === "artist") {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        } else if (intent.type === "playlist") {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        } else {
          exec(`start "spotify" "spotify:search:${encoded}" && timeout /t 2 >nul && powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]0xB3)"`);
        }
      } else {
        exec("start spotify:");
      }
    } catch (e) {
      console.error("[Spotify] Parse error:", e.message);
      const ack = COMMAND_ACKS[Math.floor(Math.random() * COMMAND_ACKS.length)];
      if (useVoice) await speak(ack, ttsVoice);
      else broadcastMessage("assistant", ack, source);
      exec("start spotify:");
    }

    broadcastState("idle");
    return;
  }

  // ===== WORKFLOW BUILDER =====
  if (shouldBuildWorkflowFromPrompt(text)) {
    stopSpeaking();
    broadcastState("thinking");
    broadcastMessage("user", text, source);
    try {
      const deploy = !shouldDraftOnlyWorkflow(text);
      const res = await fetch("http://localhost:3000/api/missions/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          deploy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Workflow build failed (${res.status}).`);
      }

      const label = data?.workflow?.label || "Generated Workflow";
      const provider = data?.provider || "LLM";
      const model = data?.model || "default model";
      const stepCount = Array.isArray(data?.workflow?.summary?.workflowSteps) ? data.workflow.summary.workflowSteps.length : 0;
      const scheduleTime = data?.workflow?.summary?.schedule?.time || "09:00";
      const scheduleTimezone = data?.workflow?.summary?.schedule?.timezone || "America/New_York";

      const reply = data?.deployed
        ? `Built and deployed "${label}" with ${stepCount} workflow steps. It is scheduled for ${scheduleTime} ${scheduleTimezone}. Generated using ${provider} ${model}.`
        : `Built a workflow draft "${label}" with ${stepCount} steps. It's ready for review and not deployed yet. Generated using ${provider} ${model}.`;

      broadcastMessage("assistant", reply, source);
      if (useVoice) {
        await speak(reply, ttsVoice);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Workflow build failed.";
      const reply = `I couldn't build that workflow yet: ${msg}`;
      broadcastMessage("assistant", reply, source);
      if (useVoice) {
        await speak(reply, ttsVoice);
      }
    } finally {
      broadcastState("idle");
    }
    return;
  }

  // ===== CHAT =====
  // One request = one prompt build (no session accumulation)
  broadcastState("thinking");
  broadcastMessage("user", text, source);
  if (useVoice) playThinking();

  // Build fresh system prompt with selective memory injection
  const { prompt: systemPrompt, tokenBreakdown } = buildSystemPrompt({
    includeIdentity: true,
    includeWorkingContext: true
  });

  // Enforce token bounds before model call
  const tokenInfo = enforceTokenBound(systemPrompt, text);
  console.log(`[Memory] Tokens - identity: ${tokenBreakdown.identity}, context: ${tokenBreakdown.working_context}, user: ${tokenInfo.userTokens}`);

  // Build ephemeral messages array (no RAM accumulation)
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text }
  ];
  const assistantStreamId = createAssistantStreamId();
  broadcastAssistantStreamStart(assistantStreamId, source);

  let reply = "";
  try {
    let promptTokens = 0;
    let completionTokens = 0;
    let modelUsed = selectedChatModel;
    if (activeChatRuntime.provider === "claude") {
      const claudeCompletion = await claudeMessagesStream({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: systemPrompt,
        userText: text,
        maxTokens: 250,
        temperature: 0.75,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
        onDelta: (delta) => {
          broadcastAssistantStreamDelta(assistantStreamId, delta, source);
        }
      });
      reply = claudeCompletion.text;
      promptTokens = claudeCompletion.usage.promptTokens;
      completionTokens = claudeCompletion.usage.completionTokens;
    } else {
      let streamed = null;
      let sawPrimaryDelta = false;
      try {
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: modelUsed,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            sawPrimaryDelta = true;
            broadcastAssistantStreamDelta(assistantStreamId, delta, source);
          }
        });
      } catch (primaryError) {
        if (!OPENAI_FALLBACK_MODEL || sawPrimaryDelta) {
          throw primaryError;
        }
        const fallbackModel = OPENAI_FALLBACK_MODEL;
        const primaryDetails = toErrorDetails(primaryError);
        console.warn(
          `[LLM] Primary model failed provider=${activeChatRuntime.provider} model=${modelUsed}` +
          ` status=${primaryDetails.status ?? "n/a"} code=${primaryDetails.code ?? "n/a"} type=${primaryDetails.type ?? "n/a"} request_id=${primaryDetails.requestId ?? "n/a"}` +
          ` message=${primaryDetails.message}. Retrying with configured fallback ${fallbackModel}.`
        );
        streamed = await streamOpenAiChatCompletion({
          client: activeOpenAiCompatibleClient,
          model: fallbackModel,
          messages,
          timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
          onDelta: (delta) => {
            broadcastAssistantStreamDelta(assistantStreamId, delta, source);
          }
        });
        modelUsed = fallbackModel;
      }

      reply = streamed.reply;
      if (!reply || !reply.trim()) {
        throw new Error(`Model ${modelUsed} returned no text response.`);
      }
      promptTokens = streamed.promptTokens || 0;
      completionTokens = streamed.completionTokens || 0;
    }

    const modelForUsage = activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel);
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);
    console.log(
      `[LLM] provider=${activeChatRuntime.provider} model=${modelForUsage} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} total_tokens=${totalTokens}` +
      `${estimatedCostUsd !== null ? ` estimated_usd=$${estimatedCostUsd}` : ""}`
    );
    broadcast({
      type: "usage",
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      ts: Date.now()
    });

    if (useVoice) {
      await speak(reply, ttsVoice);
    }

    // Extract facts in the background (don't block) - saves to disk, not RAM
    if (openai) {
      extractFacts(openai, text, reply).catch(() => {});
    }
  } catch (err) {
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    console.error(
      `[LLM] Chat request failed provider=${activeChatRuntime.provider} model=${selectedChatModel}` +
      ` status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} type=${details.type ?? "n/a"} param=${details.param ?? "n/a"} request_id=${details.requestId ?? "n/a"}` +
      ` message=${msg}`
    );
    broadcastAssistantStreamDelta(
      assistantStreamId,
      `Model request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
      source
    );
  } finally {
    broadcastAssistantStreamDone(assistantStreamId, source);
    broadcastState("idle");
  }
}

// ===== System metrics broadcast =====
startMetricsBroadcast(broadcast, 2000);

// ===== startup delay =====
await new Promise(r => setTimeout(r, 15000));
console.log("Nova online.");
broadcastState("idle");

// ===== main loop (HARD WAKE-WORD GATE) =====
let lastWakeHandledAt = 0;
let lastVoiceTextHandled = "";
let lastVoiceTextHandledAt = 0;
let lastVoiceCommandHandled = "";
let lastVoiceCommandHandledAt = 0;
while (true) {
  try {
    // Skip entirely if muted - no listening, no tokens
    if (muted) {
      await new Promise(r => setTimeout(r, MIC_IDLE_DELAY_MS));
      continue;
    }

    // Skip voice loop iteration if HUD is driving the conversation
    if (busy) {
      await new Promise(r => setTimeout(r, MIC_IDLE_DELAY_MS));
      continue;
    }

    // Prevent wake-word re-triggers from Nova hearing its own recent TTS playback.
    if (Date.now() < suppressVoiceWakeUntilMs) {
      await new Promise(r => setTimeout(r, MIC_IDLE_DELAY_MS));
      continue;
    }

    // Check muted again before broadcasting listening state
    if (muted) continue;
    broadcastState("listening");
    recordMic(MIC_RECORD_SECONDS);

    // Re-check after recording (HUD message may have arrived during the 3s block)
    if (busy || muted) continue;

    let text = await transcribe();
    // One quick retry improves pickup reliability when the first clip is too short/noisy.
    if (!text || !text.trim()) {
      recordMic(MIC_RETRY_SECONDS);
      if (busy || muted) continue;
      text = await transcribe();
    }
    if (!text || busy || muted) {
      if (!busy && !muted) broadcastState("idle");
      // Broadcast empty transcript to clear HUD
      if (!busy && !muted) broadcast({ type: "transcript", text: "", ts: Date.now() });
      continue;
    }

    // Broadcast what was heard so the HUD can show it
    broadcast({ type: "transcript", text, ts: Date.now() });

    const normalizedHeard = normalizeWakeText(text);
    const now = Date.now();
    if (
      normalizedHeard &&
      normalizedHeard === lastVoiceTextHandled &&
      now - lastVoiceTextHandledAt < VOICE_DUPLICATE_TEXT_COOLDOWN_MS
    ) {
      if (!busy && !muted) broadcastState("idle");
      broadcast({ type: "transcript", text: "", ts: Date.now() });
      continue;
    }

    if (!containsWakeWord(text)) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }

    if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }

    // Clear transcript once we start processing
    broadcast({ type: "transcript", text: "", ts: Date.now() });

    const cleanedVoiceInput = stripWakePrompt(text);
    lastWakeHandledAt = now;
    lastVoiceTextHandled = normalizedHeard;
    lastVoiceTextHandledAt = now;
    if (!cleanedVoiceInput) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }
    if (
      cleanedVoiceInput === lastVoiceCommandHandled &&
      now - lastVoiceCommandHandledAt < VOICE_DUPLICATE_COMMAND_COOLDOWN_MS
    ) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }
    if (VOICE_AFTER_WAKE_SUPPRESS_MS > 0) {
      suppressVoiceWakeUntilMs = Math.max(
        suppressVoiceWakeUntilMs,
        Date.now() + VOICE_AFTER_WAKE_SUPPRESS_MS
      );
    }

    stopSpeaking();
    console.log("Heard:", cleanedVoiceInput);
    busy = true;
    lastVoiceCommandHandled = cleanedVoiceInput;
    lastVoiceCommandHandledAt = now;
    try {
      await handleInput(cleanedVoiceInput, { voice: voiceEnabled, ttsVoice: currentVoice, source: "voice" });
    } finally {
      busy = false;
    }
    if (VOICE_POST_RESPONSE_GRACE_MS > 0) {
      await new Promise((r) => setTimeout(r, VOICE_POST_RESPONSE_GRACE_MS));
    }

  } catch (e) {
    console.error("Loop error:", e);
    busy = false;
    if (!muted) broadcastState("idle");
  }
}
