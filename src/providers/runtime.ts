import { createDecipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
}

export interface ResolvedChatRuntime extends ProviderRuntime {
  provider: ProviderName;
  strict: boolean;
  routeReason?: string;
  rankedCandidates?: ProviderName[];
}

export type RoutingPreference = "balanced" | "cost" | "latency" | "quality";

export interface ResolveChatRuntimeOptions {
  strictActiveProvider?: boolean;
  preference?: RoutingPreference;
  requiresToolCalling?: boolean;
  allowActiveProviderOverride?: boolean;
  preferredProviders?: ProviderName[];
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

const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_GROK_MODEL = "grok-4-0709";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";

const USER_CONTEXT_INTEGRATIONS_FILE = "integrations-config.json";

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

export function resolveRuntimePaths(workspaceRoot = process.cwd()): RuntimePaths {
  const root = path.resolve(workspaceRoot);
  const integrationsConfigPath = path.join(root, "hud", "data", "integrations-config.json");
  const hudRoot = path.dirname(integrationsConfigPath);
  return {
    workspaceRoot: root,
    integrationsConfigPath,
    userContextRoot: path.join(root, ".agent", "user-context"),
    hudRoot,
  };
}

function deriveEncryptionKeyMaterial(rawValue: unknown): Buffer | null {
  const raw = toNonEmptyString(rawValue);
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // ignore
  }
  return createHash("sha256").update(raw).digest();
}

export function getEncryptionKeyMaterials(paths = resolveRuntimePaths()): Buffer[] {
  const candidates: string[] = [];
  const envKey = toNonEmptyString(process.env.NOVA_ENCRYPTION_KEY);
  if (envKey) candidates.push(envKey);

  const materials: Buffer[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = toNonEmptyString(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const material = deriveEncryptionKeyMaterial(normalized);
    if (material) materials.push(material);
  }
  return materials;
}

export function decryptStoredSecret(payload: unknown, paths = resolveRuntimePaths()): string {
  const input = toNonEmptyString(payload);
  if (!input) return "";
  const parts = input.split(".");
  if (parts.length !== 3) return "";
  const keyMaterials = getEncryptionKeyMaterials(paths);
  if (keyMaterials.length === 0) return "";

  for (const key of keyMaterials) {
    try {
      const iv = Buffer.from(parts[0] || "", "base64");
      const tag = Buffer.from(parts[1] || "", "base64");
      const enc = Buffer.from(parts[2] || "", "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(enc), decipher.final()]);
      return out.toString("utf8");
    } catch {
      // try next key material
    }
  }
  return "";
}

export function unwrapStoredSecret(value: unknown, paths = resolveRuntimePaths()): string {
  const raw = toNonEmptyString(value);
  if (!raw) return "";
  const decrypted = decryptStoredSecret(raw, paths);
  if (decrypted) return decrypted;

  const parts = raw.split(".");
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0] || "", "base64");
      const tag = Buffer.from(parts[1] || "", "base64");
      const enc = Buffer.from(parts[2] || "", "base64");
      if (iv.length === 12 && tag.length === 16 && enc.length > 0) return "";
    } catch {
      // ignore
    }
  }
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

function resolveIntegrationsConfigPath(userContextId: string, paths: RuntimePaths): string {
  const normalized = normalizeUserContextId(userContextId) || "anonymous";
  return path.join(paths.userContextRoot, normalized, USER_CONTEXT_INTEGRATIONS_FILE);
}

