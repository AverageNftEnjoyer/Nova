// ===== Persona Context & Preflight =====
// Workspace resolution, integrations config snapshot, preflight logging,
// history trimming, and a cached integrations loader (Bug Fix 4).

import fs from "fs";
import path from "path";
import {
  INTEGRATIONS_CONFIG_PATH,
  ROOT_WORKSPACE_DIR,
  USER_CONTEXT_ROOT,
  BOOTSTRAP_BASELINE_DIR,
  BOOTSTRAP_FILE_NAMES,
  UPGRADE_MODULE_INDEX,
  ENABLE_PROVIDER_FALLBACK,
  RAW_STREAM_ENABLED,
  RAW_STREAM_PATH,
} from "../constants.js";
import { sessionRuntime } from "./config.js";
import {
  describeUnknownError,
  loadIntegrationsRuntime,
  resolveConfiguredChatRuntime,
} from "./providers.js";
import { countApproxTokens } from "../runtime/context-prompt.js";

// ===== Persona workspace =====
export function resolvePersonaWorkspaceDir(userContextId) {
  const normalized = sessionRuntime.normalizeUserContextId(userContextId || "");
  const fallbackContextId = normalized || "anonymous";
  const fallbackDir = path.join(USER_CONTEXT_ROOT, fallbackContextId);
  if (!normalized) {
    try { fs.mkdirSync(fallbackDir, { recursive: true }); } catch {}
    return fallbackDir;
  }
  const userDir = fallbackDir;
  try {
    fs.mkdirSync(userDir, { recursive: true });
    for (const fileName of BOOTSTRAP_FILE_NAMES) {
      const targetPath = path.join(userDir, fileName);
      if (fs.existsSync(targetPath)) continue;
      const templatePath = path.join(BOOTSTRAP_BASELINE_DIR, fileName);
      if (!fs.existsSync(templatePath)) continue;
      fs.copyFileSync(templatePath, targetPath);
    }
    return userDir;
  } catch (err) {
    console.warn(`[Persona] Failed preparing per-user workspace for ${normalized}: ${describeUnknownError(err)}`);
    return fallbackDir;
  }
}

