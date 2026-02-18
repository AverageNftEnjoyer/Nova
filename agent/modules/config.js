// ===== Runtime Singletons =====
// Creates and exports the three long-lived runtime instances.
// All static constants are in ../constants.js — import from there directly.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createSessionRuntime } from "../runtime/session.js";
import { createToolRuntime } from "../runtime/tools-runtime.js";
import { createWakeWordRuntime } from "../runtime/voice.js";
import { describeUnknownError } from "./providers.js";
import {
  SESSION_STORE_PATH,
  SESSION_TRANSCRIPT_DIR,
  SESSION_IDLE_MINUTES,
  SESSION_MAIN_KEY,
  SESSION_TRANSCRIPTS_ENABLED,
  SESSION_MAX_TRANSCRIPT_LINES,
  SESSION_TRANSCRIPT_RETENTION_DAYS,
  TOOL_LOOP_ENABLED,
  MEMORY_LOOP_ENABLED,
  ROOT_WORKSPACE_DIR,
  MEMORY_DB_PATH,
  MEMORY_SOURCE_DIR,
  TOOL_REGISTRY_ENABLED_TOOLS,
  TOOL_EXEC_APPROVAL_MODE,
  TOOL_SAFE_BINARIES,
  TOOL_WEB_SEARCH_PROVIDER,
  WAKE_WORD,
  WAKE_WORD_VARIANTS,
} from "../constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (makes env vars available to any dynamic reads)
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

export const sessionRuntime = createSessionRuntime({
  sessionStorePath: SESSION_STORE_PATH,
  transcriptDir: SESSION_TRANSCRIPT_DIR,
  sessionIdleMinutes: SESSION_IDLE_MINUTES,
  sessionMainKey: SESSION_MAIN_KEY,
  transcriptsEnabled: SESSION_TRANSCRIPTS_ENABLED,
  maxTranscriptLines: SESSION_MAX_TRANSCRIPT_LINES,
  transcriptRetentionDays: SESSION_TRANSCRIPT_RETENTION_DAYS,
});

export const toolRuntime = createToolRuntime({
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

export const wakeWordRuntime = createWakeWordRuntime({
  wakeWord: WAKE_WORD,
  wakeWordVariants: WAKE_WORD_VARIANTS,
});
