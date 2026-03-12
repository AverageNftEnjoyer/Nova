import fs from "fs";
import path from "path";
import { createDecipheriv, createHash } from "crypto";
import OpenAI from "openai";
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GROK_MODEL,
  DEFAULT_GEMINI_MODEL,
  OPENAI_REQUEST_TIMEOUT_MS,
  OPENAI_MODEL_PRICING_USD_PER_1M,
  CLAUDE_MODEL_PRICING_USD_PER_1M
} from "../../runtime/core/constants/index.js";
import { enforceWorkspaceUserStateInvariant } from "../../runtime/core/workspace-user-root/index.js";

// ===== Client Cache =====
const openAiClientCache = new Map();
const USER_CONTEXT_INTEGRATIONS_FILE = "integrations-config.json";
const USER_CONTEXT_STATE_DIR = "state";

export function resolveRuntimePaths(workspaceRoot = process.cwd()) {
  const invariant = enforceWorkspaceUserStateInvariant(workspaceRoot);
  return {
    workspaceRoot: invariant.workspaceRoot,
    integrationsConfigPath: path.join(invariant.workspaceRoot, "hud", "data", "integrations-config.json"),
    userContextRoot: invariant.userContextRoot,
    hudRoot: path.join(invariant.workspaceRoot, "hud"),
  };
}

// ===== Error Helpers =====
export function describeUnknownError(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function toErrorDetails(err) {
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

// ===== Encryption =====
function deriveEncryptionKeyMaterial(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(raw).digest();
}

function parseDotenvForKey(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
      if (!normalized.startsWith(`${key}=`)) continue;
      const value = normalized.slice(key.length + 1).trim();
      if (!value) return "";
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1).trim();
      }
      return value;
    }
  } catch {}
  return "";
}

function resolveEncryptionKeyCandidates(runtimePaths = resolveRuntimePaths()) {
  const candidates = [];
  const envKey = String(process.env.NOVA_ENCRYPTION_KEY || "").trim();
  if (envKey) candidates.push(envKey);
  const fallbackRaw = String(process.env.NOVA_ENCRYPTION_KEY_FALLBACKS || "").trim();
  if (fallbackRaw) {
    for (const entry of fallbackRaw.split(/[,\n]/).map((v) => v.trim()).filter(Boolean)) {
      candidates.push(entry);
    }
  }
  const root = String(runtimePaths?.workspaceRoot || resolveRuntimePaths().workspaceRoot);
  const dotenvPaths = [
    path.join(root, ".env"),
    path.join(root, ".env.local"),
    path.join(root, "hud", ".env.local"),
  ];
  for (const dotenvPath of dotenvPaths) {
    const key = parseDotenvForKey(dotenvPath, "NOVA_ENCRYPTION_KEY");
    if (key) candidates.push(key);
  }
  for (const dotenvPath of dotenvPaths) {
    const fallback = parseDotenvForKey(dotenvPath, "NOVA_ENCRYPTION_KEY_FALLBACKS");
    if (!fallback) continue;
    for (const entry of fallback.split(/[,\n]/).map((v) => v.trim()).filter(Boolean)) {
      candidates.push(entry);
    }
  }
  return candidates;
}

export function getEncryptionKeyMaterials(runtimePaths = resolveRuntimePaths()) {
  const candidates = resolveEncryptionKeyCandidates(runtimePaths);

  const materials = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const material = deriveEncryptionKeyMaterial(normalized);
    if (material) {
      materials.push(material);
    }
  }
  return materials;
}

export function decryptStoredSecret(payload, runtimePaths = resolveRuntimePaths()) {
  const input = String(payload || "").trim();
  if (!input) return "";
  const parts = input.split(".");
  if (parts.length !== 3) return "";
  const keyMaterials = getEncryptionKeyMaterials(runtimePaths);
  if (keyMaterials.length === 0) return "";
  for (const key of keyMaterials) {
    try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const enc = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]);
    return out.toString("utf8");
    } catch {}
  }
  return "";
}

export function unwrapStoredSecret(value, runtimePaths = resolveRuntimePaths()) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const decrypted = decryptStoredSecret(raw, runtimePaths);
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

