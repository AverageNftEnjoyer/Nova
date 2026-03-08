import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "./types/index.js";

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".myagent", "config.json");
const RESERVED_SRC_USER_ENTRY = ".user";
const RESERVED_SRC_USER_SENTINEL = [
  "Reserved path: Nova user state must live at /.user, never at /src/.user.",
  "Do not replace this file with a directory.",
  "",
].join("\n");

function resolveWorkspaceRoot(startPath: string): string {
  const fallback = path.resolve(String(startPath || process.cwd() || "."));
  let current = fallback;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, "hud")) && fs.existsSync(path.join(current, "src"))) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return fallback;
}

function resolveReservedSrcUserPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), "src", RESERVED_SRC_USER_ENTRY);
}

function normalizePathForCompare(value: string): string {
  return path.resolve(String(value || ""))
    .replace(/\//g, path.sep)
    .toLowerCase();
}

function isReservedPathOrChild(candidatePath: string, reservedPath: string): boolean {
  const normalizedCandidate = normalizePathForCompare(candidatePath);
  const normalizedReserved = normalizePathForCompare(reservedPath);
  return normalizedCandidate === normalizedReserved || normalizedCandidate.startsWith(`${normalizedReserved}${path.sep}`);
}

function assertWorkspaceUserRoot(workspaceRoot: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const reservedSrcUserPath = resolveReservedSrcUserPath(normalizedRoot);
  if (fs.existsSync(reservedSrcUserPath)) {
    const stat = fs.lstatSync(reservedSrcUserPath);
    if (stat.isDirectory()) {
      throw new Error(`Invalid duplicate user state root detected at ${reservedSrcUserPath}. Use ${path.join(normalizedRoot, ".user")} only.`);
    }
    if (!stat.isFile()) {
      throw new Error(`Reserved workspace path ${reservedSrcUserPath} must remain a file.`);
    }
  } else {
    fs.writeFileSync(reservedSrcUserPath, RESERVED_SRC_USER_SENTINEL, {
      encoding: "utf8",
      flag: "wx",
    });
  }
  return normalizedRoot;
}

function assertNotUnderReservedSrcUserPath(candidatePath: string, workspaceRoot: string, label: string): string {
  const resolvedPath = path.resolve(candidatePath);
  const reservedSrcUserPath = resolveReservedSrcUserPath(workspaceRoot);
  if (isReservedPathOrChild(resolvedPath, reservedSrcUserPath)) {
    throw new Error(`${label} may not resolve under ${reservedSrcUserPath}. Nova user state must stay under ${path.join(workspaceRoot, ".user")}.`);
  }
  return resolvedPath;
}

const DEFAULT_WORKSPACE_ROOT = assertWorkspaceUserRoot(resolveWorkspaceRoot(process.cwd()));

const DEFAULT_CONFIG: Config = {
  agent: {
    name: "nova",
    workspace: DEFAULT_WORKSPACE_ROOT,
    model: "claude-sonnet-4-5-20250514",
    maxTokens: 2048,
    apiKey: "",
    bootstrapMaxChars: 20_000,
    bootstrapTotalMaxChars: 24_000,
  },
  session: {
    scope: "per-channel-peer",
    dmScope: "main",
    storePath: path.join(DEFAULT_WORKSPACE_ROOT, ".user", "sessions.json"),
    transcriptDir: path.join(DEFAULT_WORKSPACE_ROOT, ".user", "transcripts"),
    userContextRoot: path.join(DEFAULT_WORKSPACE_ROOT, ".user", "user-context"),
    mainKey: "main",
    resetMode: "idle",
    resetAtHour: 4,
    idleMinutes: 120,
    maxHistoryTurns: 50,
    dmHistoryTurns: 100,
    transcriptsEnabled: true,
    maxTranscriptLines: 400,
    transcriptRetentionDays: 30,
  },
  memory: {
    enabled: false,
    dbPath: path.join(DEFAULT_WORKSPACE_ROOT, ".user", "memory.db"),
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingApiKey: "",
    chunkSize: 400,
    chunkOverlap: 80,
    hybridVectorWeight: 0.7,
    hybridBm25Weight: 0.3,
    topK: 5,
    syncOnSessionStart: true,
    sourceDirs: [path.join(DEFAULT_WORKSPACE_ROOT, "memory")],
  },
  tools: {
    enabledTools: ["read", "write", "edit", "ls", "grep", "exec", "browser_agent", "web_search", "web_fetch"],
    execApprovalMode: "ask",
    safeBinaries: ["ls", "cat", "head", "tail", "grep", "find", "wc", "sort", "echo", "pwd"],
    webSearchProvider: "brave",
    webSearchApiKey: "",
  },
};

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIntInRange(
  value: string | undefined,
  fallback: number,
  minValue: number,
  maxValue: number,
): number {
  const parsed = Math.floor(toNumber(value, fallback));
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function toFloatInRange(
  value: string | undefined,
  fallback: number,
  minValue: number,
  maxValue: number,
): number {
  const parsed = toNumber(value, fallback);
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function splitCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value || !value.trim()) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (!value) return fallback;
  const normalized = value.trim();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

function resolveEnvOverrides(base: Config): Partial<Config> {
  const env = process.env;
  // Nova-only environment overrides.
  return {
    agent: {
      ...base.agent,
      name: env.NOVA_AGENT_NAME ?? base.agent.name,
      workspace: env.NOVA_WORKSPACE ?? base.agent.workspace,
      model: env.NOVA_MODEL ?? base.agent.model,
      maxTokens: toIntInRange(env.NOVA_MAX_TOKENS, base.agent.maxTokens, 1, 1_000_000),
      apiKey: base.agent.apiKey,
      bootstrapMaxChars: toIntInRange(
        env.NOVA_BOOTSTRAP_MAX_CHARS,
        base.agent.bootstrapMaxChars,
        1_000,
        5_000_000,
      ),
      bootstrapTotalMaxChars: toIntInRange(
        env.NOVA_BOOTSTRAP_TOTAL_MAX_CHARS,
        base.agent.bootstrapTotalMaxChars,
        1_000,
        5_000_000,
      ),
    },
    session: {
      ...base.session,
      scope: pickEnum(
        env.NOVA_SESSION_SCOPE,
        ["per-sender", "per-channel", "per-channel-peer"],
        base.session.scope,
      ),
      dmScope: pickEnum(
        env.NOVA_DM_SCOPE,
        ["main", "per-channel-peer"],
        base.session.dmScope,
      ),
      storePath: env.NOVA_SESSION_STORE_PATH ?? base.session.storePath,
      transcriptDir: env.NOVA_TRANSCRIPT_DIR ?? base.session.transcriptDir,
      userContextRoot: env.NOVA_USER_CONTEXT_ROOT ?? base.session.userContextRoot,
      mainKey: env.NOVA_SESSION_MAIN_KEY ?? base.session.mainKey,
      resetMode: pickEnum(
        env.NOVA_RESET_MODE,
        ["daily", "idle", "manual"],
        base.session.resetMode,
      ),
      resetAtHour: toIntInRange(env.NOVA_RESET_AT_HOUR, base.session.resetAtHour, 0, 23),
      idleMinutes: toIntInRange(env.NOVA_SESSION_IDLE_MINUTES, base.session.idleMinutes, 1, 10_080),
      maxHistoryTurns: toIntInRange(
        env.NOVA_SESSION_MAX_TURNS,
        base.session.maxHistoryTurns,
        1,
        10_000,
      ),
      dmHistoryTurns: toIntInRange(
        env.NOVA_DM_HISTORY_TURNS,
        base.session.dmHistoryTurns,
        1,
        10_000,
      ),
      transcriptsEnabled: toBoolean(
        env.NOVA_SESSION_TRANSCRIPTS_ENABLED,
        base.session.transcriptsEnabled,
      ),
      maxTranscriptLines: toIntInRange(
        env.NOVA_SESSION_MAX_TRANSCRIPT_LINES,
        base.session.maxTranscriptLines,
        1,
        1_000_000,
      ),
      transcriptRetentionDays: toIntInRange(
        env.NOVA_SESSION_TRANSCRIPT_RETENTION_DAYS,
        base.session.transcriptRetentionDays,
        1,
        3_650,
      ),
    },
    memory: {
      ...base.memory,
      enabled: toBoolean(env.NOVA_MEMORY_ENABLED, base.memory.enabled),
      dbPath: env.NOVA_MEMORY_DB_PATH ?? base.memory.dbPath,
      embeddingProvider: pickEnum(
        env.NOVA_EMBEDDING_PROVIDER,
        ["openai", "local"],
        base.memory.embeddingProvider,
      ),
      embeddingModel: env.NOVA_EMBEDDING_MODEL ?? base.memory.embeddingModel,
      embeddingApiKey: base.memory.embeddingApiKey,
      chunkSize: toIntInRange(env.NOVA_MEMORY_CHUNK_SIZE, base.memory.chunkSize, 1, 100_000),
      chunkOverlap: toIntInRange(env.NOVA_MEMORY_CHUNK_OVERLAP, base.memory.chunkOverlap, 0, 50_000),
      hybridVectorWeight: toFloatInRange(
        env.NOVA_MEMORY_VECTOR_WEIGHT,
        base.memory.hybridVectorWeight,
        0,
        1,
      ),
      hybridBm25Weight: toFloatInRange(
        env.NOVA_MEMORY_BM25_WEIGHT,
        base.memory.hybridBm25Weight,
        0,
        1,
      ),
      topK: toIntInRange(env.NOVA_MEMORY_TOP_K, base.memory.topK, 1, 1_000),
      syncOnSessionStart: toBoolean(env.NOVA_MEMORY_SYNC_ON_START, base.memory.syncOnSessionStart),
      sourceDirs: splitCsv(env.NOVA_MEMORY_SOURCE_DIRS, base.memory.sourceDirs),
    },
    tools: {
      ...base.tools,
      enabledTools: splitCsv(env.NOVA_ENABLED_TOOLS, base.tools.enabledTools),
      execApprovalMode: pickEnum(
        env.NOVA_EXEC_APPROVAL_MODE,
        ["ask", "auto", "off"],
        base.tools.execApprovalMode,
      ),
      safeBinaries: splitCsv(env.NOVA_SAFE_BINARIES, base.tools.safeBinaries),
      webSearchProvider: "brave",
      webSearchApiKey: base.tools.webSearchApiKey,
    },
  };
}

function normalizePaths(config: Config): Config {
  const workspace = assertWorkspaceUserRoot(resolveWorkspaceRoot(config.agent.workspace));
  return {
    ...config,
    agent: {
      ...config.agent,
      workspace,
    },
    session: {
      ...config.session,
      storePath: assertNotUnderReservedSrcUserPath(config.session.storePath, workspace, "session.storePath"),
      transcriptDir: assertNotUnderReservedSrcUserPath(config.session.transcriptDir, workspace, "session.transcriptDir"),
      userContextRoot: assertNotUnderReservedSrcUserPath(config.session.userContextRoot, workspace, "session.userContextRoot"),
    },
    memory: {
      ...config.memory,
      dbPath: assertNotUnderReservedSrcUserPath(config.memory.dbPath, workspace, "memory.dbPath"),
      sourceDirs: config.memory.sourceDirs.map((dir) => assertNotUnderReservedSrcUserPath(path.resolve(workspace, dir), workspace, "memory.sourceDirs")),
    },
  };
}

export function loadConfig(configPath = DEFAULT_CONFIG_PATH): Config {
  const fileConfig = readJsonFile<Partial<Config>>(configPath) ?? {};
  const mergedFromFile = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    fileConfig as unknown as Record<string, unknown>,
  ) as unknown as Config;
  const envOverrides = resolveEnvOverrides(mergedFromFile);
  const merged = deepMerge(
    mergedFromFile as unknown as Record<string, unknown>,
    envOverrides as unknown as Record<string, unknown>,
  ) as unknown as Config;
  return normalizePaths(merged);
}

export { DEFAULT_CONFIG_PATH };