function resolveProviderApiKey(provider: ProviderName, integrationApiKey: unknown, paths: RuntimePaths): string {
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

function isProviderReady(integrations: IntegrationsRuntime, provider: ProviderName): boolean {
  const runtime = getProviderRuntime(integrations, provider);
  return runtime.connected && runtime.apiKey.length > 0 && runtime.model.length > 0;
}

const PROVIDER_ARBITRATION_PROFILE: Record<
  ProviderName,
  { quality: number; latency: number; cost: number; tool: number }
> = {
  openai: { quality: 0.91, latency: 0.86, cost: 0.55, tool: 0.95 },
  claude: { quality: 0.95, latency: 0.72, cost: 0.5, tool: 0.6 },
  gemini: { quality: 0.88, latency: 0.84, cost: 0.8, tool: 0.9 },
  grok: { quality: 0.86, latency: 0.78, cost: 0.58, tool: 0.9 },
};

const ROUTING_TIE_BREAK_ORDER: ProviderName[] = ["openai", "claude", "gemini", "grok"];
const ROUTING_TIE_BREAK_WEIGHT = new Map<ProviderName, number>(
  ROUTING_TIE_BREAK_ORDER.map((provider, index) => [provider, ROUTING_TIE_BREAK_ORDER.length - index]),
);

function parseRoutingPreference(value: unknown): RoutingPreference {
  const candidate = toNonEmptyString(value).toLowerCase();
  if (candidate === "cost" || candidate === "latency" || candidate === "quality") return candidate;
  return "balanced";
}

function normalizePreferredProviders(value: unknown): ProviderName[] {
  if (!Array.isArray(value)) return [];
  const out: ProviderName[] = [];
  const seen = new Set<ProviderName>();
  for (const entry of value) {
    const raw = toNonEmptyString(entry).toLowerCase();
    if (raw !== "openai" && raw !== "claude" && raw !== "gemini" && raw !== "grok") {
      continue;
    }
    const candidate = raw as ProviderName;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function resolveRoutingWeights(
  preference: RoutingPreference,
  requiresToolCalling: boolean,
): { quality: number; latency: number; cost: number; tool: number; active: number } {
  if (preference === "quality") {
    return requiresToolCalling
      ? { quality: 0.48, latency: 0.16, cost: 0.14, tool: 0.22, active: 0.06 }
      : { quality: 0.62, latency: 0.2, cost: 0.18, tool: 0, active: 0.06 };
  }
  if (preference === "cost") {
    return requiresToolCalling
      ? { quality: 0.14, latency: 0.24, cost: 0.48, tool: 0.24, active: 0.05 }
      : { quality: 0.18, latency: 0.26, cost: 0.56, tool: 0, active: 0.05 };
  }
  if (preference === "latency") {
    return requiresToolCalling
      ? { quality: 0.14, latency: 0.5, cost: 0.16, tool: 0.2, active: 0.05 }
      : { quality: 0.22, latency: 0.58, cost: 0.2, tool: 0, active: 0.05 };
  }
  return requiresToolCalling
    ? { quality: 0.26, latency: 0.3, cost: 0.2, tool: 0.24, active: 0.08 }
    : { quality: 0.42, latency: 0.34, cost: 0.24, tool: 0, active: 0.08 };
}

function rankReadyProviders(
  integrations: IntegrationsRuntime,
  activeProvider: ProviderName,
  options?: ResolveChatRuntimeOptions,
): ProviderName[] {
  const readyProviders: ProviderName[] = ROUTING_TIE_BREAK_ORDER.filter((provider) =>
    isProviderReady(integrations, provider),
  );
  if (readyProviders.length <= 1) return readyProviders;

  const requiresToolCalling = options?.requiresToolCalling === true;
  const preference = parseRoutingPreference(options?.preference);
  const preferredProviders = normalizePreferredProviders(options?.preferredProviders);
  const preferredRank = new Map<ProviderName, number>(
    preferredProviders.map((provider, index) => [provider, preferredProviders.length - index]),
  );
  const weights = resolveRoutingWeights(preference, requiresToolCalling);

  const ranked = readyProviders
    .map((provider) => {
      const profile = PROVIDER_ARBITRATION_PROFILE[provider];
      const preferredBonus = Number(preferredRank.get(provider) || 0) * 0.03;
      const activeBonus = provider === activeProvider ? weights.active : 0;
      const tieWeight = Number(ROUTING_TIE_BREAK_WEIGHT.get(provider) || 0) * 0.00001;
      const rawScore =
        profile.quality * weights.quality +
        profile.latency * weights.latency +
        profile.cost * weights.cost +
        profile.tool * weights.tool +
        preferredBonus +
        activeBonus +
        tieWeight;
      return { provider, score: Number(rawScore.toFixed(6)) };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        Number(ROUTING_TIE_BREAK_WEIGHT.get(b.provider) || 0) -
        Number(ROUTING_TIE_BREAK_WEIGHT.get(a.provider) || 0)
      );
    });

  return ranked.map((entry) => entry.provider);
}

export function loadIntegrationsRuntime(options?: {
  userContextId?: string;
  workspaceRoot?: string;
}): IntegrationsRuntime {
  const paths = resolveRuntimePaths(options?.workspaceRoot);
  const resolvedUserContextId = normalizeUserContextId(options?.userContextId || "") || "anonymous";
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, paths);

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = toRecord(JSON.parse(raw));
    const openaiIntegration = toRecord(parsed.openai);
    const claudeIntegration = toRecord(parsed.claude);
    const grokIntegration = toRecord(parsed.grok);
    const geminiIntegration = toRecord(parsed.gemini);

    const activeProvider = parseActiveProvider(parsed.activeLlmProvider);
    const openaiApiKey = resolveProviderApiKey("openai", openaiIntegration.apiKey, paths);
    const claudeApiKey = resolveProviderApiKey("claude", claudeIntegration.apiKey, paths);
    const grokApiKey = resolveProviderApiKey("grok", grokIntegration.apiKey, paths);
    const geminiApiKey = resolveProviderApiKey("gemini", geminiIntegration.apiKey, paths);

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
    };
  } catch {
    return {
      sourcePath: configPath,
      activeProvider: "openai",
      openai: { connected: false, apiKey: "", baseURL: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_CHAT_MODEL },
      claude: { connected: false, apiKey: "", baseURL: DEFAULT_CLAUDE_BASE_URL, model: DEFAULT_CLAUDE_MODEL },
      grok: { connected: false, apiKey: "", baseURL: DEFAULT_GROK_BASE_URL, model: DEFAULT_GROK_MODEL },
      gemini: { connected: false, apiKey: "", baseURL: DEFAULT_GEMINI_BASE_URL, model: DEFAULT_GEMINI_MODEL },
    };
  }
}

