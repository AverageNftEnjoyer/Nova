// ===== imports (ESM) =====
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { execSync, exec, spawn } from "child_process";
import { FishAudioClient } from "fish-audio";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { startMetricsBroadcast, getSystemMetrics } from "./metrics.js";
import { buildAgentSystemPrompt, PromptMode } from "./system-prompt.js";
import { buildPersonaPrompt } from "./bootstrap.js";
import { createSessionRuntime } from "./runtime/session.js";
import { createToolRuntime } from "./runtime/tools-runtime.js";
import { createWakeWordRuntime } from "./runtime/voice.js";
import {
  buildSystemPromptWithPersona,
  countApproxTokens,
  enforcePromptTokenBound,
} from "./runtime/context-prompt.js";
import {
  claudeMessagesCreate,
  claudeMessagesStream,
  describeUnknownError,
  estimateTokenCostUsd,
  extractOpenAIChatText,
  getOpenAIClient,
  loadIntegrationsRuntime,
  loadOpenAIIntegrationRuntime,
  resolveConfiguredChatRuntime,
  streamOpenAiChatCompletion,
  toErrorDetails,
  withTimeout,
} from "./providers.js";

// ===== __dirname fix =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== load shared .env from project root =====
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const INTEGRATIONS_CONFIG_PATH = path.join(__dirname, "..", "hud", "data", "integrations-config.json");
const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_GROK_MODEL = "grok-4-0709";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const OPENAI_FALLBACK_MODEL = String(process.env.NOVA_OPENAI_FALLBACK_MODEL || "").trim();
const TOOL_LOOP_ENABLED = String(process.env.NOVA_TOOL_LOOP_ENABLED || "1").trim() === "1";
const MEMORY_LOOP_ENABLED = String(process.env.NOVA_MEMORY_ENABLED || "1").trim() === "1";
const TOOL_LOOP_MAX_STEPS = Number.parseInt(process.env.NOVA_TOOL_LOOP_MAX_STEPS || "6", 10);
const TOOL_REGISTRY_ENABLED_TOOLS = String(
  process.env.NOVA_ENABLED_TOOLS ||
    "read,write,edit,ls,grep,exec,web_search,web_fetch,memory_search,memory_get",
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const TOOL_SAFE_BINARIES = String(
  process.env.NOVA_SAFE_BINARIES || "ls,cat,head,tail,grep,find,wc,sort,echo,pwd",
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const TOOL_EXEC_APPROVAL_MODE = ["ask", "auto", "off"].includes(
  String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase(),
)
  ? String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase()
  : "ask";
const TOOL_WEB_SEARCH_PROVIDER = "brave";
const MEMORY_DB_PATH = path.join(__dirname, "..", ".agent", "memory.db");
const MEMORY_SOURCE_DIR = path.join(__dirname, "..", "memory");
const ROOT_WORKSPACE_DIR = path.join(__dirname, "..");
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
const AGENT_PROMPT_MODE = String(process.env.NOVA_PROMPT_MODE || PromptMode.FULL).trim().toLowerCase();
const RAW_STREAM_ENABLED =
  String(process.env.OPENCLAW_RAW_STREAM || "").trim() === "1" ||
  String(process.env.NOVA_RAW_STREAM || "").trim() === "1";
const RAW_STREAM_PATH = String(
  process.env.OPENCLAW_RAW_STREAM_PATH ||
    process.env.NOVA_RAW_STREAM_PATH ||
    path.join(__dirname, "..", "agent", "raw-stream.jsonl")
).trim();
const SESSION_STORE_PATH = path.join(__dirname, "..", ".agent", "sessions.json");
const SESSION_TRANSCRIPT_DIR = path.join(__dirname, "..", ".agent", "transcripts");
const SESSION_MAX_TURNS = Number.parseInt(process.env.NOVA_SESSION_MAX_TURNS || "20", 10);
const SESSION_MAX_HISTORY_TOKENS = Number.parseInt(
  process.env.NOVA_SESSION_MAX_HISTORY_TOKENS || "2200",
  10,
);
const SESSION_TRANSCRIPTS_ENABLED =
  String(process.env.NOVA_SESSION_TRANSCRIPTS_ENABLED || "1").trim() !== "0";
const SESSION_MAX_TRANSCRIPT_LINES = Number.parseInt(
  process.env.NOVA_SESSION_MAX_TRANSCRIPT_LINES || "400",
  10,
);
const SESSION_TRANSCRIPT_RETENTION_DAYS = Number.parseInt(
  process.env.NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS || "30",
  10,
);
const SESSION_IDLE_MINUTES = Number.parseInt(process.env.NOVA_SESSION_IDLE_MINUTES || "120", 10);
const SESSION_MAIN_KEY = String(process.env.NOVA_SESSION_MAIN_KEY || "main").trim() || "main";
const ENABLE_PROVIDER_FALLBACK =
  String(process.env.NOVA_ALLOW_PROVIDER_FALLBACK || "").trim() === "1";
const MEMORY_FACT_MAX_CHARS = Number.parseInt(
  process.env.NOVA_MEMORY_FACT_MAX_CHARS || "280",
  10,
);
const UPGRADE_MODULE_INDEX = [
  "src/agent/runner.ts",
  "src/agent/queue.ts",
  "src/agent/system-prompt.ts",
  "src/agent/bootstrap.ts",
  "src/agent/tool-summaries.ts",
  "src/agent/compact.ts",
  "src/agent/history.ts",
  "src/session/key.ts",
  "src/session/store.ts",
  "src/session/resolve.ts",
  "src/session/lock.ts",
  "src/memory/manager.ts",
  "src/memory/hybrid.ts",
  "src/memory/chunker.ts",
  "src/memory/embeddings.ts",
  "src/tools/registry.ts",
  "src/tools/executor.ts",
  "src/tools/web-search.ts",
  "src/tools/web-fetch.ts",
  "src/tools/memory-tools.ts",
  "src/tools/exec.ts",
  "src/tools/file-tools.ts",
  "src/skills/discovery.ts",
  "src/skills/formatter.ts",
  "src/skills/snapshot.ts",
  "src/config/index.ts",
  "src/config/types.ts",
  "src/index.ts",
];
const sessionRuntime = createSessionRuntime({
  sessionStorePath: SESSION_STORE_PATH,
  transcriptDir: SESSION_TRANSCRIPT_DIR,
  sessionIdleMinutes: SESSION_IDLE_MINUTES,
  sessionMainKey: SESSION_MAIN_KEY,
  transcriptsEnabled: SESSION_TRANSCRIPTS_ENABLED,
  maxTranscriptLines: SESSION_MAX_TRANSCRIPT_LINES,
  transcriptRetentionDays: SESSION_TRANSCRIPT_RETENTION_DAYS,
});
const toolRuntime = createToolRuntime({
  enabled: TOOL_LOOP_ENABLED,
  memoryEnabled: MEMORY_LOOP_ENABLED,
  rootDir: ROOT_WORKSPACE_DIR,
  memoryDbPath: MEMORY_DB_PATH,
  memorySourceDir: MEMORY_SOURCE_DIR,
  enabledTools: TOOL_REGISTRY_ENABLED_TOOLS,
  execApprovalMode: TOOL_EXEC_APPROVAL_MODE,
  safeBinaries: TOOL_SAFE_BINARIES,
  webSearchProvider: TOOL_WEB_SEARCH_PROVIDER,
  webSearchApiKey: String(process.env.BRAVE_API_KEY || "").trim(),
  memoryConfig: {
    embeddingProvider:
      String(process.env.NOVA_EMBEDDING_PROVIDER || "local").trim().toLowerCase() === "openai"
        ? "openai"
        : "local",
    embeddingModel: String(process.env.NOVA_EMBEDDING_MODEL || "text-embedding-3-small").trim(),
    embeddingApiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    chunkSize: Number.parseInt(process.env.NOVA_MEMORY_CHUNK_SIZE || "400", 10),
    chunkOverlap: Number.parseInt(process.env.NOVA_MEMORY_CHUNK_OVERLAP || "80", 10),
    hybridVectorWeight: Number.parseFloat(process.env.NOVA_MEMORY_VECTOR_WEIGHT || "0.7"),
    hybridBm25Weight: Number.parseFloat(process.env.NOVA_MEMORY_BM25_WEIGHT || "0.3"),
    topK: Number.parseInt(process.env.NOVA_MEMORY_TOP_K || "5", 10),
  },
  describeUnknownError,
});
const wakeWordRuntime = createWakeWordRuntime({
  wakeWord: WAKE_WORD,
  wakeWordVariants: WAKE_WORD_VARIANTS,
});
const USER_CONTEXT_ROOT = path.join(ROOT_WORKSPACE_DIR, ".agent", "user-context");
const BOOTSTRAP_BASELINE_DIR = path.join(ROOT_WORKSPACE_DIR, "templates");
const BOOTSTRAP_FILE_NAMES = ["SOUL.md", "USER.md", "AGENTS.md", "MEMORY.md", "IDENTITY.md"];

function resolvePersonaWorkspaceDir(userContextId) {
  const normalized = sessionRuntime.normalizeUserContextId(userContextId || "");
  if (!normalized) {
    return ROOT_WORKSPACE_DIR;
  }

  const userDir = path.join(USER_CONTEXT_ROOT, normalized);
  try {
    fs.mkdirSync(userDir, { recursive: true });
    for (const fileName of BOOTSTRAP_FILE_NAMES) {
      const targetPath = path.join(userDir, fileName);
      if (fs.existsSync(targetPath)) continue;

      const templatePath = path.join(BOOTSTRAP_BASELINE_DIR, fileName);
      const rootPath = path.join(ROOT_WORKSPACE_DIR, fileName);
      const sourcePath = fs.existsSync(templatePath)
        ? templatePath
        : fs.existsSync(rootPath)
          ? rootPath
          : "";
      if (!sourcePath) continue;
      fs.copyFileSync(sourcePath, targetPath);
    }
    return userDir;
  } catch (err) {
    console.warn(
      `[Persona] Failed preparing per-user workspace for ${normalized}: ${describeUnknownError(err)}`,
    );
    return ROOT_WORKSPACE_DIR;
  }
}

function appendRawStream(event) {
  if (!RAW_STREAM_ENABLED) return;
  try {
    fs.appendFileSync(
      RAW_STREAM_PATH,
      `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`,
      "utf8",
    );
  } catch (err) {
    console.error(`[RawStream] Failed writing ${RAW_STREAM_PATH}: ${describeUnknownError(err)}`);
  }
}

function scanUpgradeModuleIndex() {
  const root = path.join(__dirname, "..");
  const found = [];
  const missing = [];
  for (const relPath of UPGRADE_MODULE_INDEX) {
    const absPath = path.join(root, relPath);
    if (fs.existsSync(absPath)) found.push(relPath);
    else missing.push(relPath);
  }
  return { found, missing };
}

function logUpgradeIndexSummary() {
  const scan = scanUpgradeModuleIndex();
  console.log(
    `[UpgradeIndex] runtime modules indexed: ${scan.found.length}/${UPGRADE_MODULE_INDEX.length}`,
  );
  if (scan.missing.length > 0) {
    console.warn(`[UpgradeIndex] Missing modules: ${scan.missing.join(", ")}`);
  }
}


function readIntegrationsConfigSnapshot() {
  if (!fs.existsSync(INTEGRATIONS_CONFIG_PATH)) {
    return { exists: false, parsed: null, parseError: null };
  }
  try {
    const raw = fs.readFileSync(INTEGRATIONS_CONFIG_PATH, "utf8");
    return { exists: true, parsed: JSON.parse(raw), parseError: null };
  } catch (err) {
    return { exists: true, parsed: null, parseError: describeUnknownError(err) };
  }
}

function extractIntegrationMiskeys(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  const hints = [];
  if (Object.prototype.hasOwnProperty.call(parsed, "activeProvider")) {
    hints.push('Found legacy "activeProvider". Expected "activeLlmProvider".');
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "defaultModel")) {
    hints.push('Found top-level "defaultModel". Expected provider-specific defaultModel fields.');
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "openaiApiKey")) {
    hints.push('Found legacy "openaiApiKey". Expected "openai.apiKey".');
  }
  return hints;
}