// ===== URL Helpers =====
export function toOpenAiLikeBase(baseUrl, fallbackBaseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return fallbackBaseUrl;
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function toClaudeBase(baseURL) {
  const trimmed = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_CLAUDE_BASE_URL;
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

// ===== Timeout Helper =====
export function withTimeout(promiseOrFactory, ms, label = "request", opts = {}) {
  let timer = null;
  let finished = false;
  const timeoutMs = Math.max(1, Number.parseInt(String(ms || 0), 10) || 1);
  const timeoutMessage = `${label} timed out after ${timeoutMs}ms`;
  const controller = new AbortController();
  const onTimeout = typeof opts?.onTimeout === "function" ? opts.onTimeout : null;
  const promise = typeof promiseOrFactory === "function"
    ? promiseOrFactory({ signal: controller.signal })
    : promiseOrFactory;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (finished) return;
      controller.abort(new Error(timeoutMessage));
      try {
        if (onTimeout) onTimeout();
      } catch {}
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    finished = true;
    if (timer) clearTimeout(timer);
  });
}

// ===== Load Integrations Config =====
function normalizeUserContextId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function requireUserContextId(value, operation) {
  const normalized = normalizeUserContextId(value);
  if (!normalized) throw new Error(`${String(operation || "runtime")} requires userContextId.`);
  return normalized;
}

function resolveIntegrationsConfigPath(userContextId, runtimePaths = resolveRuntimePaths()) {
  const normalized = requireUserContextId(userContextId, "resolveIntegrationsConfigPath");
  const userContextRoot = String(runtimePaths?.userContextRoot || resolveRuntimePaths().userContextRoot);
  return path.join(
    userContextRoot,
    normalized,
    USER_CONTEXT_STATE_DIR,
    USER_CONTEXT_INTEGRATIONS_FILE,
  );
}

function resolveProviderApiKey(integrationApiKey, runtimePaths = resolveRuntimePaths()) {
  const fromIntegration = unwrapStoredSecret(integrationApiKey, runtimePaths);
  return String(fromIntegration || "").trim();
}

function resolveProviderConnectedState(connectedFlag, apiKey) {
  return Boolean(connectedFlag) && String(apiKey || "").trim().length > 0;
}

function toStringArray(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of input) {
    const value = String(entry || "").trim();
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(value);
  }
  return out;
}

function parseGmailRuntime(value, runtimePaths = resolveRuntimePaths()) {
  const integration = value && typeof value === "object" ? value : {};
  const accountsInput = Array.isArray(integration.accounts) ? integration.accounts : [];
  const accounts = accountsInput
    .map((entry) => {
      const account = entry && typeof entry === "object" ? entry : {};
      return {
        id: String(account.id || "").trim(),
        email: String(account.email || "").trim(),
        enabled: account.enabled === true,
        scopes: toStringArray(account.scopes),
        accessToken: unwrapStoredSecret(account.accessToken, runtimePaths) || "",
        tokenExpiry: Number.isFinite(Number(account.tokenExpiry))
          ? Math.max(0, Math.floor(Number(account.tokenExpiry)))
          : 0,
      };
    })
    .filter((account) =>
      String(account.id || "").trim() ||
      String(account.email || "").trim() ||
      (Array.isArray(account.scopes) && account.scopes.length > 0),
    );
  return {
    connected: integration.connected === true,
    activeAccountId: String(integration.activeAccountId || "").trim(),
    email: String(integration.email || "").trim(),
    scopes: toStringArray(integration.scopes),
    accessToken: unwrapStoredSecret(integration.accessToken, runtimePaths) || "",
    tokenExpiry: Number.isFinite(Number(integration.tokenExpiry))
      ? Math.max(0, Math.floor(Number(integration.tokenExpiry)))
      : 0,
    accounts,
  };
}

function parseSpotifyRuntime(value) {
  const integration = value && typeof value === "object" ? value : {};
  return {
    connected: integration.connected === true,
    spotifyUserId: String(integration.spotifyUserId || "").trim(),
    displayName: String(integration.displayName || "").trim(),
    scopes: toStringArray(integration.scopes),
  };
}

