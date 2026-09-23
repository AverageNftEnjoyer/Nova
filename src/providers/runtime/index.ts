import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db/index.js";
import { resolveUserContextRoot } from "../../db/paths.js";
import { decryptSecret, isSecretCiphertext } from "../../security/secrets/index.js";

export type ProviderName = "openai" | "claude" | "grok" | "gemini";

export interface ProviderRuntime {
  connected: boolean;
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface IntegrationsRuntime {
  sourcePath: string;
  activeProvider: ProviderName;
  openai: ProviderRuntime;
  claude: ProviderRuntime;
  grok: ProviderRuntime;
  gemini: ProviderRuntime;
  phantom: PhantomRuntime;
  polymarket: PolymarketRuntime;
  spotify: SpotifyRuntime;
  gmail: GmailRuntime;
}

export interface SpotifyRuntime {
  connected: boolean;
  spotifyUserId: string;
  displayName: string;
  scopes: string[];
}

export interface GmailAccountRuntime {
  id: string;
  email: string;
  enabled: boolean;
  scopes: string[];
  accessToken?: string;
  tokenExpiry?: number;
}

export interface GmailRuntime {
  connected: boolean;
  activeAccountId: string;
  email: string;
  scopes: string[];
  accounts: GmailAccountRuntime[];
  accessToken?: string;
  tokenExpiry?: number;
}

export interface PhantomRuntime {
  connected: boolean;
  provider: "phantom";
  chain: "solana";
  walletAddress: string;
  walletLabel: string;
  connectedAt: string;
  verifiedAt: string;
  lastDisconnectedAt: string;
  evmAddress: string;
  evmLabel: string;
  evmChainId: string;
  evmConnectedAt: string;
  preferences: {
    allowAgentWalletContext: boolean;
    allowAgentEvmContext: boolean;
    allowApprovalGatedPolymarket: boolean;
  };
  capabilities: {
    signMessage: boolean;
    walletOwnershipProof: boolean;
    solanaConnected: boolean;
    solanaVerified: boolean;
    evmAvailable: boolean;
    approvalGatedPolymarket: boolean;
    approvalGatedPolymarketReady: boolean;
    autonomousTrading: boolean;
  };
}

export interface PolymarketRuntime {
  connected: boolean;
  walletAddress: string;
  profileAddress: string;
  positionsAddress: string;
  username: string;
  pseudonym: string;
  profileImageUrl: string;
  signatureType: 0 | 2;
  liveTradingEnabled: boolean;
  lastConnectedAt: string;
  lastProfileSyncAt: string;
}

export interface ResolvedChatRuntime extends ProviderRuntime {
  provider: ProviderName;
  strict: boolean;
  routeReason?: string;
  rankedCandidates?: ProviderName[];
}

export type RoutingPreference = "balanced" | "cost" | "latency" | "quality";

export interface ResolveChatRuntimeOptions {
  preferredProvider?: ProviderName;
  preferredModel?: string;
}

export interface RuntimePaths {
  workspaceRoot: string;
  integrationsConfigPath: string;
  userContextRoot: string;
  hudRoot: string;
}

export interface ErrorDetails {
  message: string;
  status: number | null;
  code: string | null;
  type: string | null;
  param: string | null;
  requestId: string | null;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const DEFAULT_CHAT_MODEL = "gpt-5.6-terra";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
const DEFAULT_GROK_MODEL = "grok-4.3";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

const RESERVED_SRC_USER_ENTRY = ".user";
const RESERVED_SRC_USER_SENTINEL = [
  "Reserved path: Nova user state must live at /.user, never at /src/.user.",
  "Do not replace this file with a directory.",
  "",
].join("\n");

function resolveWorkspaceRoot(workspaceRootInput?: string): string {
  const fallback = path.resolve(String(workspaceRootInput || process.cwd() || "."));
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

function assertWorkspaceUserRoot(root: string): string {
  const normalizedRoot = path.resolve(root);
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

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolFlag(value: unknown): boolean {
  return value === true;
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const value = toNonEmptyString(entry);
    if (!value) continue;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(value);
  }
  return out;
}

export function describeUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function toErrorDetails(err: unknown): ErrorDetails {
  if (!err || typeof err !== "object") {
    return {
      message: String(err || "Unknown error"),
      status: null,
      code: null,
      type: null,
      param: null,
      requestId: null,
    };
  }
  const anyErr = err as Record<string, unknown>;
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
          : null,
  };
}

export function resolveRuntimePaths(workspaceRoot?: string): RuntimePaths {
  const root = assertWorkspaceUserRoot(resolveWorkspaceRoot(workspaceRoot));
  const integrationsConfigPath = "sqlite:integration_state/runtime/snapshot";
  const hudRoot = path.join(root, "hud");
  return {
    workspaceRoot: root,
    integrationsConfigPath,
    // Follows the data dir (NOVA_DATA_DIR / packaged / <root>/.user); the src/.user sentinel is still enforced above.
    userContextRoot: resolveUserContextRoot(),
    hudRoot,
  };
}

export function getEncryptionKeyMaterials(paths = resolveRuntimePaths()): Buffer[] {
  void paths;
  return [];
}

export function decryptStoredSecret(payload: unknown, paths = resolveRuntimePaths()): string {
  void paths;
  const input = toNonEmptyString(payload);
  if (!input) return "";
  if (isSecretCiphertext(input)) return decryptSecret(input);
  return "";
}

export function unwrapStoredSecret(value: unknown, paths = resolveRuntimePaths()): string {
  const raw = toNonEmptyString(value);
  if (!raw) return "";
  const decrypted = decryptStoredSecret(raw, paths);
  if (decrypted) return decrypted;
  if (isSecretCiphertext(raw)) return "";
  return raw;
}

export function toOpenAiLikeBase(baseUrl: unknown, fallbackBaseUrl: string): string {
  const trimmed = toNonEmptyString(baseUrl).replace(/\/+$/, "");
  if (!trimmed) return fallbackBaseUrl;
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function toClaudeBase(baseURL: unknown): string {
  const trimmed = toNonEmptyString(baseURL).replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_CLAUDE_BASE_URL;
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function requireUserContextId(value: unknown, operation: string): string {
  const normalized = normalizeUserContextId(value);
  if (!normalized) throw new Error(`${operation} requires userContextId.`);
  return normalized;
}

function resolveIntegrationsConfigPath(userContextId: string, paths: RuntimePaths): string {
  const normalized = requireUserContextId(userContextId, "resolveIntegrationsConfigPath");
  void paths;
  return `sqlite:integration_state/${normalized}/runtime/snapshot`;
}

function readIntegrationsConfig(userContextId: string): Record<string, unknown> {
  const uid = requireUserContextId(userContextId, "readIntegrationsConfig");
  const row = getDb()
    .prepare("SELECT value_json FROM integration_state WHERE user_id = ? AND integration = 'runtime' AND key = 'snapshot'")
    .get(uid) as { value_json: string } | undefined;
  if (!row) throw new Error("Runtime integrations snapshot not found.");
  return toRecord(JSON.parse(row.value_json));
}

function resolveProviderApiKey(integrationApiKey: unknown, paths: RuntimePaths): string {
  const fromIntegration = unwrapStoredSecret(integrationApiKey, paths);
  return toNonEmptyString(fromIntegration);
}

function resolveProviderConnectedState(connectedFlag: unknown, apiKey: string): boolean {
  return boolFlag(connectedFlag) && apiKey.length > 0;
}

function parseProviderModel(value: unknown, fallback: string): string {
  const candidate = toNonEmptyString(value);
  return candidate || fallback;
}

function createDefaultGmailRuntime(): GmailRuntime {
  return {
    connected: false,
    activeAccountId: "",
    email: "",
    scopes: [],
    accounts: [],
  };
}

function createDefaultSpotifyRuntime(): SpotifyRuntime {
  return {
    connected: false,
    spotifyUserId: "",
    displayName: "",
    scopes: [],
  };
}

function createDefaultPhantomRuntime(): PhantomRuntime {
  return {
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
  };
}

function createDefaultPolymarketRuntime(): PolymarketRuntime {
  return {
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
  };
}

function parseSpotifyRuntime(value: unknown): SpotifyRuntime {
  const integration = toRecord(value);
  return {
    connected: boolFlag(integration.connected),
    spotifyUserId: toNonEmptyString(integration.spotifyUserId),
    displayName: toNonEmptyString(integration.displayName),
    scopes: toStringArray(integration.scopes),
  };
}

function parsePhantomRuntime(value: unknown): PhantomRuntime {
  const integration = toRecord(value);
  const preferences = toRecord(integration.preferences);
  const capabilities = toRecord(integration.capabilities);
  const connected = boolFlag(integration.connected);
  const verifiedAt = toNonEmptyString(integration.verifiedAt);
  const evmAddress = toNonEmptyString(integration.evmAddress);
  return {
    connected,
    provider: "phantom",
    chain: "solana",
    walletAddress: toNonEmptyString(integration.walletAddress),
    walletLabel: toNonEmptyString(integration.walletLabel),
    connectedAt: toNonEmptyString(integration.connectedAt),
    verifiedAt,
    lastDisconnectedAt: toNonEmptyString(integration.lastDisconnectedAt),
    evmAddress,
    evmLabel: toNonEmptyString(integration.evmLabel),
    evmChainId: toNonEmptyString(integration.evmChainId),
    evmConnectedAt: toNonEmptyString(integration.evmConnectedAt),
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

function parsePolymarketRuntime(value: unknown): PolymarketRuntime {
  const integration = toRecord(value);
  const connected = boolFlag(integration.connected);
  const walletAddress = toNonEmptyString(integration.walletAddress);
  const profileAddress = toNonEmptyString(integration.profileAddress);
  return {
    connected,
    walletAddress,
    profileAddress,
    positionsAddress: toNonEmptyString(integration.positionsAddress) || profileAddress || walletAddress,
    username: toNonEmptyString(integration.username),
    pseudonym: toNonEmptyString(integration.pseudonym),
    profileImageUrl: toNonEmptyString(integration.profileImageUrl),
    signatureType: integration.signatureType === 2 ? 2 : 0,
    liveTradingEnabled: connected && integration.liveTradingEnabled === true,
    lastConnectedAt: toNonEmptyString(integration.lastConnectedAt),
    lastProfileSyncAt: toNonEmptyString(integration.lastProfileSyncAt),
  };
}

function parseGmailRuntime(value: unknown, paths: RuntimePaths): GmailRuntime {
  const integration = toRecord(value);
  const accountsInput = Array.isArray(integration.accounts) ? integration.accounts : [];
  const accounts = accountsInput
    .map((entry) => {
      const account = toRecord(entry);
      return {
        id: toNonEmptyString(account.id),
        email: toNonEmptyString(account.email),
        enabled: account.enabled === true,
        scopes: toStringArray(account.scopes),
        accessToken: unwrapStoredSecret(account.accessToken, paths) || "",
        tokenExpiry: typeof account.tokenExpiry === "number" && Number.isFinite(account.tokenExpiry)
          ? Math.max(0, Math.floor(account.tokenExpiry))
          : 0,
      };
    })
    .filter((entry) => entry.id.length > 0 || entry.email.length > 0 || entry.scopes.length > 0);

  return {
    connected: boolFlag(integration.connected),
    activeAccountId: toNonEmptyString(integration.activeAccountId),
    email: toNonEmptyString(integration.email),
    scopes: toStringArray(integration.scopes),
    accessToken: unwrapStoredSecret(integration.accessToken, paths) || "",
    tokenExpiry: typeof integration.tokenExpiry === "number" && Number.isFinite(integration.tokenExpiry)
      ? Math.max(0, Math.floor(integration.tokenExpiry))
      : 0,
    accounts,
  };
}

function parseActiveProvider(value: unknown): ProviderName {
  const candidate = toNonEmptyString(value);
  if (candidate === "claude" || candidate === "grok" || candidate === "gemini" || candidate === "openai") {
    return candidate;
  }
  return "openai";
}

function getProviderRuntime(integrations: IntegrationsRuntime, provider: ProviderName): ProviderRuntime {
  if (provider === "claude") return integrations.claude;
  if (provider === "grok") return integrations.grok;
  if (provider === "gemini") return integrations.gemini;
  return integrations.openai;
}

export function loadIntegrationsRuntime(options?: {
  userContextId?: string;
  workspaceRoot?: string;
}): IntegrationsRuntime {
  const paths = resolveRuntimePaths(options?.workspaceRoot);
  const resolvedUserContextId = requireUserContextId(options?.userContextId || "", "loadIntegrationsRuntime");
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, paths);

  try {
    const parsed = readIntegrationsConfig(resolvedUserContextId);
    const openaiIntegration = toRecord(parsed.openai);
    const claudeIntegration = toRecord(parsed.claude);
    const grokIntegration = toRecord(parsed.grok);
    const geminiIntegration = toRecord(parsed.gemini);
    const phantomIntegration = parsePhantomRuntime(parsed.phantom);
    const polymarketIntegration = parsePolymarketRuntime(parsed.polymarket);
    const spotifyIntegration = parseSpotifyRuntime(parsed.spotify);
    const gmailIntegration = parseGmailRuntime(parsed.gmail, paths);

    const activeProvider = parseActiveProvider(parsed.activeLlmProvider);
    const openaiApiKey = resolveProviderApiKey(openaiIntegration.apiKey, paths);
    const claudeApiKey = resolveProviderApiKey(claudeIntegration.apiKey, paths);
    const grokApiKey = resolveProviderApiKey(grokIntegration.apiKey, paths);
    const geminiApiKey = resolveProviderApiKey(geminiIntegration.apiKey, paths);

    return {
      sourcePath: configPath,
      activeProvider,
      openai: {
        connected: resolveProviderConnectedState(openaiIntegration.connected, openaiApiKey),
        apiKey: openaiApiKey,
        baseURL: toOpenAiLikeBase(openaiIntegration.baseUrl, DEFAULT_OPENAI_BASE_URL),
        model: parseProviderModel(openaiIntegration.defaultModel, DEFAULT_CHAT_MODEL),
      },
      claude: {
        connected: resolveProviderConnectedState(claudeIntegration.connected, claudeApiKey),
        apiKey: claudeApiKey,
        baseURL: toNonEmptyString(claudeIntegration.baseUrl).replace(/\/+$/, "") || DEFAULT_CLAUDE_BASE_URL,
        model: parseProviderModel(claudeIntegration.defaultModel, DEFAULT_CLAUDE_MODEL),
      },
      grok: {
        connected: resolveProviderConnectedState(grokIntegration.connected, grokApiKey),
        apiKey: grokApiKey,
        baseURL: toOpenAiLikeBase(grokIntegration.baseUrl, DEFAULT_GROK_BASE_URL),
        model: parseProviderModel(grokIntegration.defaultModel, DEFAULT_GROK_MODEL),
      },
      gemini: {
        connected: resolveProviderConnectedState(geminiIntegration.connected, geminiApiKey),
        apiKey: geminiApiKey,
        baseURL: toOpenAiLikeBase(geminiIntegration.baseUrl, DEFAULT_GEMINI_BASE_URL),
        model: parseProviderModel(geminiIntegration.defaultModel, DEFAULT_GEMINI_MODEL),
      },
      phantom: phantomIntegration,
      polymarket: polymarketIntegration,
      spotify: spotifyIntegration,
      gmail: gmailIntegration,
    };
  } catch {
    const activeProvider = "openai";
    return {
      sourcePath: configPath,
      activeProvider,
      openai: {
        connected: false,
        apiKey: "",
        baseURL: DEFAULT_OPENAI_BASE_URL,
        model: DEFAULT_CHAT_MODEL,
      },
      claude: {
        connected: false,
        apiKey: "",
        baseURL: DEFAULT_CLAUDE_BASE_URL,
        model: DEFAULT_CLAUDE_MODEL,
      },
      grok: {
        connected: false,
        apiKey: "",
        baseURL: DEFAULT_GROK_BASE_URL,
        model: DEFAULT_GROK_MODEL,
      },
      gemini: {
        connected: false,
        apiKey: "",
        baseURL: DEFAULT_GEMINI_BASE_URL,
        model: DEFAULT_GEMINI_MODEL,
      },
      phantom: createDefaultPhantomRuntime(),
      polymarket: createDefaultPolymarketRuntime(),
      spotify: createDefaultSpotifyRuntime(),
      gmail: createDefaultGmailRuntime(),
    };
  }
}

export function loadOpenAiIntegrationRuntime(options?: { userContextId?: string; workspaceRoot?: string }): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  const paths = resolveRuntimePaths(options?.workspaceRoot);
  const resolvedUserContextId = requireUserContextId(options?.userContextId || "", "loadOpenAiIntegrationRuntime");
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, paths);
  try {
    const parsed = readIntegrationsConfig(resolvedUserContextId);
    const integration = toRecord(parsed.openai);
    const apiKey = resolveProviderApiKey(integration.apiKey, paths);
    const baseURL = toOpenAiLikeBase(integration.baseUrl, DEFAULT_OPENAI_BASE_URL);
    const model = parseProviderModel(integration.defaultModel, DEFAULT_CHAT_MODEL);
    return { apiKey, baseURL, model };
  } catch {
    return {
      apiKey: "",
      baseURL: DEFAULT_OPENAI_BASE_URL,
      model: DEFAULT_CHAT_MODEL,
    };
  }
}

export function resolveConfiguredChatRuntime(
  integrations: IntegrationsRuntime,
  options?: ResolveChatRuntimeOptions,
): ResolvedChatRuntime {
  const configuredProvider = parseActiveProvider(integrations.activeProvider);
  const preferredProvider = options?.preferredProvider
    ? parseActiveProvider(options.preferredProvider)
    : null;
  const activeProvider = preferredProvider || configuredProvider;
  const activeRuntime = getProviderRuntime(integrations, activeProvider);
  const preferredModel = toNonEmptyString(options?.preferredModel);
  return {
    provider: activeProvider,
    apiKey: toNonEmptyString(activeRuntime.apiKey),
    baseURL: toNonEmptyString(activeRuntime.baseURL),
    model: preferredModel || toNonEmptyString(activeRuntime.model),
    connected: boolFlag(activeRuntime.connected),
    strict: true,
    routeReason: preferredProvider ? "task-selected-provider" : "strict-active-provider",
    rankedCandidates: [activeProvider],
  };
}