function listScopedIntegrationContextIds() {
  try {
    if (!fs.existsSync(USER_CONTEXT_ROOT)) return [];
    const entries = fs.readdirSync(USER_CONTEXT_ROOT, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((id) => fs.existsSync(path.join(USER_CONTEXT_ROOT, id, "integrations-config.json")));
  } catch {
    return [];
  }
}

function providerDisplayName(provider) {
  if (provider === "claude") return "Claude";
  if (provider === "grok") return "Grok";
  if (provider === "gemini") return "Gemini";
  return "OpenAI";
}

function logAgentRuntimePreflight() {
  const snapshot = readIntegrationsConfigSnapshot();
  const scopedContextIds = listScopedIntegrationContextIds();
  if (!snapshot.exists && scopedContextIds.length === 0) {
    console.warn(`[Preflight] Missing integrations config at ${INTEGRATIONS_CONFIG_PATH}`);
    return;
  }
  if (snapshot.parseError) {
    console.error(`[Preflight] Invalid integrations config JSON: ${snapshot.parseError}`);
  }

  const miskeys = extractIntegrationMiskeys(snapshot.parsed);
  if (miskeys.length > 0) {
    for (const hint of miskeys) {
      console.warn(`[Preflight] ${hint}`);
    }
  }

  const runtime = loadIntegrationsRuntime();
  const active = resolveConfiguredChatRuntime(runtime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
  });

  let hasScopedReadyProvider = false;
  let hasScopedOpenAiKey = false;
  for (const contextId of scopedContextIds) {
    const scopedRuntime = loadIntegrationsRuntime({ userContextId: contextId });
    const scopedActive = resolveConfiguredChatRuntime(scopedRuntime, {
      strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
    });
    if (scopedActive.connected && String(scopedActive.apiKey || "").trim()) {
      hasScopedReadyProvider = true;
    }
    if (String(scopedRuntime?.openai?.apiKey || "").trim()) {
      hasScopedOpenAiKey = true;
    }
    if (hasScopedReadyProvider && hasScopedOpenAiKey) {
      break;
    }
  }

  const globalActiveReady = active.connected && String(active.apiKey || "").trim().length > 0;
  if (!globalActiveReady && !hasScopedReadyProvider) {
    console.warn(
      `[Preflight] Active provider is ${providerDisplayName(active.provider)} but no API key is configured. Chat requests will fail until configured.`,
    );
  } else if (!globalActiveReady && hasScopedReadyProvider) {
    console.log(
      "[Preflight] Global integrations are missing an active provider key, but user-scoped runtime keys were found.",
    );
  }

  const globalOpenAiKey = String(runtime.openai.apiKey || "").trim();
  if (!globalOpenAiKey && !hasScopedOpenAiKey) {
    console.warn("[Preflight] OpenAI key missing. Voice transcription (STT) may fail.");
  } else if (!globalOpenAiKey && hasScopedOpenAiKey) {
    console.log(
      "[Preflight] OpenAI key found in user-scoped runtime; global STT fallback key is not configured.",
    );
  }
}

