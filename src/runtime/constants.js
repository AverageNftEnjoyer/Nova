import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Base Paths =====
export const ROOT_DIR = __dirname;
export const ROOT_WORKSPACE_DIR = path.join(__dirname, "..", "..");
export const INTEGRATIONS_CONFIG_PATH = path.join(ROOT_WORKSPACE_DIR, "hud", "data", "integrations-config.json");
export const ENCRYPTION_KEY_PATH = path.join(ROOT_WORKSPACE_DIR, "hud", "data", ".nova_encryption_key");

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
export const TOOL_LOOP_MAX_STEPS = Number.parseInt(process.env.NOVA_TOOL_LOOP_MAX_STEPS || "6", 10);
export const TOOL_REGISTRY_ENABLED_TOOLS = String(
  process.env.NOVA_ENABLED_TOOLS ||
    "read,write,edit,ls,grep,exec,web_search,web_fetch,memory_search,memory_get",
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
export const TOOL_SAFE_BINARIES = String(
  process.env.NOVA_SAFE_BINARIES || "ls,cat,head,tail,grep,find,wc,sort,echo,pwd",
)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
export const TOOL_EXEC_APPROVAL_MODE = ["ask", "auto", "off"].includes(
  String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase(),
)
  ? String(process.env.NOVA_EXEC_APPROVAL_MODE || "ask").trim().toLowerCase()
  : "ask";
export const TOOL_WEB_SEARCH_PROVIDER = "brave";

// ===== Memory Paths =====
export const MEMORY_DB_PATH = path.join(ROOT_WORKSPACE_DIR, ".agent", "memory.db");
export const MEMORY_SOURCE_DIR = path.join(ROOT_WORKSPACE_DIR, "memory");

// ===== Session Config =====
export const SESSION_STORE_PATH = path.join(ROOT_WORKSPACE_DIR, ".agent", "sessions.json");
export const SESSION_TRANSCRIPT_DIR = path.join(ROOT_WORKSPACE_DIR, ".agent", "transcripts");
export const SESSION_MAX_TURNS = Number.parseInt(process.env.NOVA_SESSION_MAX_TURNS || "20", 10);
export const SESSION_IDLE_MINUTES = Number.parseInt(process.env.NOVA_SESSION_IDLE_MINUTES || "120", 10);
export const SESSION_MAIN_KEY = String(process.env.NOVA_SESSION_MAIN_KEY || "main").trim() || "main";

// ===== Request Timeouts =====
export const OPENAI_REQUEST_TIMEOUT_MS = 45000;

// ===== Voice/Mic Config =====
export const MIC_RECORD_SECONDS = Number.parseFloat(process.env.NOVA_MIC_RECORD_SECONDS || "4");
export const MIC_RETRY_SECONDS = Number.parseFloat(process.env.NOVA_MIC_RETRY_SECONDS || "2");
export const MIC_IDLE_DELAY_MS = Number.parseInt(process.env.NOVA_MIC_IDLE_DELAY_MS || "250", 10);
export const VOICE_WAKE_COOLDOWN_MS = Number.parseInt(process.env.NOVA_WAKE_COOLDOWN_MS || "1800", 10);
export const VOICE_POST_RESPONSE_GRACE_MS = Number.parseInt(process.env.NOVA_POST_RESPONSE_GRACE_MS || "900", 10);
export const VOICE_DUPLICATE_TEXT_COOLDOWN_MS = Number.parseInt(process.env.NOVA_DUPLICATE_TEXT_COOLDOWN_MS || "12000", 10);
export const VOICE_DUPLICATE_COMMAND_COOLDOWN_MS = Number.parseInt(process.env.NOVA_DUPLICATE_COMMAND_COOLDOWN_MS || "120000", 10);
export const VOICE_AFTER_WAKE_SUPPRESS_MS = Number.parseInt(process.env.NOVA_AFTER_WAKE_SUPPRESS_MS || "2500", 10);
export const VOICE_AFTER_TTS_SUPPRESS_MS = Number.parseInt(process.env.NOVA_AFTER_TTS_SUPPRESS_MS || "7000", 10);
export const WAKE_WORD = String(process.env.NOVA_WAKE_WORD || "nova").toLowerCase();
export const WAKE_WORD_VARIANTS = (process.env.NOVA_WAKE_WORD_VARIANTS || "nova")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

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

// ===== Token Limits =====
const DEFAULT_MAX_PROMPT_TOKENS = 6000;
const parsedMaxPromptTokens = Number.parseInt(
  process.env.NOVA_MAX_PROMPT_TOKENS || String(DEFAULT_MAX_PROMPT_TOKENS),
  10,
);
export const MAX_PROMPT_TOKENS =
  Number.isFinite(parsedMaxPromptTokens) && parsedMaxPromptTokens > 0
    ? parsedMaxPromptTokens
    : DEFAULT_MAX_PROMPT_TOKENS;

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
export const SESSION_MAX_HISTORY_TOKENS = Number.parseInt(
  process.env.NOVA_SESSION_MAX_HISTORY_TOKENS || "3200",
  10,
);
export const SESSION_TRANSCRIPTS_ENABLED =
  String(process.env.NOVA_SESSION_TRANSCRIPTS_ENABLED || "1").trim() !== "0";
export const SESSION_MAX_TRANSCRIPT_LINES = Number.parseInt(
  process.env.NOVA_SESSION_MAX_TRANSCRIPT_LINES || "400",
  10,
);
export const SESSION_TRANSCRIPT_RETENTION_DAYS = Number.parseInt(
  process.env.NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS || "30",
  10,
);

// ===== LLM Token Limits =====
export const CLAUDE_CHAT_MAX_TOKENS = Number.parseInt(
  process.env.NOVA_CLAUDE_CHAT_MAX_TOKENS || "1200",
  10,
);
export const SPOTIFY_INTENT_MAX_TOKENS = Number.parseInt(
  process.env.NOVA_SPOTIFY_INTENT_MAX_TOKENS || "480",
  10,
);
export const OPENAI_TOOL_LOOP_MAX_COMPLETION_TOKENS = Number.parseInt(
  process.env.NOVA_OPENAI_TOOL_MAX_COMPLETION_TOKENS || "2048",
  10,
);

// ===== Memory =====
export const MEMORY_FACT_MAX_CHARS = Number.parseInt(
  process.env.NOVA_MEMORY_FACT_MAX_CHARS || "280",
  10,
);

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
export const SKILL_DISCOVERY_CACHE_TTL_MS = Number.parseInt(
  process.env.NOVA_SKILL_DISCOVERY_CACHE_TTL_MS || "15000",
  10,
);

// ===== Upgrade Module Index =====
export const UPGRADE_MODULE_INDEX = [
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
];