function parsePhantomRuntime(value) {
  const integration = value && typeof value === "object" ? value : {};
  const preferences = integration.preferences && typeof integration.preferences === "object"
    ? integration.preferences
    : {};
  const capabilities = integration.capabilities && typeof integration.capabilities === "object"
    ? integration.capabilities
    : {};
  const connected = integration.connected === true;
  const verifiedAt = String(integration.verifiedAt || "").trim();
  const evmAddress = String(integration.evmAddress || "").trim();
  return {
    connected,
    provider: "phantom",
    chain: "solana",
    walletAddress: String(integration.walletAddress || "").trim(),
    walletLabel: String(integration.walletLabel || "").trim(),
    connectedAt: String(integration.connectedAt || "").trim(),
    verifiedAt,
    lastDisconnectedAt: String(integration.lastDisconnectedAt || "").trim(),
    evmAddress,
    evmLabel: String(integration.evmLabel || "").trim(),
    evmChainId: String(integration.evmChainId || "").trim(),
    evmConnectedAt: String(integration.evmConnectedAt || "").trim(),
    preferences: {
      allowAgentWalletContext: preferences.allowAgentWalletContext !== false,
      allowAgentEvmContext: preferences.allowAgentEvmContext !== false,
      allowApprovalGatedPolymarket: preferences.allowApprovalGatedPolymarket !== false,
    },
    capabilities: {
      signMessage: capabilities.signMessage !== false,
      walletOwnershipProof: capabilities.walletOwnershipProof !== false,
      solanaConnected: capabilities.solanaConnected === true || connected,
      solanaVerified: capabilities.solanaVerified === true || (connected && verifiedAt.length > 0),
      evmAvailable: capabilities.evmAvailable === true || evmAddress.length > 0,
      approvalGatedPolymarket: capabilities.approvalGatedPolymarket !== false,
      approvalGatedPolymarketReady: capabilities.approvalGatedPolymarketReady === true || (connected && evmAddress.length > 0),
      autonomousTrading: capabilities.autonomousTrading === true,
    },
  };
}

function parsePolymarketRuntime(value) {
  const integration = value && typeof value === "object" ? value : {};
  const connected = integration.connected === true;
  const walletAddress = String(integration.walletAddress || "").trim().toLowerCase();
  const profileAddress = String(integration.profileAddress || "").trim().toLowerCase();
  const positionsAddress = String(integration.positionsAddress || profileAddress || walletAddress).trim().toLowerCase();
  const signatureType = Number.isFinite(Number(integration.signatureType))
    ? Math.max(0, Math.min(2, Math.floor(Number(integration.signatureType))))
    : 0;
  return {
    connected,
    walletAddress: connected ? walletAddress : "",
    profileAddress: connected ? profileAddress : "",
    positionsAddress: connected ? positionsAddress : "",
    username: connected ? String(integration.username || "").trim() : "",
    pseudonym: connected ? String(integration.pseudonym || "").trim() : "",
    profileImageUrl: connected ? String(integration.profileImageUrl || "").trim() : "",
    signatureType,
    liveTradingEnabled: connected && integration.liveTradingEnabled === true,
    lastConnectedAt: connected ? String(integration.lastConnectedAt || "").trim() : "",
    lastProfileSyncAt: connected ? String(integration.lastProfileSyncAt || "").trim() : "",
  };
}