function trimHistoryMessagesByTokenBudget(messages, maxTokens) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], trimmed: 0, tokens: 0 };
  }
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  if (budget <= 0) {
    return { messages: [], trimmed: messages.length, tokens: 0 };
  }

  const tokenPerMessage = messages.map((msg) =>
    countApproxTokens(`${String(msg?.role || "user")}: ${String(msg?.content || "")}`),
  );
  let tokens = tokenPerMessage.reduce((sum, value) => sum + value, 0);
  if (tokens <= budget) {
    return { messages, trimmed: 0, tokens };
  }

  let start = 0;
  const minKeep = Math.min(2, messages.length);
  while (start < messages.length && tokens > budget && messages.length - start > minKeep) {
    tokens -= tokenPerMessage[start] || 0;
    start += 1;
  }
  const kept = messages.slice(start);
  const keptTokens = kept.reduce(
    (sum, msg) => sum + countApproxTokens(`${String(msg?.role || "user")}: ${String(msg?.content || "")}`),
    0,
  );
  return {
    messages: kept,
    trimmed: start,
    tokens: keptTokens,
  };
}

function normalizeMemoryFieldKey(rawField) {
  return String(rawField || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function extractMemoryUpdateFact(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const directPatterns = [
    /update\s+(?:your|ur)\s+memory(?:\s+to\s+this)?\s*[:,-]?\s*(.+)$/i,
    /remember\s+this\s*[:,-]?\s*(.+)$/i,
    /remember\s+that\s*[:,-]?\s*(.+)$/i,
  ];
  for (const pattern of directPatterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    return String(match[1] || "").trim();
  }
  if (/update\s+(?:your|ur)\s+memory/i.test(raw)) {
    return "";
  }
  return "";
}

function isMemoryUpdateRequest(input) {
  const raw = String(input || "").trim();
  if (!raw) return false;
  return (
    /update\s+(?:your|ur)\s+memory/i.test(raw) ||
    /remember\s+this/i.test(raw) ||
    /remember\s+that/i.test(raw)
  );
}

function buildMemoryFactMetadata(factText) {
  const normalizedFact = String(factText || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, Math.max(60, MEMORY_FACT_MAX_CHARS));
  const relationMatch = normalizedFact.match(
    /^(?:my|our)\s+(.+?)\s+(?:is|are|was|were|equals|=)\s+(.+)$/i,
  );
  const field = relationMatch ? String(relationMatch[1] || "").trim() : "";
  const value = relationMatch ? String(relationMatch[2] || "").trim() : "";
  const key = field ? normalizeMemoryFieldKey(field) : "";
  return {
    fact: normalizedFact,
    key,
    hasStructuredField: Boolean(field && value),
  };
}

function ensureMemoryTemplate() {
  return [
    "# Persistent Memory",
    "This file is loaded into every conversation. Add important facts, decisions, and context here.",
    "",
    "## Important Facts",
    "",
  ].join("\n");
}

function upsertMemoryFactInMarkdown(existingContent, factText, key) {
  const content = String(existingContent || "");
  const lines = content.length > 0 ? content.split(/\r?\n/) : ensureMemoryTemplate().split(/\r?\n/);
  const today = new Date().toISOString().slice(0, 10);
  const marker = key ? `[memory:${key}]` : "[memory:general]";
  const memoryLine = `- ${today}: ${marker} ${factText}`;

  const filtered = lines.filter((line) => {
    if (!key) return true;
    return !line.includes(`[memory:${key}]`);
  });

  const sectionIndex = filtered.findIndex((line) => line.trim().toLowerCase() === "## important facts");
  if (sectionIndex === -1) {
    if (filtered.length > 0 && filtered[filtered.length - 1].trim() !== "") {
      filtered.push("");
    }
    filtered.push("## Important Facts", "", memoryLine);
    return filtered.join("\n");
  }

  let insertAt = sectionIndex + 1;
  while (insertAt < filtered.length && filtered[insertAt].trim() === "") {
    insertAt += 1;
  }
  filtered.splice(insertAt, 0, memoryLine);

  // Keep MEMORY.md bounded: retain latest 80 tagged memory lines.
  const memoryLineIndexes = [];
  for (let i = 0; i < filtered.length; i += 1) {
    if (/\[memory:[a-z0-9-]+\]/i.test(filtered[i])) {
      memoryLineIndexes.push(i);
    }
  }
  const maxMemoryLines = 80;
  if (memoryLineIndexes.length > maxMemoryLines) {
    const removeCount = memoryLineIndexes.length - maxMemoryLines;
    const toRemove = new Set(memoryLineIndexes.slice(memoryLineIndexes.length - removeCount));
    const compacted = filtered.filter((_, idx) => !toRemove.has(idx));
    return compacted.join("\n");
  }

  return filtered.join("\n");
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
let voiceEnabled = false;
// Whether Nova is muted (stops listening entirely when true)
let muted = true;

// ===== paths =====
const ROOT = __dirname;
const MPV = path.join(ROOT, "mpv", "mpv.exe");
const THINK_SOUND = path.join(ROOT, "thinking.mp3");

// ===== WebSocket HUD server =====
function startHudWebSocketServer() {
  try {
    return new WebSocketServer({ port: 8765 });
  } catch (err) {
    const details = describeUnknownError(err);
    console.error(`[Gateway] Failed to start HUD WebSocket server on port 8765: ${details}`);
    console.error('[Gateway] Another process may be using port 8765. Stop existing Nova/agent processes and retry.');
    process.exit(1);
  }
}

const wss = startHudWebSocketServer();

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

function shouldPreloadWebSearch(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return /\b(latest|most recent|today|tonight|yesterday|last night|current|breaking|update|updates|live|score|scores|recap|price|prices|market|news|weather)\b/.test(
    n,
  );
}

function replyClaimsNoLiveAccess(text) {
  const n = String(text || "").toLowerCase();
  if (!n.trim()) return false;
  return (
    n.includes("don't have live access") ||
    n.includes("do not have live access") ||
    n.includes("don't have access to the internet") ||
    n.includes("no live access to the internet") ||
    n.includes("can't access current") ||
    n.includes("cannot access current") ||
    n.includes("cannot browse") ||
    n.includes("can't browse") ||
    n.includes("without web access")
  );
}

function buildWebSearchReadableReply(query, rawResults) {
  const raw = String(rawResults || "").trim();
  if (!raw || /^web_search error/i.test(raw) || raw === "No results found.") {
    return "";
  }

  const blocks = raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const items = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const title = lines[0].replace(/^\[\d+\]\s*/, "").trim();
    const url = /^https?:\/\//i.test(lines[1]) ? lines[1] : "";
    const snippet = lines.slice(url ? 2 : 1).join(" ").replace(/\s+/g, " ").trim();
    if (!title && !snippet) continue;
    items.push({
      title: title || "Result",
      url,
      snippet: snippet || "No snippet available.",
    });
    if (items.length >= 3) break;
  }

  if (items.length === 0) return "";

  const lines = [
    `Here is a quick live-web recap for: "${String(query || "").trim()}".`,
    "",
  ];
  for (const item of items) {
    lines.push(`- ${item.title}: ${item.snippet}`);
    if (item.url) lines.push(`  Source: ${item.url}`);
  }
  return lines.join("\n");
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
          const incomingUserId = sessionRuntime.normalizeUserContextId(
            typeof data.userId === "string" ? data.userId : "",
          );
          await handleInput(data.content, {
            voice: data.voice !== false,
            ttsVoice: data.ttsVoice || currentVoice,
            source: "hud",
            sender: typeof data.sender === "string" ? data.sender : "hud-user",
            userContextId: incomingUserId || undefined,
            sessionKeyHint:
              typeof data.sessionKey === "string"
                ? data.sessionKey
                : typeof data.conversationId === "string"
                  ? incomingUserId
                    ? `agent:nova:hud:user:${incomingUserId}:dm:${data.conversationId}`
                    : `agent:nova:hud:dm:${data.conversationId}`
                  : undefined,
          });
        } catch (err) {
          const details = toErrorDetails(err);
          const msg = details.message || "Unexpected runtime failure.";
          console.error(
            `[HUD] handleInput failed status=${details.status ?? "n/a"} code=${details.code ?? "n/a"} type=${details.type ?? "n/a"} message=${msg}`,
          );
          const streamId = createAssistantStreamId();
          broadcastAssistantStreamStart(streamId, "hud");
          broadcastAssistantStreamDelta(
            streamId,
            `Request failed${details.status ? ` (${details.status})` : ""}${details.code ? ` [${details.code}]` : ""}: ${msg}`,
            "hud",
          );
          broadcastAssistantStreamDone(streamId, "hud");
          broadcastState("idle");
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
      console.error("[WS] Bad message from HUD:", describeUnknownError(e));
    }
  });
});