// ===== Raw stream logging =====
export function appendRawStream(event) {
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

// ===== Upgrade module index =====
export function scanUpgradeModuleIndex() {
  const root = path.join(ROOT_WORKSPACE_DIR);
  const found = [];
  const missing = [];
  for (const relPath of UPGRADE_MODULE_INDEX) {
    const absPath = path.join(root, relPath);
    if (fs.existsSync(absPath)) found.push(relPath);
    else missing.push(relPath);
  }
  return { found, missing };
}

export function logUpgradeIndexSummary() {
  const scan = scanUpgradeModuleIndex();
  console.log(`[UpgradeIndex] runtime modules indexed: ${scan.found.length}/${UPGRADE_MODULE_INDEX.length}`);
  if (scan.missing.length > 0) console.warn(`[UpgradeIndex] Missing modules: ${scan.missing.join(", ")}`);
}

// ===== Preflight diagnostics =====
function readIntegrationsConfigSnapshot() {
  if (!fs.existsSync(INTEGRATIONS_CONFIG_PATH)) return { exists: false, parsed: null, parseError: null };
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
  if (Object.prototype.hasOwnProperty.call(parsed, "activeProvider"))
    hints.push('Found legacy "activeProvider". Expected "activeLlmProvider".');
  if (Object.prototype.hasOwnProperty.call(parsed, "defaultModel"))
    hints.push('Found top-level "defaultModel". Expected provider-specific defaultModel fields.');
  if (Object.prototype.hasOwnProperty.call(parsed, "openaiApiKey"))
    hints.push('Found legacy "openaiApiKey". Expected "openai.apiKey".');
  return hints;
}

function listScopedIntegrationContextIds() {
  try {
    if (!fs.existsSync(USER_CONTEXT_ROOT)) return [];
    const entries = fs.readdirSync(USER_CONTEXT_ROOT, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
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

export function logAgentRuntimePreflight() {
  const snapshot = readIntegrationsConfigSnapshot();
  const scopedContextIds = listScopedIntegrationContextIds();
  if (!snapshot.exists && scopedContextIds.length === 0) {
    console.warn(`[Preflight] Missing integrations config at ${INTEGRATIONS_CONFIG_PATH}`);
    return;
  }
  if (snapshot.parseError) console.error(`[Preflight] Invalid integrations config JSON: ${snapshot.parseError}`);

  const miskeys = extractIntegrationMiskeys(snapshot.parsed);
  for (const hint of miskeys) console.warn(`[Preflight] ${hint}`);

  const runtime = loadIntegrationsRuntime();
  const active = resolveConfiguredChatRuntime(runtime, { strictActiveProvider: !ENABLE_PROVIDER_FALLBACK });

  let hasScopedReadyProvider = false;
  let hasScopedOpenAiKey = false;
  for (const contextId of scopedContextIds) {
    const scopedRuntime = loadIntegrationsRuntime({ userContextId: contextId });
    const scopedActive = resolveConfiguredChatRuntime(scopedRuntime, { strictActiveProvider: !ENABLE_PROVIDER_FALLBACK });
    if (scopedActive.connected && String(scopedActive.apiKey || "").trim()) hasScopedReadyProvider = true;
    if (String(scopedRuntime?.openai?.apiKey || "").trim()) hasScopedOpenAiKey = true;
    if (hasScopedReadyProvider && hasScopedOpenAiKey) break;
  }

  const globalActiveReady = active.connected && String(active.apiKey || "").trim().length > 0;
  if (!globalActiveReady && !hasScopedReadyProvider) {
    console.warn(`[Preflight] Active provider is ${providerDisplayName(active.provider)} but no API key is configured. Chat requests will fail until configured.`);
  } else if (!globalActiveReady && hasScopedReadyProvider) {
    console.log("[Preflight] Global integrations are missing an active provider key, but user-scoped runtime keys were found.");
  }

  const globalOpenAiKey = String(runtime.openai.apiKey || "").trim();
  if (!globalOpenAiKey && !hasScopedOpenAiKey) {
    console.warn("[Preflight] OpenAI key missing. Voice transcription (STT) may fail.");
  } else if (!globalOpenAiKey && hasScopedOpenAiKey) {
    console.log("[Preflight] OpenAI key found in user-scoped runtime; global STT fallback key is not configured.");
  }
}

// ===== History trimmer =====
export function trimHistoryMessagesByTokenBudget(messages, maxTokens) {
  if (!Array.isArray(messages) || messages.length === 0) return { messages: [], trimmed: 0, tokens: 0 };
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 0;
  if (budget <= 0) return { messages: [], trimmed: messages.length, tokens: 0 };

  const tokenPerMessage = messages.map((msg) =>
    countApproxTokens(`${String(msg?.role || "user")}: ${String(msg?.content || "")}`),
  );
  let tokens = tokenPerMessage.reduce((sum, v) => sum + v, 0);
  if (tokens <= budget) return { messages, trimmed: 0, tokens };

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
  return { messages: kept, trimmed: start, tokens: keptTokens };
}

// ===== Bug Fix 4: Cached integrations loader =====
// Avoids disk reads on every chat request; TTL 60s + fs.watch invalidation.
const INTEGRATIONS_CACHE_TTL_MS = 60_000;
const _integrationsCache = new Map();
let _fileWatcherActive = false;

function ensureIntegrationsFileWatcher() {
  if (_fileWatcherActive) return;
  try {
    fs.watch(INTEGRATIONS_CONFIG_PATH, { persistent: false }, () => {
      _integrationsCache.clear();
    });
    _fileWatcherActive = true;
  } catch {
    // File may not exist yet; cache will still TTL-expire correctly.
  }
}

export function cachedLoadIntegrationsRuntime(opts = {}) {
  ensureIntegrationsFileWatcher();
  const cacheKey = String(opts.userContextId || "");
  const now = Date.now();
  const entry = _integrationsCache.get(cacheKey);
  if (entry && now - entry.cachedAt < INTEGRATIONS_CACHE_TTL_MS) return entry.runtime;
  const runtime = loadIntegrationsRuntime(opts);
  _integrationsCache.set(cacheKey, { runtime, cachedAt: now });
  return runtime;
}