export function loadIntegrationsRuntime(options = {}) {
  const runtimePaths = resolveRuntimePaths(options.workspaceRoot);
  const resolvedUserContextId = requireUserContextId(options.userContextId || "", "loadIntegrationsRuntime");
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, runtimePaths);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const openaiIntegration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const claudeIntegration = parsed?.claude && typeof parsed.claude === "object" ? parsed.claude : {};
    const grokIntegration = parsed?.grok && typeof parsed.grok === "object" ? parsed.grok : {};
    const geminiIntegration = parsed?.gemini && typeof parsed.gemini === "object" ? parsed.gemini : {};
    const phantomIntegration = parsePhantomRuntime(parsed?.phantom);
    const polymarketIntegration = parsePolymarketRuntime(parsed?.polymarket);
    const spotifyIntegration = parseSpotifyRuntime(parsed?.spotify);
    const gmailIntegration = parseGmailRuntime(parsed?.gmail, runtimePaths);
    const activeProvider = parsed?.activeLlmProvider === "claude"
      ? "claude"
      : parsed?.activeLlmProvider === "grok"
        ? "grok"
        : parsed?.activeLlmProvider === "gemini"
          ? "gemini"
          : parsed?.activeLlmProvider === "openai"
            ? "openai"
            : "openai";
    const openaiApiKey = resolveProviderApiKey(openaiIntegration.apiKey, runtimePaths);
    const claudeApiKey = resolveProviderApiKey(claudeIntegration.apiKey, runtimePaths);
    const grokApiKey = resolveProviderApiKey(grokIntegration.apiKey, runtimePaths);
    const geminiApiKey = resolveProviderApiKey(geminiIntegration.apiKey, runtimePaths);
    return {
      sourcePath: configPath,
      activeProvider,
      openai: {
        connected: resolveProviderConnectedState(openaiIntegration.connected, openaiApiKey),
        apiKey: openaiApiKey,
        baseURL: toOpenAiLikeBase(openaiIntegration.baseUrl, DEFAULT_OPENAI_BASE_URL),
        model: typeof openaiIntegration.defaultModel === "string" && openaiIntegration.defaultModel.trim()
          ? openaiIntegration.defaultModel.trim()
          : DEFAULT_CHAT_MODEL
      },
      claude: {
        connected: resolveProviderConnectedState(claudeIntegration.connected, claudeApiKey),
        apiKey: claudeApiKey,
        baseURL: typeof claudeIntegration.baseUrl === "string" && claudeIntegration.baseUrl.trim()
          ? claudeIntegration.baseUrl.trim().replace(/\/+$/, "")
          : DEFAULT_CLAUDE_BASE_URL,
        model: typeof claudeIntegration.defaultModel === "string" && claudeIntegration.defaultModel.trim()
          ? claudeIntegration.defaultModel.trim()
          : DEFAULT_CLAUDE_MODEL
      },
      grok: {
        connected: resolveProviderConnectedState(grokIntegration.connected, grokApiKey),
        apiKey: grokApiKey,
        baseURL: toOpenAiLikeBase(grokIntegration.baseUrl, DEFAULT_GROK_BASE_URL),
        model: typeof grokIntegration.defaultModel === "string" && grokIntegration.defaultModel.trim()
          ? grokIntegration.defaultModel.trim()
          : DEFAULT_GROK_MODEL
      },
      gemini: {
        connected: resolveProviderConnectedState(geminiIntegration.connected, geminiApiKey),
        apiKey: geminiApiKey,
        baseURL: toOpenAiLikeBase(geminiIntegration.baseUrl, DEFAULT_GEMINI_BASE_URL),
        model: typeof geminiIntegration.defaultModel === "string" && geminiIntegration.defaultModel.trim()
          ? geminiIntegration.defaultModel.trim()
          : DEFAULT_GEMINI_MODEL
      },
      phantom: phantomIntegration,
      polymarket: polymarketIntegration,
      spotify: spotifyIntegration,
      gmail: gmailIntegration
    };
  } catch {
    const activeProvider = "openai";
    return {
      sourcePath: configPath,
      activeProvider,
      openai: { connected: false, apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL },
      claude: { connected: false, apiKey: "", baseURL: DEFAULT_CLAUDE_BASE_URL, model: DEFAULT_CLAUDE_MODEL },
      grok: { connected: false, apiKey: "", baseURL: DEFAULT_GROK_BASE_URL, model: DEFAULT_GROK_MODEL },
      gemini: { connected: false, apiKey: "", baseURL: DEFAULT_GEMINI_BASE_URL, model: DEFAULT_GEMINI_MODEL },
      phantom: {
        connected: false,
        provider: "phantom",
        chain: "solana",
        walletAddress: "",
        walletLabel: "",
        connectedAt: "",
        verifiedAt: "",
        lastDisconnectedAt: "",
        evmAddress: "",
        evmLabel: "",
        evmChainId: "",
        evmConnectedAt: "",
        preferences: {
          allowAgentWalletContext: true,
          allowAgentEvmContext: true,
          allowApprovalGatedPolymarket: true,
        },
        capabilities: {
          signMessage: true,
          walletOwnershipProof: true,
          solanaConnected: false,
          solanaVerified: false,
          evmAvailable: false,
          approvalGatedPolymarket: true,
          approvalGatedPolymarketReady: false,
          autonomousTrading: false,
        },
      },
      polymarket: {
        connected: false,
        walletAddress: "",
        profileAddress: "",
        positionsAddress: "",
        username: "",
        pseudonym: "",
        profileImageUrl: "",
        signatureType: 0,
        liveTradingEnabled: false,
        lastConnectedAt: "",
        lastProfileSyncAt: "",
      },
      spotify: {
        connected: false,
        spotifyUserId: "",
        displayName: "",
        scopes: [],
      },
      gmail: {
        connected: false,
        activeAccountId: "",
        email: "",
        scopes: [],
        accounts: [],
      }
    };
  }
}