// ===== mic =====
function createMicCapturePath() {
  return path.join(ROOT, `mic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
}

function cleanupAudioArtifacts() {
  try {
    const entries = fs.readdirSync(ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^speech_\d+\.mp3$/i.test(entry.name) && !/^mic_[a-z0-9_-]+\.wav$/i.test(entry.name)) continue;
      try {
        fs.unlinkSync(path.join(ROOT, entry.name));
      } catch {}
    }
  } catch {}
}

function recordMic(outFile, seconds = 3) {
  const safeSeconds = Math.max(1, Math.min(8, Number.isFinite(seconds) ? seconds : 3));
  execSync(
    `sox -t waveaudio -d "${outFile}" trim 0 ${safeSeconds}`,
    { stdio: "ignore" }
  );
}

// ===== STT =====
async function transcribe(micFile) {
  const runtime = loadOpenAIIntegrationRuntime();
  const openai = getOpenAIClient(runtime);
  const r = await openai.audio.transcriptions.create({
    file: fs.createReadStream(micFile),
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

// ===== command ACKs =====
const COMMAND_ACKS = [
  "On it.",
  "Right away.",
  "Working on that now."
];

// ===== input handler =====
async function handleInput(text, opts = {}) {
  const sessionContext = sessionRuntime.resolveSessionContext(opts);
  const sessionKey = sessionContext.sessionKey;
  const userContextId = sessionRuntime.resolveUserContextId(opts);
  const useVoice = opts.voice !== false;
  const ttsVoice = opts.ttsVoice || "default";
  const source = opts.source || "hud";
  const sender = String(opts.sender || "").trim();
  const n = text.toLowerCase().trim();
  appendRawStream({
    event: "request_start",
    source,
    sessionKey,
    userContextId: userContextId || undefined,
    chars: String(text || "").length,
  });

  if (isMemoryUpdateRequest(text)) {
    const fact = extractMemoryUpdateFact(text);
    const sessionId = sessionContext.sessionEntry?.sessionId;
    broadcastState("thinking");
    broadcastMessage("user", text, source);
    if (sessionId) {
      sessionRuntime.appendTranscriptTurn(sessionId, "user", text, {
        source,
        sender: sender || null,
      });
    }

    if (!fact) {
      const missingFactReply = "Tell me exactly what to remember after 'update your memory'.";
      broadcastMessage("assistant", missingFactReply, source);
      if (sessionId) {
        sessionRuntime.appendTranscriptTurn(sessionId, "assistant", missingFactReply, {
          source,
          sender: "nova",
        });
      }
      if (useVoice) {
        await speak(missingFactReply, ttsVoice);
      } else {
        broadcastState("idle");
      }
      return;
    }

    try {
      const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
      const memoryFilePath = path.join(personaWorkspaceDir, "MEMORY.md");
      const existingContent = fs.existsSync(memoryFilePath)
        ? fs.readFileSync(memoryFilePath, "utf8")
        : ensureMemoryTemplate();
      const memoryMeta = buildMemoryFactMetadata(fact);
      const updatedContent = upsertMemoryFactInMarkdown(
        existingContent,
        memoryMeta.fact,
        memoryMeta.key,
      );
      fs.writeFileSync(memoryFilePath, updatedContent, "utf8");
      const confirmation = memoryMeta.hasStructuredField
        ? `Memory updated. I will remember this as current: ${memoryMeta.fact}`
        : `Memory updated. I saved: ${memoryMeta.fact}`;
      broadcastMessage("assistant", confirmation, source);
      if (sessionId) {
        sessionRuntime.appendTranscriptTurn(sessionId, "assistant", confirmation, {
          source,
          sender: "nova",
        });
      }
      if (useVoice) {
        await speak(confirmation, ttsVoice);
      } else {
        broadcastState("idle");
      }
      return;
    } catch (err) {
      const failure = `I couldn't update MEMORY.md: ${describeUnknownError(err)}`;
      broadcastMessage("assistant", failure, source);
      if (sessionId) {
        sessionRuntime.appendTranscriptTurn(sessionId, "assistant", failure, {
          source,
          sender: "nova",
        });
      }
      if (useVoice) {
        await speak(failure, ttsVoice);
      } else {
        broadcastState("idle");
      }
      return;
    }
  }

  const integrationsRuntime = loadIntegrationsRuntime({ userContextId });
  const activeChatRuntime = resolveConfiguredChatRuntime(integrationsRuntime, {
    strictActiveProvider: !ENABLE_PROVIDER_FALLBACK,
  });
  if (!activeChatRuntime.apiKey) {
    const providerName = activeChatRuntime.provider === "claude" ? "Claude" : activeChatRuntime.provider === "grok" ? "Grok" : activeChatRuntime.provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(
      `Missing ${providerName} API key for active provider "${activeChatRuntime.provider}". Configure Integrations first (source: ${integrationsRuntime.sourcePath || INTEGRATIONS_CONFIG_PATH}).`,
    );
  }
  if (!activeChatRuntime.connected) {
    throw new Error(
      `Active provider "${activeChatRuntime.provider}" is not enabled in Integrations. Enable it or switch activeLlmProvider.`,
    );
  }
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
  const runtimeTools = await toolRuntime.initToolRuntimeIfNeeded();
  const availableTools = Array.isArray(runtimeTools?.tools) ? runtimeTools.tools : [];
  const canRunToolLoop =
    TOOL_LOOP_ENABLED &&
    availableTools.length > 0 &&
    typeof runtimeTools?.executeToolUse === "function";
  const canRunWebSearch =
    canRunToolLoop && availableTools.some((tool) => String(tool?.name || "") === "web_search");
  console.log(
    `[RuntimeSelection] session=${sessionKey} provider=${activeChatRuntime.provider} model=${selectedChatModel} source=${source} strictActive=${activeChatRuntime.strict ? "on" : "off"}`,
  );

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
  // Use per-session transcript history (JSONL) so Nova keeps context by session key.
  broadcastState("thinking");
  broadcastMessage("user", text, source);
  if (useVoice) playThinking();

  const personaWorkspaceDir = resolvePersonaWorkspaceDir(userContextId);
  const { systemPrompt: baseSystemPrompt, tokenBreakdown } = buildSystemPromptWithPersona({
    buildAgentSystemPrompt,
    buildPersonaPrompt,
    workspaceDir: personaWorkspaceDir,
    promptArgs: {
      workspaceDir: ROOT_WORKSPACE_DIR,
      promptMode:
        AGENT_PROMPT_MODE === PromptMode.MINIMAL || AGENT_PROMPT_MODE === PromptMode.NONE
          ? AGENT_PROMPT_MODE
          : PromptMode.FULL,
      memoryCitationsMode:
        String(process.env.NOVA_MEMORY_CITATIONS_MODE || "off").trim().toLowerCase() === "on"
          ? "on"
          : "off",
      userTimezone: process.env.NOVA_USER_TIMEZONE || "America/New_York",
      skillsPrompt: process.env.NOVA_SKILLS_PROMPT || "",
      heartbeatPrompt: process.env.NOVA_HEARTBEAT_PROMPT || "",
      docsPath: process.env.NOVA_DOCS_PATH || "",
      ttsHint: "Keep voice responses concise, clear, and natural.",
      reasoningLevel: "off",
      runtimeInfo: {
        agentId: "nova-agent",
        host: process.env.COMPUTERNAME || "",
        os: process.platform,
        arch: process.arch,
        node: process.version,
        model: selectedChatModel,
        defaultModel: selectedChatModel,
        shell: process.env.ComSpec || process.env.SHELL || "",
        channel: source,
        capabilities: ["voice", "websocket"],
        repoRoot: ROOT_WORKSPACE_DIR,
      },
      workspaceNotes: [
        "This is a first-pass prompt framework integration for Nova.",
        "Future skill/memory metadata plumbing can extend this prompt builder.",
      ],
    },
  });

  let systemPrompt = baseSystemPrompt;
  if (canRunWebSearch && shouldPreloadWebSearch(text)) {
    try {
      const preloadResult = await runtimeTools.executeToolUse(
        {
          id: `tool_preload_${Date.now()}`,
          name: "web_search",
          input: { query: text },
          type: "tool_use",
        },
        availableTools,
      );
      const preloadContent = String(preloadResult?.content || "").trim();
      if (preloadContent && !/^web_search error/i.test(preloadContent)) {
        systemPrompt += `\n\n## Live Web Search Context\nUse these current results when answering:\n${preloadContent.slice(0, 2200)}`;
      }
    } catch (err) {
      console.warn(`[ToolLoop] web_search preload failed: ${describeUnknownError(err)}`);
    }
  }
  if (runtimeTools?.memoryManager && MEMORY_LOOP_ENABLED) {
    try {
      runtimeTools.memoryManager.warmSession();
      const recalled = await runtimeTools.memoryManager.search(text, 3);
      if (Array.isArray(recalled) && recalled.length > 0) {
        const memoryContext = recalled
          .map((item, idx) => {
            const sourcePath = String(item.source || "unknown");
            const content = String(item.content || "").slice(0, 600);
            return `[${idx + 1}] ${sourcePath}\n${content}`;
          })
          .join("\n\n");
        systemPrompt += `\n\n## Live Memory Recall\nUse this indexed context when relevant:\n${memoryContext}`;
      }
    } catch (err) {
      console.warn(`[MemoryLoop] Search failed: ${describeUnknownError(err)}`);
    }
  }

  // Enforce token bounds before model call
  const tokenInfo = enforcePromptTokenBound(systemPrompt, text, MAX_PROMPT_TOKENS);
  console.log(`[Prompt] Tokens - persona: ${tokenBreakdown.persona}, user: ${tokenInfo.userTokens}`);

  // Build request messages using limited transcript history + current user turn.
  const priorTurns = sessionRuntime.limitTranscriptTurns(sessionContext.transcript, SESSION_MAX_TURNS);
  const rawHistoryMessages = sessionRuntime.transcriptToChatMessages(priorTurns);
  const historyBudget = trimHistoryMessagesByTokenBudget(
    rawHistoryMessages,
    SESSION_MAX_HISTORY_TOKENS,
  );
  const historyMessages = historyBudget.messages;
  console.log(
    `[Session] key=${sessionKey} sender=${sender || "unknown"} prior_turns=${priorTurns.length} injected_messages=${historyMessages.length} trimmed_messages=${historyBudget.trimmed} history_tokens=${historyBudget.tokens} history_budget=${SESSION_MAX_HISTORY_TOKENS}`,
  );
  const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
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
      const claudeMessages = [...historyMessages, { role: "user", content: text }];
      const claudeCompletion = await claudeMessagesStream({
        apiKey: activeChatRuntime.apiKey,
        baseURL: activeChatRuntime.baseURL,
        model: selectedChatModel,
        system: systemPrompt,
        messages: claudeMessages,
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
      if (canRunToolLoop) {
        const openAiToolDefs = toolRuntime.toOpenAiToolDefinitions(availableTools);
        const loopMessages = [...messages];
        let usedFallback = false;

        for (let step = 0; step < Math.max(1, TOOL_LOOP_MAX_STEPS); step += 1) {
          let completion = null;
          try {
            completion = await withTimeout(
              activeOpenAiCompatibleClient.chat.completions.create({
                model: modelUsed,
                messages: loopMessages,
                tools: openAiToolDefs,
                tool_choice: "auto",
              }),
              OPENAI_REQUEST_TIMEOUT_MS,
              `Tool loop model ${modelUsed}`,
            );
          } catch (err) {
            if (!usedFallback && OPENAI_FALLBACK_MODEL) {
              usedFallback = true;
              modelUsed = OPENAI_FALLBACK_MODEL;
              console.warn(
                `[ToolLoop] Primary model failed; retrying with fallback model ${modelUsed}.`,
              );
              completion = await withTimeout(
                activeOpenAiCompatibleClient.chat.completions.create({
                  model: modelUsed,
                  messages: loopMessages,
                  tools: openAiToolDefs,
                  tool_choice: "auto",
                }),
                OPENAI_REQUEST_TIMEOUT_MS,
                `Tool loop fallback model ${modelUsed}`,
              );
            } else {
              throw err;
            }
          }

          const usage = completion?.usage || {};
          promptTokens += Number(usage.prompt_tokens || 0);
          completionTokens += Number(usage.completion_tokens || 0);

          const choice = completion?.choices?.[0]?.message || {};
          const assistantText = typeof choice.content === "string"
            ? choice.content
            : Array.isArray(choice.content)
              ? choice.content
                  .map((part) =>
                    part && typeof part === "object" && part.type === "text"
                      ? String(part.text || "")
                      : "",
                  )
                  .join("")
              : "";
          const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

          if (toolCalls.length === 0) {
            reply = assistantText.trim();
            break;
          }

          loopMessages.push({
            role: "assistant",
            content: assistantText || "",
            tool_calls: toolCalls,
          });

          for (const toolCall of toolCalls) {
            const toolUse = toolRuntime.toOpenAiToolUseBlock(toolCall);
            const toolResult = await runtimeTools.executeToolUse(toolUse, availableTools);
            loopMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: String(toolResult?.content || ""),
            });
          }
        }

        if (!reply || !reply.trim()) {
          throw new Error(`Model ${modelUsed} returned no text response after tool loop.`);
        }
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
    }

    if (replyClaimsNoLiveAccess(reply) && canRunWebSearch) {
      try {
        const fallbackResult = await runtimeTools.executeToolUse(
          {
            id: `tool_refusal_recover_${Date.now()}`,
            name: "web_search",
            input: { query: text },
            type: "tool_use",
          },
          availableTools,
        );
        const fallbackContent = String(fallbackResult?.content || "").trim();
        if (fallbackContent && !/^web_search error/i.test(fallbackContent)) {
          const readable = buildWebSearchReadableReply(text, fallbackContent);
          const correction = readable
            ? `I do have live web access in this runtime.\n\n${readable}`
            : `I do have live web access in this runtime. Current web results:\n\n${fallbackContent.slice(0, 2200)}`;
          reply = reply ? `${reply}\n\n${correction}` : correction;
          broadcastAssistantStreamDelta(assistantStreamId, correction, source);
        }
      } catch (err) {
        console.warn(`[ToolLoop] refusal recovery search failed: ${describeUnknownError(err)}`);
      }
    } else if (canRunToolLoop && reply && !useVoice) {
      broadcastAssistantStreamDelta(assistantStreamId, reply, source);
    }

    const modelForUsage = activeChatRuntime.provider === "claude" ? selectedChatModel : (modelUsed || selectedChatModel);
    const totalTokens = promptTokens + completionTokens;
    const estimatedCostUsd = estimateTokenCostUsd(modelForUsage, promptTokens, completionTokens);
    appendRawStream({
      event: "request_done",
      source,
      sessionKey,
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    });
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
    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "user", text, {
      source,
      sender,
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      sessionKey,
    });
    sessionRuntime.appendTranscriptTurn(sessionContext.sessionEntry.sessionId, "assistant", reply, {
      source,
      sender: "nova",
      provider: activeChatRuntime.provider,
      model: modelForUsage,
      sessionKey,
      promptTokens,
      completionTokens,
      totalTokens,
    });
    sessionContext.persistUsage({
      model: modelForUsage,
      promptTokens,
      completionTokens,
    });

    if (useVoice) {
      await speak(reply, ttsVoice);
    }
  } catch (err) {
    const details = toErrorDetails(err);
    const msg = details.message || "Unknown model error.";
    appendRawStream({
      event: "request_error",
      source,
      sessionKey,
      provider: activeChatRuntime.provider,
      model: selectedChatModel,
      status: details.status,
      code: details.code,
      type: details.type,
      requestId: details.requestId,
      message: msg,
    });
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

// ===== startup preflight diagnostics =====
sessionRuntime.ensureSessionStorePaths();
logUpgradeIndexSummary();
logAgentRuntimePreflight();

// ===== startup delay =====
await new Promise(r => setTimeout(r, 15000));
cleanupAudioArtifacts();
console.log("Nova online.");
broadcastState(muted ? "muted" : "idle");

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
    const micCapturePath = createMicCapturePath();
    recordMic(micCapturePath, MIC_RECORD_SECONDS);

    // Re-check after recording (HUD message may have arrived during the 3s block)
    if (busy || muted) {
      try { fs.unlinkSync(micCapturePath); } catch {}
      continue;
    }

    let text = await transcribe(micCapturePath);
    try { fs.unlinkSync(micCapturePath); } catch {}
    // One quick retry improves pickup reliability when the first clip is too short/noisy.
    if (!text || !text.trim()) {
      const retryCapturePath = createMicCapturePath();
      recordMic(retryCapturePath, MIC_RETRY_SECONDS);
      if (busy || muted) {
        try { fs.unlinkSync(retryCapturePath); } catch {}
        continue;
      }
      text = await transcribe(retryCapturePath);
      try { fs.unlinkSync(retryCapturePath); } catch {}
    }
    if (!text || busy || muted) {
      if (!busy && !muted) broadcastState("idle");
      // Broadcast empty transcript to clear HUD
      if (!busy && !muted) broadcast({ type: "transcript", text: "", ts: Date.now() });
      continue;
    }

    // Broadcast what was heard so the HUD can show it
    broadcast({ type: "transcript", text, ts: Date.now() });

    const normalizedHeard = wakeWordRuntime.normalizeWakeText(text);
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

    if (!wakeWordRuntime.containsWakeWord(text)) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }

    if (now - lastWakeHandledAt < VOICE_WAKE_COOLDOWN_MS) {
      if (!busy && !muted) broadcastState("idle");
      continue;
    }

    // Clear transcript once we start processing
    broadcast({ type: "transcript", text: "", ts: Date.now() });

    const cleanedVoiceInput = wakeWordRuntime.stripWakePrompt(text);
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
      await handleInput(cleanedVoiceInput, {
        voice: voiceEnabled,
        ttsVoice: currentVoice,
        source: "voice",
        sender: "local-mic",
      });
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