export function loadOpenAiIntegrationRuntime(options?: { userContextId?: string; workspaceRoot?: string }): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  const paths = resolveRuntimePaths(options?.workspaceRoot);
  const resolvedUserContextId = normalizeUserContextId(options?.userContextId || "") || "anonymous";
  const configPath = resolveIntegrationsConfigPath(resolvedUserContextId, paths);
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = toRecord(JSON.parse(raw));
    const integration = toRecord(parsed.openai);
    const apiKey = resolveProviderApiKey("openai", integration.apiKey, paths);
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
  const strictActiveProvider = options?.strictActiveProvider !== false;
  const allowActiveProviderOverride = options?.allowActiveProviderOverride === true;
  const activeProvider = parseActiveProvider(integrations.activeProvider);

  if (strictActiveProvider) {
    const activeRuntime = getProviderRuntime(integrations, activeProvider);
    return {
      provider: activeProvider,
      apiKey: toNonEmptyString(activeRuntime.apiKey),
      baseURL: toNonEmptyString(activeRuntime.baseURL),
      model: toNonEmptyString(activeRuntime.model),
      connected: boolFlag(activeRuntime.connected),
      strict: true,
      routeReason: "strict-active-provider",
      rankedCandidates: [activeProvider],
    };
  }

  const rankedCandidates = rankReadyProviders(integrations, activeProvider, options);
  const hasActiveReady = isProviderReady(integrations, activeProvider);

  if (hasActiveReady && !allowActiveProviderOverride) {
    const activeRuntime = getProviderRuntime(integrations, activeProvider);
    return {
      provider: activeProvider,
      apiKey: toNonEmptyString(activeRuntime.apiKey),
      baseURL: toNonEmptyString(activeRuntime.baseURL),
      model: toNonEmptyString(activeRuntime.model),
      connected: boolFlag(activeRuntime.connected),
      strict: false,
      routeReason: "active-provider-ready",
      rankedCandidates: [activeProvider],
    };
  }

  for (const provider of rankedCandidates) {
    const runtime = getProviderRuntime(integrations, provider);
    return {
      provider,
      apiKey: toNonEmptyString(runtime.apiKey),
      baseURL: toNonEmptyString(runtime.baseURL),
      model: toNonEmptyString(runtime.model),
      connected: boolFlag(runtime.connected),
      strict: false,
      routeReason: provider === activeProvider ? "active-provider-ranked" : "ranked-fallback",
      rankedCandidates,
    };
  }

  const activeRuntime = getProviderRuntime(integrations, activeProvider);
  return {
    provider: activeProvider,
    apiKey: toNonEmptyString(activeRuntime.apiKey),
    baseURL: toNonEmptyString(activeRuntime.baseURL),
    model: toNonEmptyString(activeRuntime.model),
    connected: boolFlag(activeRuntime.connected),
    strict: false,
    routeReason: "active-provider-unavailable",
    rankedCandidates: [activeProvider],
  };
}