export function loadOpenAIIntegrationRuntime(options = {}) {
  const runtimePaths = resolveRuntimePaths(options.workspaceRoot);
  const resolvedUserContextId = requireUserContextId(options.userContextId || "", "loadOpenAIIntegrationRuntime");
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, runtimePaths);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const integration = parsed?.openai && typeof parsed.openai === "object" ? parsed.openai : {};
    const apiKey = resolveProviderApiKey(integration.apiKey, runtimePaths);
    const baseURL = toOpenAiLikeBase(
      typeof integration.baseUrl === "string" ? integration.baseUrl : "",
      DEFAULT_OPENAI_BASE_URL
    );
    const model = typeof integration.defaultModel === "string" && integration.defaultModel.trim()
      ? integration.defaultModel.trim()
      : DEFAULT_CHAT_MODEL;
    return { apiKey, baseURL, model, sourcePath: configPath };
  } catch {
    return {
      apiKey: "",
      baseURL: DEFAULT_OPENAI_BASE_URL,
      model: DEFAULT_CHAT_MODEL,
      sourcePath: configPath,
    };
  }
}

// ===== Provider Resolution =====
function getProviderRuntime(integrations, provider) {
  if (provider === "claude") return integrations.claude;
  if (provider === "grok") return integrations.grok;
  if (provider === "gemini") return integrations.gemini;
  return integrations.openai;
}

export function resolveConfiguredChatRuntime(integrations, options = {}) {
  void options;
  const activeProvider =
    integrations.activeProvider === "claude" ||
    integrations.activeProvider === "grok" ||
    integrations.activeProvider === "gemini" ||
    integrations.activeProvider === "openai"
      ? integrations.activeProvider
      : "openai";
  const activeRuntime = getProviderRuntime(integrations, activeProvider);
  return {
    provider: activeProvider,
    apiKey: String(activeRuntime?.apiKey || "").trim(),
    baseURL: String(activeRuntime?.baseURL || "").trim(),
    model: String(activeRuntime?.model || "").trim(),
    connected: Boolean(activeRuntime?.connected),
    strict: true,
    routeReason: "strict-active-provider",
    rankedCandidates: [activeProvider],
  };
}

// ===== OpenAI Client =====
export function getOpenAIClient(runtime) {
  const key = `${runtime.baseURL}|${runtime.apiKey}`;
  if (openAiClientCache.has(key)) return openAiClientCache.get(key);
  const client = new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseURL });
  openAiClientCache.set(key, client);
  return client;
}

// ===== OpenAI Helpers =====
export function extractOpenAIChatText(completion) {
  const choice = completion?.choices?.[0] || {};
  const directCandidates = [
    choice?.message?.content,
    choice?.message?.refusal,
    choice?.message?.audio?.transcript,
    choice?.message?.output_text,
    choice?.text,
    completion?.output_text,
    completion?.text,
  ];
  for (const candidate of directCandidates) {
    const extracted = collectOpenAiText(candidate).trim();
    if (extracted) return extracted;
  }
  const fromMessage = collectOpenAiText(choice?.message).trim();
  if (fromMessage) return fromMessage;
  return "";
}

export function extractOpenAIStreamDelta(chunk) {
  const choice = chunk?.choices?.[0] || {};
  const deltaCandidates = [
    choice?.delta?.content,
    choice?.delta?.refusal,
    choice?.delta?.text,
    choice?.message?.content,
    choice?.message?.refusal,
  ];
  for (const candidate of deltaCandidates) {
    const extracted = collectOpenAiText(candidate);
    if (extracted) return extracted;
  }
  return collectOpenAiText(choice?.delta);
}

