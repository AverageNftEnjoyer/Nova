// ===== Persona Context & Preflight =====
// Workspace resolution, integrations config snapshot, preflight logging,
// history trimming, and a cached integrations loader (Bug Fix 4).

import fs from "fs";
import path from "path";
import {
  ROOT_WORKSPACE_DIR,
  USER_CONTEXT_ROOT,
  BOOTSTRAP_BASELINE_DIR,
  BOOTSTRAP_FILE_NAMES,
  UPGRADE_MODULE_INDEX,
  ENABLE_PROVIDER_FALLBACK,
  RAW_STREAM_ENABLED,
  RAW_STREAM_PATH,
} from "../../core/constants.js";
import { sessionRuntime } from "../infrastructure/config.js";
import {
  describeUnknownError,
  loadIntegrationsRuntime,
  resolveConfiguredChatRuntime,
} from "../llm/providers.js";
import { countApproxTokens } from "../../core/context-prompt.js";

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
function readIntegrationsConfigSnapshot(userContextId = "") {
  const normalized = sessionRuntime.normalizeUserContextId(userContextId || "") || "anonymous";
  const filePath = path.join(USER_CONTEXT_ROOT, normalized, "integrations-config.json");
  if (!fs.existsSync(filePath)) return { exists: false, parsed: null, parseError: null, filePath };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { exists: true, parsed: JSON.parse(raw), parseError: null, filePath };
  } catch (err) {
    return { exists: true, parsed: null, parseError: describeUnknownError(err), filePath };
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
  const scopedContextIds = listScopedIntegrationContextIds();
  if (scopedContextIds.length === 0) {
    console.warn(`[Preflight] Missing user-scoped integrations config files under ${USER_CONTEXT_ROOT}.`);
    return;
  }

  let hasScopedReadyProvider = false;
  let hasScopedOpenAiKey = false;
  let scopedActiveExample = null;
  for (const contextId of scopedContextIds) {
    const snapshot = readIntegrationsConfigSnapshot(contextId);
    if (snapshot.parseError) {
      console.error(`[Preflight] Invalid scoped integrations config JSON (${contextId}): ${snapshot.parseError}`);
    }
    const miskeys = extractIntegrationMiskeys(snapshot.parsed);
    for (const hint of miskeys) console.warn(`[Preflight] (${contextId}) ${hint}`);

    const scopedRuntime = loadIntegrationsRuntime({ userContextId: contextId });
    const scopedActive = resolveConfiguredChatRuntime(scopedRuntime, { strictActiveProvider: !ENABLE_PROVIDER_FALLBACK });
    if (!scopedActiveExample) scopedActiveExample = scopedActive;
    if (scopedActive.connected && String(scopedActive.apiKey || "").trim()) hasScopedReadyProvider = true;
    if (String(scopedRuntime?.openai?.apiKey || "").trim()) hasScopedOpenAiKey = true;
    if (hasScopedReadyProvider && hasScopedOpenAiKey) break;
  }

  const activeProviderLabel = providerDisplayName(String(scopedActiveExample?.provider || "openai"));
  if (!hasScopedReadyProvider) {
    console.warn(`[Preflight] Active provider is ${activeProviderLabel} but no scoped API key is configured. Chat requests will fail until configured.`);
  }

  if (!hasScopedOpenAiKey) {
    console.warn("[Preflight] OpenAI key missing in scoped integrations. Voice transcription (STT) may fail.");
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
const _integrationWatcherKeys = new Set();

function resolveScopedIntegrationsConfigPath(userContextId = "") {
  const normalized = sessionRuntime.normalizeUserContextId(userContextId || "") || "anonymous";
  return path.join(USER_CONTEXT_ROOT, normalized, "integrations-config.json");
}

function ensureIntegrationsFileWatcher(userContextId = "") {
  const normalized = sessionRuntime.normalizeUserContextId(userContextId || "") || "anonymous";
  if (_integrationWatcherKeys.has(normalized)) return;
  const scopedPath = resolveScopedIntegrationsConfigPath(normalized);
  try {
    fs.watch(scopedPath, { persistent: false }, () => {
      _integrationsCache.delete(normalized);
    });
    _integrationWatcherKeys.add(normalized);
  } catch {
    // File may not exist yet; cache will still TTL-expire correctly.
  }
}

export function cachedLoadIntegrationsRuntime(opts = {}) {
  const cacheKey = sessionRuntime.normalizeUserContextId(opts.userContextId || "") || "anonymous";
  ensureIntegrationsFileWatcher(cacheKey);
  const now = Date.now();
  const entry = _integrationsCache.get(cacheKey);
  if (entry && now - entry.cachedAt < INTEGRATIONS_CACHE_TTL_MS) return entry.runtime;
  const runtime = loadIntegrationsRuntime({ ...opts, userContextId: cacheKey });
  _integrationsCache.set(cacheKey, { runtime, cachedAt: now });
  return runtime;
}
