import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readIntEnv(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(process.env[name] || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readFloatEnv(name, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number.parseFloat(String(process.env[name] || "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readCsvEnv(name, fallbackCsv = "") {
  return String(process.env[name] || fallbackCsv)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readLowerCsvEnv(name, fallbackCsv = "") {
  return readCsvEnv(name, fallbackCsv).map((value) => value.toLowerCase());
}

// ===== Base Paths =====
export const ROOT_DIR = path.join(__dirname, "..");
export const ROOT_WORKSPACE_DIR = path.join(__dirname, "..", "..", "..");
export const INTEGRATIONS_CONFIG_PATH = path.join(ROOT_WORKSPACE_DIR, "hud", "data", "integrations-config.json");

// ===== API Base URLs =====
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

// ===== Default Models =====
export const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_GROK_MODEL = "grok-4-0709";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
export const OPENAI_FALLBACK_MODEL = String(process.env.NOVA_OPENAI_FALLBACK_MODEL || "").trim();

// ===== Tool Loop Config =====
export const TOOL_LOOP_ENABLED = String(process.env.NOVA_TOOL_LOOP_ENABLED || "1").trim() === "1";
export const MEMORY_LOOP_ENABLED = String(process.env.NOVA_MEMORY_ENABLED || "1").trim() === "1";
export const TOOL_LOOP_MAX_STEPS = readIntEnv("NOVA_TOOL_LOOP_MAX_STEPS", 6, { min: 1, max: 32 });
export const TOOL_REGISTRY_ENABLED_TOOLS = readCsvEnv(
  "NOVA_ENABLED_TOOLS",
  process.env.NOVA_ENABLED_TOOLS ||
    "read,write,edit,ls,grep,exec,browser_agent,web_search,web_fetch,memory_search,memory_get,coinbase_capabilities,coinbase_spot_price,coinbase_portfolio_snapshot,coinbase_recent_transactions,coinbase_portfolio_report,gmail_capabilities,gmail_list_accounts,gmail_scope_check,gmail_list_messages,gmail_get_message,gmail_daily_summary,gmail_classify_importance,gmail_forward_message,gmail_reply_draft",
);
export const TOOL_SAFE_BINARIES = readCsvEnv(
  "NOVA_SAFE_BINARIES",
  "ls,cat,head,tail,grep,find,wc,sort,echo,pwd",
);
export const TOOL_EXEC_APPROVAL_MODE = ["ask", "auto", "off"].includes(
  String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase(),
)
  ? String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase()
  : "ask";
export const TOOL_ALLOW_ELEVATED =
  String(process.env.NOVA_TOOL_ALLOW_ELEVATED || "1").trim() !== "0";
export const TOOL_ALLOW_DANGEROUS =
  String(process.env.NOVA_TOOL_ALLOW_DANGEROUS || "0").trim() === "1";
export const TOOL_ELEVATED_ALLOWLIST = readLowerCsvEnv("NOVA_TOOL_ELEVATED_ALLOWLIST");
export const TOOL_DANGEROUS_ALLOWLIST = readLowerCsvEnv("NOVA_TOOL_DANGEROUS_ALLOWLIST");
export const TOOL_CAPABILITY_ENFORCE =
  String(process.env.NOVA_TOOL_CAPABILITY_ENFORCE || "0").trim() === "1";
export const TOOL_CAPABILITY_ALLOWLIST = readLowerCsvEnv("NOVA_TOOL_CAPABILITY_ALLOWLIST");
export const TOOL_CAPABILITY_DENYLIST = readLowerCsvEnv("NOVA_TOOL_CAPABILITY_DENYLIST");
export const TOOL_WEB_SEARCH_PROVIDER = "brave";

// ===== Memory Paths =====
export const MEMORY_DB_PATH = path.join(ROOT_WORKSPACE_DIR, ".agent", "memory.db");
export const MEMORY_SOURCE_DIR = path.join(ROOT_WORKSPACE_DIR, "memory");

// ===== Session Config =====
export const SESSION_STORE_PATH = path.join(ROOT_WORKSPACE_DIR, ".agent", "sessions.json");
export const SESSION_TRANSCRIPT_DIR = path.join(ROOT_WORKSPACE_DIR, ".agent", "transcripts");
export const SESSION_MAX_TURNS = readIntEnv("NOVA_SESSION_MAX_TURNS", 20, { min: 1, max: 1000 });
export const SESSION_IDLE_MINUTES = readIntEnv("NOVA_SESSION_IDLE_MINUTES", 120, { min: 1, max: 10_080 });
export const SESSION_MAIN_KEY = String(process.env.NOVA_SESSION_MAIN_KEY || "main").trim() || "main";

// ===== Request Timeouts =====
export const OPENAI_REQUEST_TIMEOUT_MS = 45000;
export const TOOL_LOOP_REQUEST_TIMEOUT_MS =
  readIntEnv("NOVA_TOOL_LOOP_REQUEST_TIMEOUT_MS", 14000, { min: 3000, max: OPENAI_REQUEST_TIMEOUT_MS });
export const TOOL_LOOP_MAX_DURATION_MS =
  readIntEnv("NOVA_TOOL_LOOP_MAX_DURATION_MS", 32000, { min: 5000, max: OPENAI_REQUEST_TIMEOUT_MS });
export const TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS =
  readIntEnv("NOVA_TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS", 8000, { min: 1000, max: TOOL_LOOP_MAX_DURATION_MS });
export const TOOL_LOOP_RECOVERY_TIMEOUT_MS =
  readIntEnv("NOVA_TOOL_LOOP_RECOVERY_TIMEOUT_MS", 6000, { min: 1000, max: TOOL_LOOP_MAX_DURATION_MS });
export const TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP = readIntEnv(
  "NOVA_TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP",
  6,
  { min: 1, max: 20 },
);

// ===== Voice/Mic Config =====
export const MIC_RECORD_SECONDS = readFloatEnv("NOVA_MIC_RECORD_SECONDS", 4, { min: 0.5, max: 120 });
export const MIC_RETRY_SECONDS = readFloatEnv("NOVA_MIC_RETRY_SECONDS", 2, { min: 0.1, max: 30 });
export const MIC_IDLE_DELAY_MS = readIntEnv("NOVA_MIC_IDLE_DELAY_MS", 250, { min: 0, max: 60_000 });
export const VOICE_WAKE_COOLDOWN_MS = readIntEnv("NOVA_WAKE_COOLDOWN_MS", 1800, { min: 0, max: 600_000 });
export const VOICE_POST_RESPONSE_GRACE_MS = readIntEnv("NOVA_POST_RESPONSE_GRACE_MS", 900, { min: 0, max: 600_000 });
export const VOICE_DUPLICATE_TEXT_COOLDOWN_MS = readIntEnv("NOVA_DUPLICATE_TEXT_COOLDOWN_MS", 12000, { min: 0, max: 3_600_000 });
export const VOICE_DUPLICATE_COMMAND_COOLDOWN_MS = readIntEnv("NOVA_DUPLICATE_COMMAND_COOLDOWN_MS", 120000, { min: 0, max: 3_600_000 });
export const VOICE_AFTER_WAKE_SUPPRESS_MS = readIntEnv("NOVA_AFTER_WAKE_SUPPRESS_MS", 2500, { min: 0, max: 600_000 });
export const VOICE_AFTER_TTS_SUPPRESS_MS = readIntEnv("NOVA_AFTER_TTS_SUPPRESS_MS", 7000, { min: 0, max: 600_000 });
export const WAKE_WORD = String(process.env.NOVA_WAKE_WORD || "nova").trim().toLowerCase();
export const WAKE_WORD_VARIANTS = readLowerCsvEnv("NOVA_WAKE_WORD_VARIANTS", "nova");

// ===== Prompt Mode =====
export const AGENT_PROMPT_MODE = String(process.env.NOVA_PROMPT_MODE || "full").trim().toLowerCase();

// ===== Raw Stream Config =====
export const RAW_STREAM_ENABLED =
  String(process.env.OPENCLAW_RAW_STREAM || "").trim() === "1" ||
  String(process.env.NOVA_RAW_STREAM || "").trim() === "1";
export const RAW_STREAM_PATH = String(
  process.env.OPENCLAW_RAW_STREAM_PATH ||
    process.env.NOVA_RAW_STREAM_PATH ||
    path.join(ROOT_WORKSPACE_DIR, ".agent", "raw-stream.jsonl")
).trim();

// ===== Provider Fallback =====
export const ENABLE_PROVIDER_FALLBACK =
  String(process.env.NOVA_ALLOW_PROVIDER_FALLBACK || "").trim() === "1";
export const ROUTING_PREFERENCE = (() => {
  const value = String(process.env.NOVA_ROUTING_PREFERENCE || "balanced").trim().toLowerCase();
  if (value === "cost" || value === "latency" || value === "quality") return value;
  return "balanced";
})();
export const ROUTING_ALLOW_ACTIVE_OVERRIDE =
  String(process.env.NOVA_ROUTING_ALLOW_ACTIVE_OVERRIDE || "0").trim() === "1";
export const ROUTING_PREFERRED_PROVIDERS = readLowerCsvEnv("NOVA_ROUTING_PREFERRED_PROVIDERS")
  .filter((value) => value === "openai" || value === "claude" || value === "grok" || value === "gemini");

// ===== Token Limits =====
const DEFAULT_MAX_PROMPT_TOKENS = 6000;
export const MAX_PROMPT_TOKENS = readIntEnv("NOVA_MAX_PROMPT_TOKENS", DEFAULT_MAX_PROMPT_TOKENS, {
  min: 1,
  max: 1_000_000,
});

const DEFAULT_PROMPT_RESPONSE_RESERVE_TOKENS = 1400;
export const PROMPT_RESPONSE_RESERVE_TOKENS = readIntEnv(
  "NOVA_PROMPT_RESPONSE_RESERVE_TOKENS",
  DEFAULT_PROMPT_RESPONSE_RESERVE_TOKENS,
  { min: 1, max: 1_000_000 },
);

const DEFAULT_PROMPT_HISTORY_TARGET_TOKENS = 1400;
export const PROMPT_HISTORY_TARGET_TOKENS = readIntEnv(
  "NOVA_PROMPT_HISTORY_TARGET_TOKENS",
  DEFAULT_PROMPT_HISTORY_TARGET_TOKENS,
  { min: 1, max: 1_000_000 },
);

const DEFAULT_PROMPT_MIN_HISTORY_TOKENS = 220;
export const PROMPT_MIN_HISTORY_TOKENS = readIntEnv(
  "NOVA_PROMPT_MIN_HISTORY_TOKENS",
  DEFAULT_PROMPT_MIN_HISTORY_TOKENS,
  { min: 0, max: 1_000_000 },
);

const DEFAULT_PROMPT_CONTEXT_SECTION_MAX_TOKENS = 1000;
export const PROMPT_CONTEXT_SECTION_MAX_TOKENS = readIntEnv(
  "NOVA_PROMPT_CONTEXT_SECTION_MAX_TOKENS",
  DEFAULT_PROMPT_CONTEXT_SECTION_MAX_TOKENS,
  { min: 1, max: 1_000_000 },
);

export const PROMPT_BUDGET_DEBUG =
  String(process.env.NOVA_PROMPT_BUDGET_DEBUG || "").trim() === "1";

// ===== Model Pricing (USD per 1M tokens) =====
export const OPENAI_MODEL_PRICING_USD_PER_1M = {
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

export const CLAUDE_MODEL_PRICING_USD_PER_1M = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 }
};

// ===== Asset Paths =====
export const MPV_PATH = path.join(ROOT_WORKSPACE_DIR, "src", "runtime", "assets", "mpv", "mpv.exe");
export const THINK_SOUND_PATH = path.join(ROOT_WORKSPACE_DIR, "src", "runtime", "assets", "thinking.mp3");

// ===== Command Acknowledgments =====
export const COMMAND_ACKS = [
  "On it.",
  "Right away.",
  "Working on that now.",
];

// ===== Session (extended) =====
export const SESSION_MAX_HISTORY_TOKENS = readIntEnv("NOVA_SESSION_MAX_HISTORY_TOKENS", 3200, {
  min: 1,
  max: 1_000_000,
});
export const SESSION_TRANSCRIPTS_ENABLED =
  String(process.env.NOVA_SESSION_TRANSCRIPTS_ENABLED || "1").trim() !== "0";
export const SESSION_MAX_TRANSCRIPT_LINES = readIntEnv("NOVA_SESSION_MAX_TRANSCRIPT_LINES", 0, {
  min: 0,
  max: 1_000_000,
});
export const SESSION_TRANSCRIPT_RETENTION_DAYS = readIntEnv("NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS", 0, {
  min: 0,
  max: 3650,
});

// ===== LLM Token Limits =====
export const CLAUDE_CHAT_MAX_TOKENS = readIntEnv("NOVA_CLAUDE_CHAT_MAX_TOKENS", 1200, {
  min: 1,
  max: 1_000_000,
});
export const SPOTIFY_INTENT_MAX_TOKENS = readIntEnv("NOVA_SPOTIFY_INTENT_MAX_TOKENS", 480, {
  min: 1,
  max: 1_000_000,
});
export const OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS = (() => {
  const preferred = String(process.env.NOVA_OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS || "").trim();
  const legacy = String(process.env.NOVA_OPENAI_TOOL_MAX_COMPLETION_TOKENS || "").trim();
  const selected = preferred || legacy || "2048";
  const parsed = Number.parseInt(selected, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 1_000_000) : 2048;
})();

// ===== Memory =====
export const MEMORY_FACT_MAX_CHARS = readIntEnv("NOVA_MEMORY_FACT_MAX_CHARS", 280, {
  min: 1,
  max: 100_000,
});

// ===== STT Model (Bug Fix: was hardcoded to gpt-4o-transcribe) =====
export const STT_MODEL = String(process.env.NOVA_STT_MODEL || "whisper-1").trim();

// ===== User Context & Bootstrap =====
export const USER_CONTEXT_ROOT = path.join(ROOT_WORKSPACE_DIR, ".agent", "user-context");
export const BOOTSTRAP_BASELINE_DIR = path.join(ROOT_WORKSPACE_DIR, "templates");
export const BOOTSTRAP_FILE_NAMES = ["SOUL.md", "USER.md", "AGENTS.md", "MEMORY.md", "IDENTITY.md"];

// ===== Skills =====
export const STARTER_SKILLS_CATALOG_VERSION = 2;
export const STARTER_SKILLS = [
  { name: "nova-core", description: "Default execution policy for runtime and cross-file implementation work with plan-first and verification gates." },
  { name: "research", description: "Deep factual research workflow for multi-source analysis, source conflicts, and confidence grading." },
  { name: "summarize", description: "Structured summarization workflow for URLs or text with metadata, risk notes, and confidence grading." },
  { name: "daily-briefing", description: "Concise daily briefing workflow combining memory context with date-fresh external updates and uncertainty labels." },
  { name: "pickup", description: "Rapid context rehydration workflow that checks repo state, running processes, and next actions before execution." },
  { name: "handoff", description: "Structured handoff workflow that captures status, risks, checks, and precise next steps for seamless continuation." },
];
export const STARTER_SKILL_META_FILE = ".meta.json";
export const STARTER_SKILL_NAMES = new Set(STARTER_SKILLS.map((s) => String(s.name || "").trim()));
export const SKILL_DISCOVERY_CACHE_TTL_MS = readIntEnv("NOVA_SKILL_DISCOVERY_CACHE_TTL_MS", 15000, {
  min: 0,
  max: 3_600_000,
});

// ===== Upgrade Module Index =====
export const UPGRADE_MODULE_INDEX = [
  "src/agent/runner/index.ts",
  "src/agent/queue/index.ts",
  "src/agent/system-prompt/index.ts",
  "src/agent/bootstrap/index.ts",
  "src/agent/tool-summaries/index.ts",
  "src/agent/compact/index.ts",
  "src/agent/history/index.ts",
  "src/session/key/index.ts",
  "src/session/store/index.ts",
  "src/session/resolve/index.ts",
  "src/session/lock/index.ts",
  "src/memory/manager/index.ts",
  "src/memory/hybrid/index.ts",
  "src/memory/chunker/index.ts",
  "src/memory/embeddings/index.ts",
  "src/tools/core/registry/index.ts",
  "src/tools/core/executor/index.ts",
  "src/tools/web/web-search/index.ts",
  "src/tools/web/web-fetch/index.ts",
  "src/tools/builtin/memory-tools.ts",
  "src/tools/builtin/exec.ts",
  "src/tools/builtin/file-tools.ts",
  "src/tools/runtime/runtime-compat/index.js",
  "src/skills/discovery.ts",
  "src/skills/formatter.ts",
  "src/skills/snapshot.ts",
  "src/config/index.ts",
  "src/config/types.ts",
];