function collectOpenAiText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((part) => collectOpenAiText(part)).join("");
  }
  if (typeof value !== "object") return "";
  const obj = value;
  if (typeof obj.text === "string") return obj.text;
  if (obj.text && typeof obj.text === "object" && typeof obj.text.value === "string") return obj.text.value;
  if (typeof obj.output_text === "string") return obj.output_text;
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.content)) {
    const nested = obj.content.map((part) => collectOpenAiText(part)).join("");
    if (nested) return nested;
  }
  if (typeof obj.value === "string") return obj.value;
  if (Array.isArray(obj.parts)) {
    const nested = obj.parts.map((part) => collectOpenAiText(part)).join("");
    if (nested) return nested;
  }
  if (Array.isArray(obj.messages)) {
    const nested = obj.messages.map((part) => collectOpenAiText(part)).join("");
    if (nested) return nested;
  }
  return "";
}

export async function streamOpenAiChatCompletion({
  client,
  model,
  messages,
  timeoutMs,
  onDelta,
  maxCompletionTokens = 0,
  requestOverrides = {},
}) {
  let timer = null;
  const controller = new AbortController();
  timer = setTimeout(() => controller.abort(new Error(`OpenAI model ${model} timed out after ${timeoutMs}ms`)), timeoutMs);

  let stream = null;
  try {
    const overrides = requestOverrides && typeof requestOverrides === "object" ? requestOverrides : {};
    const request = {
      ...overrides,
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(Number.isFinite(Number(maxCompletionTokens)) && Number(maxCompletionTokens) > 0
        ? { max_completion_tokens: Math.max(1, Math.floor(Number(maxCompletionTokens))) }
        : {}),
    };
    stream = await client.chat.completions.create(request, { signal: controller.signal });
  } catch (err) {
    const overrides = requestOverrides && typeof requestOverrides === "object" ? requestOverrides : {};
    const fallbackRequest = {
      ...overrides,
      model,
      messages,
      stream: true,
      ...(Number.isFinite(Number(maxCompletionTokens)) && Number(maxCompletionTokens) > 0
        ? { max_completion_tokens: Math.max(1, Math.floor(Number(maxCompletionTokens))) }
        : {}),
    };
    stream = await client.chat.completions.create(fallbackRequest, { signal: controller.signal });
  }

  let reply = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let sawDelta = false;
  let finishReason = "";

  try {
    for await (const chunk of stream) {
      const chunkFinishReason = String(chunk?.choices?.[0]?.finish_reason || "").trim();
      if (chunkFinishReason) finishReason = chunkFinishReason;
      let delta = extractOpenAIStreamDelta(chunk);
      if (!delta && !sawDelta) {
        const fallbackText = extractOpenAIChatText({
          choices: [{ message: chunk?.choices?.[0]?.message || {} }],
        });
        if (fallbackText) delta = fallbackText;
      }
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

  return { reply, promptTokens, completionTokens, sawDelta, finishReason };
}

// ===== Claude API =====
function normalizeClaudeMessages(messages, userText) {
  if (Array.isArray(messages) && messages.length > 0) {
    return messages
      .map((msg) => {
        const role = msg?.role === "assistant" ? "assistant" : "user";
        const content = String(msg?.content || "").trim();
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean);
  }
  return [{ role: "user", content: String(userText || "") }];
}

export async function claudeMessagesCreate({
  apiKey,
  baseURL,
  model,
  system,
  userText,
  messages,
  maxTokens = 1200
}) {
  const requestMessages = normalizeClaudeMessages(messages, userText);
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
      system,
      messages: requestMessages
    })
  });
  const data = await res.json();
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

export async function claudeMessagesStream({
  apiKey,
  baseURL,
  model,
  system,
  userText,
  messages,
  maxTokens = 1200,
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  onDelta
}) {
  const requestMessages = normalizeClaudeMessages(messages, userText);
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
      stream: true,
      system,
      messages: requestMessages
    }),
    signal: controller.signal
  });

  if (!res.ok) {
    clearTimeout(timer);
    const data = await res.json();
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

// ===== Pricing =====
export function resolveModelPricing(model) {
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

export function estimateTokenCostUsd(model, promptTokens = 0, completionTokens = 0) {
  const pricing = resolveModelPricing(model);
  if (!pricing) return null;
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(6));
}
