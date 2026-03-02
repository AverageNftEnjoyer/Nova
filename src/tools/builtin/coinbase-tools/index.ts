import fs from "node:fs";
import path from "node:path";

import {
  asCoinbaseError,
  coinbaseDbPathForUserContext,
  createCoinbaseAutoAuthStrategy,
  CoinbaseDataStore,
  CoinbaseService,
  buildCoinbasePnlPersonalityComment,
  FileBackedCoinbaseCredentialProvider,
  recordCoinbaseMetric,
  recordCoinbaseStructuredLog,
  resolveCoinbaseRolloutAccess,
  renderCoinbasePortfolioReport,
  type CoinbaseCapabilityStatus,
  type CoinbaseProvider,
  type CoinbaseRequestContext,
} from "../../../integrations/coinbase/index.js";
import type { Tool } from "../../core/types/index.js";

const COINBASE_REQUIRED_SCOPES = ["portfolio:view", "accounts:read", "transactions:read"] as const;

const KNOWN_SYMBOLS = [
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LTC", "BCH", "AVAX", "DOT", "MATIC", "UNI", "LINK", "ATOM", "XLM",
  "ALGO", "TRX", "ETC", "NEAR", "APT", "ARB", "OP", "FIL", "AAVE", "SUI", "SHIB", "USDT", "USDC", "EURC",
] as const;

const SYMBOL_ALIAS_TO_CANONICAL: Record<string, string> = {
  bitcoin: "BTC",
  xbt: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  solana: "SOL",
  ripple: "XRP",
  cardano: "ADA",
  dogecoin: "DOGE",
  litecoin: "LTC",
  bitcoincash: "BCH",
  avalanche: "AVAX",
  polkadot: "DOT",
  polygon: "MATIC",
  chainlink: "LINK",
  stellar: "XLM",
  algorand: "ALGO",
  tron: "TRX",
  aptos: "APT",
  arbitrum: "ARB",
  optimism: "OP",
  filecoin: "FIL",
  sui: "SUI",
  tether: "USDT",
  usdt: "USDT",
  usdc: "USDC",
  eurc: "EURC",
};

const COINBASE_TOOL_NAMES = new Set([
  "coinbase_capabilities",
  "coinbase_spot_price",
  "coinbase_portfolio_snapshot",
  "coinbase_recent_transactions",
  "coinbase_portfolio_report",
]);

type CoinbaseToolErrorPayload = {
  ok: false;
  kind: string;
  source: "coinbase";
  errorCode: string;
  message: string;
  safeMessage: string;
  guidance: string;
  retryable: boolean;
  requiredScopes: string[];
};

function rolloutBlockedError(kind: string, userContextId: string): CoinbaseToolErrorPayload {
  const access = resolveCoinbaseRolloutAccess(userContextId);
  return {
    ok: false,
    kind,
    source: "coinbase",
    errorCode: "ROLLOUT_BLOCKED",
    message: `Coinbase rollout blocked: ${access.reason} (stage=${access.stage}).`,
    safeMessage: "Coinbase is not enabled for this user cohort yet.",
    guidance: `If this is expected, wait for rollout promotion. Support: ${access.supportChannel}`,
    retryable: false,
    requiredScopes: [...COINBASE_REQUIRED_SCOPES],
  };
}

type ServiceState = {
  service: CoinbaseProvider;
  dataStore: CoinbaseDataStore;
};

const SERVICE_CACHE_MAX = 64;
const serviceByWorkspaceAndUser = new Map<string, ServiceState>();
const PERSONA_META_CACHE_TTL_MS = 60_000;
const personaMetaByWorkspaceAndUser = new Map<string, {
  ts: number;
  value: {
    assistantName: string;
    tone: "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed";
  };
}>();

function evictOldestServiceIfNeeded(): void {
  if (serviceByWorkspaceAndUser.size <= SERVICE_CACHE_MAX) return;
  // Map insertion order is guaranteed in JS — first key is the oldest.
  const oldestKey = serviceByWorkspaceAndUser.keys().next().value;
  if (!oldestKey) return;
  const evicted = serviceByWorkspaceAndUser.get(oldestKey);
  serviceByWorkspaceAndUser.delete(oldestKey);
  try {
    evicted?.dataStore?.close();
  } catch {
    // Best effort — connection may already be closed.
  }
}

export function isCoinbaseToolName(name: unknown): boolean {
  return COINBASE_TOOL_NAMES.has(String(name || "").trim());
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ok: false,
      kind: "coinbase_error",
      source: "coinbase",
      errorCode: "SERIALIZE_FAILED",
      message: "Failed to serialize Coinbase tool output.",
      safeMessage: "I couldn't verify Coinbase data right now.",
      guidance: "Retry in a moment.",
      retryable: true,
      requiredScopes: [...COINBASE_REQUIRED_SCOPES],
    });
  }
}

function toUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 96);
}

function toConversationId(value: unknown): string {
  return String(value || "").trim().slice(0, 128);
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeQuoteCurrency(value: unknown): string {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(normalized)) return "USD";
  return normalized;
}

function stripAssetToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type CoinbaseReportSkillPrefs = {
  includeAssets: Set<string>;
  excludeAssets: Set<string>;
  decimalPlaces?: number;
  includeTimestamp?: boolean;
  includeFreshness?: boolean;
  includeRecentNetCashFlow?: boolean;
  dateFormat?: "MM/DD/YYYY" | "ISO_DATE";
  sourcePath: string;
  rules: string[];
};

function parseIncludedAssetsFromText(raw: string): string[] {
  const tokens = String(raw || "")
    .split(/[,\s|/]+/)
    .map((token) => stripAssetToken(token))
    .filter(Boolean);
  const symbols = new Set<string>();
  for (const token of tokens) {
    const resolved = resolveBaseAsset(token);
    if (resolved.status === "resolved" && resolved.symbol) {
      symbols.add(resolved.symbol);
    }
  }
  return [...symbols];
}

function loadCoinbaseReportSkillPrefs(workspaceDir: string, userContextId: string): CoinbaseReportSkillPrefs | null {
  const normalizedUserContextId = toUserContextId(userContextId);
  if (!normalizedUserContextId) return null;
  const root = path.resolve(workspaceDir || process.cwd());
  const candidates = [
    path.join(root, ".agent", "user-context", normalizedUserContextId, "skills", "coinbase", "SKILL.md"),
    path.join(root, ".agent", "user-context", normalizedUserContextId, "skills.md"),
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const includeAssets = new Set<string>();
      const excludeAssets = new Set<string>();
      let decimalPlaces: number | undefined;
      let includeTimestamp: boolean | undefined;
      let includeFreshness: boolean | undefined;
      let includeRecentNetCashFlow: boolean | undefined;
      let dateFormat: "MM/DD/YYYY" | "ISO_DATE" | undefined;
      const rules: string[] = [];

      for (const lineRaw of raw.split(/\r?\n/)) {
        const line = String(lineRaw || "").trim();
        if (!line || line.startsWith("#")) continue;
        rules.push(line);

        const exceptMatch = line.match(/exclude\s+all\s+assets\s+except\s+(.+)$/i);
        if (exceptMatch?.[1]) {
          for (const symbol of parseIncludedAssetsFromText(exceptMatch[1])) includeAssets.add(symbol);
          continue;
        }

        const includeMatch = line.match(/(?:include_assets|only_assets|coinbase_assets)\s*:\s*(.+)$/i);
        if (includeMatch?.[1]) {
          for (const symbol of parseIncludedAssetsFromText(includeMatch[1])) includeAssets.add(symbol);
          continue;
        }

        const excludeMatch = line.match(/exclude_assets\s*:\s*(.+)$/i);
        if (excludeMatch?.[1]) {
          for (const symbol of parseIncludedAssetsFromText(excludeMatch[1])) excludeAssets.add(symbol);
          continue;
        }

        const decimalsMatch = line.match(/decimals\s*:\s*(\d+)/i) || line.match(/\bround(?:ed|ing)?\b.*?\b(\d+)\s+decimal/i);
        if (decimalsMatch?.[1]) {
          const parsed = Math.floor(Number(decimalsMatch[1]));
          if (Number.isFinite(parsed)) decimalPlaces = Math.max(0, Math.min(8, parsed));
          continue;
        }

        const noTs = /\b(no|hide|omit|remove)\b.*\b(timestamp|time)\b/i.test(line);
        const yesTs = /\b(show|include)\b.*\b(timestamp|time)\b/i.test(line);
        if (noTs) includeTimestamp = false;
        if (yesTs) includeTimestamp = true;

        const noFresh = /\b(no|hide|omit|remove)\b.*\bfreshness\b/i.test(line);
        const yesFresh = /\b(show|include)\b.*\bfreshness\b/i.test(line);
        if (noFresh) includeFreshness = false;
        if (yesFresh) includeFreshness = true;

        const explicitNetCashFlowMatch = line.match(/include_recent_net_cash_flow\s*:\s*(true|false)/i);
        if (explicitNetCashFlowMatch?.[1]) {
          includeRecentNetCashFlow = explicitNetCashFlowMatch[1].toLowerCase() === "true";
        }
        const noNetCashFlow = /\b(no|hide|omit|remove|exclude)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(line);
        const yesNetCashFlow = /\b(show|include|keep)\b.*\b(net\s*cash[-\s]?flow|p\s*&?\s*l\s*proxy|pnl\s*proxy|recent\s+net)\b/i.test(line);
        if (noNetCashFlow) includeRecentNetCashFlow = false;
        if (yesNetCashFlow) includeRecentNetCashFlow = true;

        if (/\biso\s*date\b/i.test(line) || /\byyyy-mm-dd\b/i.test(line)) dateFormat = "ISO_DATE";
        if (/\bmm\/dd\/yyyy\b/i.test(line) || /\bdate\s+only\b/i.test(line)) dateFormat = "MM/DD/YYYY";
      }

      if (
        includeAssets.size > 0 ||
        excludeAssets.size > 0 ||
        typeof decimalPlaces === "number" ||
        typeof includeTimestamp === "boolean" ||
        typeof includeFreshness === "boolean" ||
        typeof includeRecentNetCashFlow === "boolean" ||
        typeof dateFormat === "string"
      ) {
        return {
          includeAssets,
          excludeAssets,
          decimalPlaces,
          includeTimestamp,
          includeFreshness,
          includeRecentNetCashFlow,
          dateFormat,
          sourcePath: filePath,
          rules,
        };
      }
    } catch (e) {
      // Keep report generation resilient if user skill file is malformed.
      console.warn("[CoinbaseTools] Failed to read skill prefs from", filePath, (e as Error)?.message);
    }
  }
  return null;
}

function levenshteinDistance(aRaw: string, bRaw: string): number {
  const a = String(aRaw || "");
  const b = String(bRaw || "");
  if (!a) return b.length;
  if (!b) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function resolveBaseAsset(rawToken: unknown): {
  status: "resolved" | "ambiguous" | "unresolved";
  symbol: string;
  confidence: number;
  suggestion: string;
} {
  const clean = stripAssetToken(rawToken);
  if (!clean) {
    return { status: "unresolved", symbol: "", confidence: 0, suggestion: "" };
  }

  const upperClean = clean.toUpperCase();
  if ((KNOWN_SYMBOLS as readonly string[]).includes(upperClean)) {
    return { status: "resolved", symbol: upperClean, confidence: 1, suggestion: "" };
  }
  if (SYMBOL_ALIAS_TO_CANONICAL[clean]) {
    return { status: "resolved", symbol: SYMBOL_ALIAS_TO_CANONICAL[clean], confidence: 0.98, suggestion: "" };
  }

  const candidates = new Map<string, number>();
  for (const symbol of KNOWN_SYMBOLS) {
    const normalizedSymbol = String(symbol).toLowerCase();
    const dist = levenshteinDistance(clean, normalizedSymbol);
    const score = 1 - dist / Math.max(clean.length, normalizedSymbol.length);
    const prev = candidates.get(symbol) ?? -1;
    if (score > prev) candidates.set(symbol, score);
  }
  for (const [alias, symbol] of Object.entries(SYMBOL_ALIAS_TO_CANONICAL)) {
    const dist = levenshteinDistance(clean, alias);
    const score = 1 - dist / Math.max(clean.length, alias.length);
    const prev = candidates.get(symbol) ?? -1;
    if (score > prev) candidates.set(symbol, score);
  }

  const ranked = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  const topScore = Number(top?.[1] || 0);
  const margin = topScore - Number(second?.[1] || 0);
  const topSymbol = String(top?.[0] || "");
  const bestDistance = topSymbol ? levenshteinDistance(clean, topSymbol.toLowerCase()) : Number.POSITIVE_INFINITY;

  if (topSymbol && topScore >= 0.93) {
    return { status: "resolved", symbol: topSymbol, confidence: topScore, suggestion: "" };
  }
  if (topSymbol && clean.length <= 4 && bestDistance <= 1) {
    return { status: "ambiguous", symbol: "", confidence: 0.72, suggestion: topSymbol };
  }
  if (topSymbol && topScore >= 0.78 && margin >= 0.04) {
    return { status: "ambiguous", symbol: "", confidence: topScore, suggestion: topSymbol };
  }

  return { status: "unresolved", symbol: "", confidence: topScore, suggestion: topSymbol };
}

function normalizeSymbolPairInput(input: {
  symbolPair?: unknown;
  symbol?: unknown;
  quoteCurrency?: unknown;
}): {
  ok: boolean;
  symbolPair: string;
  confidence: "high" | "medium" | "low";
  suggestion: string;
  error?: string;
} {
  const quote = normalizeQuoteCurrency(input.quoteCurrency);
  const explicitPair = String(input.symbolPair || "").trim();
  if (explicitPair) {
    const parts = explicitPair.toUpperCase().replace(/\//g, "-").split("-");
    if (parts.length === 2 && /^[A-Z0-9]{2,10}$/.test(parts[0] || "") && /^[A-Z0-9]{2,10}$/.test(parts[1] || "")) {
      return { ok: true, symbolPair: `${parts[0]}-${parts[1]}`, confidence: "high", suggestion: "" };
    }
    return {
      ok: false,
      symbolPair: "",
      confidence: "low",
      suggestion: "",
      error: "Use symbol pair format like BTC-USD.",
    };
  }

  const rawSymbol = String(input.symbol || "").trim();
  if (!rawSymbol) {
    return {
      ok: false,
      symbolPair: "",
      confidence: "low",
      suggestion: "",
      error: "Ticker symbol is required (for example: BTC, ETH, SOL).",
    };
  }

  const resolved = resolveBaseAsset(rawSymbol);
  if (resolved.status === "resolved") {
    return {
      ok: true,
      symbolPair: `${resolved.symbol}-${quote}`,
      confidence: resolved.confidence >= 0.93 ? "high" : "medium",
      suggestion: "",
    };
  }
  if (resolved.status === "ambiguous") {
    return {
      ok: false,
      symbolPair: "",
      confidence: "medium",
      suggestion: resolved.suggestion,
      error: `Ambiguous ticker "${rawSymbol}". Did you mean ${resolved.suggestion}?`,
    };
  }
  return {
    ok: false,
    symbolPair: "",
    confidence: "low",
    suggestion: resolved.suggestion,
    error: `Unknown ticker "${rawSymbol}".`,
  };
}

function safeMessageForCode(code: string, actionLabel: string): string {
  if (code === "DISCONNECTED") {
    return `I couldn't verify Coinbase ${actionLabel} because your Coinbase integration is not connected.`;
  }
  if (code === "AUTH_UNSUPPORTED") {
    return `I couldn't verify Coinbase ${actionLabel} because private Coinbase authentication is unavailable for the current credentials.`;
  }
  if (code === "AUTH_FAILED") {
    return `I couldn't verify Coinbase ${actionLabel} because Coinbase rejected private-endpoint authentication.`;
  }
  if (code === "RATE_LIMITED") {
    return `I couldn't verify Coinbase ${actionLabel} right now because Coinbase rate limited the request.`;
  }
  if (code === "UPSTREAM_UNAVAILABLE" || code === "TIMEOUT" || code === "NETWORK") {
    return `I couldn't verify Coinbase ${actionLabel} right now due to a Coinbase/network issue.`;
  }
  return `I couldn't verify Coinbase ${actionLabel} right now.`;
}

function guidanceForCode(code: string): string {
  if (code === "DISCONNECTED") {
    return "Connect Coinbase in Integrations, save API key + private key, then click Reconnect.";
  }
  if (code === "AUTH_UNSUPPORTED") {
    return "Spot prices can work, but portfolio/transactions require a valid Advanced Trade key + private key with required read scopes. Re-save credentials in Integrations and reconnect.";
  }
  if (code === "AUTH_FAILED") {
    return `Verify this is a Secret API key + matching private key (not Client API key), required scopes are enabled (${COINBASE_REQUIRED_SCOPES.join(", ")}), and your current public IP/IPv6 is allowlisted in Coinbase.`;
  }
  if (code === "RATE_LIMITED") {
    return "Wait briefly and retry. Use caching for repeated requests.";
  }
  if (code === "UPSTREAM_UNAVAILABLE" || code === "TIMEOUT" || code === "NETWORK") {
    return "Retry in a moment; do not use stale/fabricated values.";
  }
  return "Retry in a moment or reconnect Coinbase if this persists.";
}

function toCoinbaseToolError(kind: string, err: unknown, actionLabel: string): CoinbaseToolErrorPayload {
  const mapped = asCoinbaseError(err, { code: "UNKNOWN", message: `Coinbase ${actionLabel} failed.` });
  return {
    ok: false,
    kind,
    source: "coinbase",
    errorCode: mapped.code,
    message: mapped.message,
    safeMessage: safeMessageForCode(mapped.code, actionLabel),
    guidance: guidanceForCode(mapped.code),
    retryable: Boolean(mapped.retryable),
    requiredScopes: [...COINBASE_REQUIRED_SCOPES],
  };
}

function createRequestContext(input: Record<string, unknown>): CoinbaseRequestContext {
  return {
    userContextId: toUserContextId(input.userContextId),
    conversationId: toConversationId(input.conversationId),
    missionRunId: String(input.missionRunId || "").trim().slice(0, 96),
  };
}

function getService(workspaceDir: string, userContextId: string): CoinbaseProvider {
  const root = path.resolve(workspaceDir || process.cwd());
  const normalizedUserContextId = toUserContextId(userContextId);
  if (!normalizedUserContextId) throw new Error("Missing userContextId.");
  const key = `${root}::${normalizedUserContextId}`;
  const existing = serviceByWorkspaceAndUser.get(key);
  if (existing?.service) return existing.service;

  const provider = new FileBackedCoinbaseCredentialProvider({
    workspaceRoot: root,
    cacheTtlMs: 15_000,
  });
  const dataStore = new CoinbaseDataStore(coinbaseDbPathForUserContext(normalizedUserContextId, root));
  const service = new CoinbaseService({
    credentialProvider: provider,
    authStrategy: createCoinbaseAutoAuthStrategy(),
    dataStore,
  });
  serviceByWorkspaceAndUser.set(key, { service, dataStore });
  evictOldestServiceIfNeeded();
  return service;
}

function getDataStore(workspaceDir: string, userContextId: string): CoinbaseDataStore | null {
  const root = path.resolve(workspaceDir || process.cwd());
  const normalizedUserContextId = toUserContextId(userContextId);
  if (!normalizedUserContextId) return null;
  const existing = serviceByWorkspaceAndUser.get(`${root}::${normalizedUserContextId}`);
  return existing?.dataStore || null;
}

function getPrivacySettings(workspaceDir: string, userContextId: string): {
  showBalances: boolean;
  showTransactions: boolean;
  requireTransactionConsent: boolean;
  transactionHistoryConsentGranted: boolean;
} {
  const defaults = {
    showBalances: true,
    showTransactions: true,
    requireTransactionConsent: true,
    transactionHistoryConsentGranted: false,
  };
  const normalizedUserContextId = toUserContextId(userContextId);
  if (!normalizedUserContextId) return defaults;
  const store = getDataStore(workspaceDir, userContextId);
  if (store) {
    const settings = store.getPrivacySettings(normalizedUserContextId);
    return {
      showBalances: settings.showBalances,
      showTransactions: settings.showTransactions,
      requireTransactionConsent: settings.requireTransactionConsent,
      transactionHistoryConsentGranted: settings.transactionHistoryConsentGranted,
    };
  }
  const root = path.resolve(workspaceDir || process.cwd());
  const directStore = new CoinbaseDataStore(coinbaseDbPathForUserContext(normalizedUserContextId, root));
  try {
    const settings = directStore.getPrivacySettings(normalizedUserContextId);
    return {
      showBalances: settings.showBalances,
      showTransactions: settings.showTransactions,
      requireTransactionConsent: settings.requireTransactionConsent,
      transactionHistoryConsentGranted: settings.transactionHistoryConsentGranted,
    };
  } catch {
    return defaults;
  } finally {
    directStore.close();
  }
}

function buildConsentRequiredError(kind: string): CoinbaseToolErrorPayload {
  return {
    ok: false,
    kind,
    source: "coinbase",
    errorCode: "CONSENT_REQUIRED",
    message: "Transaction-history consent is required before Coinbase transaction retrieval.",
    safeMessage: "I can't fetch transaction-level history until consent is granted.",
    guidance:
      "In Integrations -> Coinbase -> Privacy Controls, turn ON `Transaction Consent Granted` (or turn OFF `Require Consent`), then retry.",
    retryable: false,
    requiredScopes: [...COINBASE_REQUIRED_SCOPES],
  };
}

async function readCapabilitiesOrError(
  service: CoinbaseProvider,
  ctx: CoinbaseRequestContext,
  kind: string,
  actionLabel: string,
): Promise<{ ok: true; value: CoinbaseCapabilityStatus } | { ok: false; error: CoinbaseToolErrorPayload }> {
  try {
    const capabilities = await service.getCapabilities(ctx);
    return { ok: true, value: capabilities };
  } catch (err) {
    return { ok: false, error: toCoinbaseToolError(kind, err, actionLabel) };
  }
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeRecentFlowSummary(
  events: Array<{ side?: string; assetSymbol?: string; quantity?: number; price?: number | null }>,
): {
  recentFlowUpAssets: number;
  recentFlowDownAssets: number;
  recentNetNotionalUsd: number;
} {
  const flowByAsset = new Map<string, number>();
  let recentNetNotionalUsd = 0;
  for (const event of events) {
    const side = String(event?.side || "").trim().toLowerCase();
    const symbol = String(event?.assetSymbol || "").trim().toUpperCase();
    if (!symbol || (side !== "buy" && side !== "sell")) continue;
    const quantity = Math.max(0, toFiniteNumber(event?.quantity));
    const signedQty = side === "buy" ? quantity : -quantity;
    flowByAsset.set(symbol, toFiniteNumber(flowByAsset.get(symbol)) + signedQty);
    const price = Number(event?.price);
    if (Number.isFinite(price) && quantity > 0) {
      const signedNotional = side === "buy" ? -(quantity * price) : quantity * price;
      recentNetNotionalUsd += signedNotional;
    }
  }

  let recentFlowUpAssets = 0;
  let recentFlowDownAssets = 0;
  for (const netQty of flowByAsset.values()) {
    if (netQty > 0) recentFlowUpAssets += 1;
    else if (netQty < 0) recentFlowDownAssets += 1;
  }
  return {
    recentFlowUpAssets,
    recentFlowDownAssets,
    recentNetNotionalUsd,
  };
}

async function estimatePortfolioUsdTotal(params: {
  service: CoinbaseProvider;
  ctx: CoinbaseRequestContext;
  balances: Array<{ assetSymbol?: string; total?: number }>;
}): Promise<{
  estimatedTotalUsd: number;
  valuedAssetCount: number;
}> {
  const byAsset = new Map<string, number>();
  for (const balance of params.balances) {
    const symbol = String(balance?.assetSymbol || "").trim().toUpperCase();
    const total = toFiniteNumber(balance?.total);
    if (!symbol || total <= 0) continue;
    byAsset.set(symbol, toFiniteNumber(byAsset.get(symbol)) + total);
  }
  const symbols = [...byAsset.keys()].slice(0, 16);
  if (symbols.length === 0) return { estimatedTotalUsd: 0, valuedAssetCount: 0 };

  let estimatedTotalUsd = 0;
  let valuedAssetCount = 0;
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const spot = await params.service.getSpotPrice(params.ctx, {
          symbolPair: `${symbol}-USD`,
          bypassCache: false,
        });
        const price = Number(spot?.price);
        const qty = toFiniteNumber(byAsset.get(symbol));
        if (!Number.isFinite(price) || qty <= 0) return;
        estimatedTotalUsd += qty * price;
        valuedAssetCount += 1;
      } catch {
        // Best effort valuation only.
      }
    }),
  );

  return {
    estimatedTotalUsd,
    valuedAssetCount,
  };
}

function normalizePersonaTone(raw: unknown): "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed" {
  const tone = String(raw || "").trim().toLowerCase();
  if (tone === "enthusiastic" || tone === "calm" || tone === "direct" || tone === "relaxed") return tone;
  return "neutral";
}

function resolvePersonaMetaFromWorkspace(workspaceDir: string, userContextId: string): {
  assistantName: string;
  tone: "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed";
} {
  const uid = toUserContextId(userContextId);
  const root = path.resolve(workspaceDir || process.cwd());
  if (!uid) return { assistantName: "Nova", tone: "neutral" };
  const cacheKey = `${root}::${uid}`;
  const now = Date.now();
  const cached = personaMetaByWorkspaceAndUser.get(cacheKey);
  if (cached && now - cached.ts < PERSONA_META_CACHE_TTL_MS) return cached.value;
  const agentsPath = path.join(root, ".agent", "user-context", uid, "AGENTS.md");
  let assistantName = "Nova";
  let tone: "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed" = "neutral";
  try {
    if (!fs.existsSync(agentsPath)) return { assistantName, tone };
    const lines = fs.readFileSync(agentsPath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || "").trim();
      let match = line.match(/^-+\s*Assistant name:\s*(.+)$/i);
      if (match?.[1]) assistantName = String(match[1]).trim() || assistantName;
      match = line.match(/^-+\s*Tone:\s*(.+)$/i);
      if (match?.[1]) tone = normalizePersonaTone(match[1]);
    }
  } catch {
    // Use defaults when persona metadata is unavailable.
  }
  const value = { assistantName, tone };
  personaMetaByWorkspaceAndUser.set(cacheKey, { ts: now, value });
  return value;
}

export function createCoinbaseTools(params: { workspaceDir: string }): Tool[] {
  const capabilitiesTool: Tool = {
    name: "coinbase_capabilities",
    description: "Get Coinbase connection and capability status for this user context.",
    capabilities: ["network.crypto"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string", description: "Nova user context ID." },
        conversationId: { type: "string", description: "Optional conversation ID for audit logs." },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const ctx = createRequestContext(input || {});
      if (!ctx.userContextId) {
        return toJson({
          ok: false,
          kind: "coinbase_capabilities",
          source: "coinbase",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "I couldn't verify Coinbase status because user context is missing.",
          guidance: "Retry from an authenticated Nova chat session.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const rollout = resolveCoinbaseRolloutAccess(ctx.userContextId);
      if (!rollout.enabled) return toJson(rolloutBlockedError("coinbase_capabilities", ctx.userContextId));
      try {
        const service = getService(params.workspaceDir, ctx.userContextId);
        const capabilities = await service.getCapabilities(ctx);
        return toJson({
          ok: true,
          kind: "coinbase_capabilities",
          source: "coinbase",
          capabilities,
          checkedAtMs: Date.now(),
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      } catch (err) {
        return toJson(toCoinbaseToolError("coinbase_capabilities", err, "capabilities"));
      }
    },
  };

  const spotTool: Tool = {
    name: "coinbase_spot_price",
    description: "Fetch a live Coinbase spot price for a symbol pair (for example BTC-USD).",
    capabilities: ["network.crypto"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string", description: "Nova user context ID." },
        conversationId: { type: "string", description: "Optional conversation ID for audit logs." },
        symbolPair: { type: "string", description: "Symbol pair like BTC-USD or ETH-USD." },
        symbol: { type: "string", description: "Single base asset symbol like BTC or ETH." },
        quoteCurrency: { type: "string", description: "Optional quote currency, defaults to USD." },
        bypassCache: { type: "boolean", description: "Set true for hard refresh." },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const ctx = createRequestContext(input || {});
      if (!ctx.userContextId) {
        return toJson({
          ok: false,
          kind: "coinbase_spot_price",
          source: "coinbase",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "I couldn't verify Coinbase price because user context is missing.",
          guidance: "Retry from an authenticated Nova chat session.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }

      const normalizedPair = normalizeSymbolPairInput({
        symbolPair: input?.symbolPair,
        symbol: input?.symbol,
        quoteCurrency: input?.quoteCurrency,
      });
      if (!normalizedPair.ok) {
        return toJson({
          ok: false,
          kind: "coinbase_spot_price",
          source: "coinbase",
          errorCode: normalizedPair.confidence === "medium" ? "AMBIGUOUS_SYMBOL" : "BAD_INPUT",
          message: normalizedPair.error || "Invalid symbol input.",
          suggestion: normalizedPair.suggestion,
          confidence: normalizedPair.confidence,
          safeMessage: "I couldn't verify that ticker yet.",
          guidance: "Use a ticker symbol like BTC, ETH, SOL, or a pair like BTC-USD.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const rollout = resolveCoinbaseRolloutAccess(ctx.userContextId);
      if (!rollout.enabled) return toJson(rolloutBlockedError("coinbase_spot_price", ctx.userContextId));

      try {
        const service = getService(params.workspaceDir, ctx.userContextId);
        const data = await service.getSpotPrice(ctx, {
          symbolPair: normalizedPair.symbolPair,
          bypassCache: toBool(input?.bypassCache, false),
        });
        return toJson({
          ok: true,
          kind: "coinbase_spot_price",
          source: "coinbase",
          data,
          confidence: normalizedPair.confidence,
          checkedAtMs: Date.now(),
        });
      } catch (err) {
        return toJson(toCoinbaseToolError("coinbase_spot_price", err, "spot price"));
      }
    },
  };

  const portfolioTool: Tool = {
    name: "coinbase_portfolio_snapshot",
    description: "Fetch a Coinbase portfolio balance snapshot for this user context.",
    capabilities: ["network.crypto", "finance.portfolio.read"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string", description: "Nova user context ID." },
        conversationId: { type: "string", description: "Optional conversation ID for audit logs." },
        bypassCache: { type: "boolean", description: "Set true for hard refresh." },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const ctx = createRequestContext(input || {});
      if (!ctx.userContextId) {
        return toJson({
          ok: false,
          kind: "coinbase_portfolio_snapshot",
          source: "coinbase",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "I couldn't verify Coinbase portfolio because user context is missing.",
          guidance: "Retry from an authenticated Nova chat session.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const rollout = resolveCoinbaseRolloutAccess(ctx.userContextId);
      if (!rollout.enabled) return toJson(rolloutBlockedError("coinbase_portfolio_snapshot", ctx.userContextId));
      const service = getService(params.workspaceDir, ctx.userContextId);
      const caps = await readCapabilitiesOrError(service, ctx, "coinbase_portfolio_snapshot", "portfolio");
      if (!caps.ok) return toJson(caps.error);

      if (caps.value.portfolio === "unavailable") {
        return toJson({
          ok: false,
          kind: "coinbase_portfolio_snapshot",
          source: "coinbase",
          errorCode: "DISCONNECTED",
          message: caps.value.reason || "Coinbase portfolio access is unavailable.",
          safeMessage: "I couldn't verify Coinbase portfolio because your integration is disconnected.",
          guidance: guidanceForCode("DISCONNECTED"),
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }

      try {
        const privacy = getPrivacySettings(params.workspaceDir, ctx.userContextId);
        const data = await service.getPortfolioSnapshot(ctx, {
          bypassCache: toBool(input?.bypassCache, false),
        });
        const nonZeroBalances = data.balances.filter((entry) => Number(entry.total || 0) > 0);
        const valuation = await estimatePortfolioUsdTotal({
          service,
          ctx,
          balances: nonZeroBalances.map((entry) => ({ assetSymbol: entry.assetSymbol, total: entry.total })),
        });
        const resultBalances = privacy.showBalances
          ? data.balances
          : data.balances.map((entry) => ({ ...entry, available: 0, hold: 0, total: 0 }));
        return toJson({
          ok: true,
          kind: "coinbase_portfolio_snapshot",
          source: "coinbase",
          data: {
            ...data,
            balances: resultBalances,
          },
          summary: {
            assetCount: nonZeroBalances.length,
            totalAccounts: data.balances.length,
            balancesRedacted: !privacy.showBalances,
            estimatedTotalUsd: valuation.estimatedTotalUsd,
            valuedAssetCount: valuation.valuedAssetCount,
          },
          checkedAtMs: Date.now(),
        });
      } catch (err) {
        return toJson(toCoinbaseToolError("coinbase_portfolio_snapshot", err, "portfolio"));
      }
    },
  };

  const transactionsTool: Tool = {
    name: "coinbase_recent_transactions",
    description: "Fetch recent Coinbase transaction events for this user context.",
    capabilities: ["network.crypto", "finance.transactions.read"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string", description: "Nova user context ID." },
        conversationId: { type: "string", description: "Optional conversation ID for audit logs." },
        limit: { type: "number", description: "Number of recent transactions (1-30)." },
        bypassCache: { type: "boolean", description: "Set true for hard refresh." },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const ctx = createRequestContext(input || {});
      if (!ctx.userContextId) {
        return toJson({
          ok: false,
          kind: "coinbase_recent_transactions",
          source: "coinbase",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "I couldn't verify Coinbase transactions because user context is missing.",
          guidance: "Retry from an authenticated Nova chat session.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const rollout = resolveCoinbaseRolloutAccess(ctx.userContextId);
      if (!rollout.enabled) return toJson(rolloutBlockedError("coinbase_recent_transactions", ctx.userContextId));
      const service = getService(params.workspaceDir, ctx.userContextId);
      const caps = await readCapabilitiesOrError(service, ctx, "coinbase_recent_transactions", "transactions");
      if (!caps.ok) return toJson(caps.error);

      if (caps.value.transactions === "unavailable") {
        return toJson({
          ok: false,
          kind: "coinbase_recent_transactions",
          source: "coinbase",
          errorCode: "DISCONNECTED",
          message: caps.value.reason || "Coinbase transaction access is unavailable.",
          safeMessage: "I couldn't verify Coinbase transactions because your integration is disconnected.",
          guidance: guidanceForCode("DISCONNECTED"),
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const privacy = getPrivacySettings(params.workspaceDir, ctx.userContextId);
      if (privacy.requireTransactionConsent && !privacy.transactionHistoryConsentGranted) {
        return toJson(buildConsentRequiredError("coinbase_recent_transactions"));
      }

      try {
        const events = await service.getRecentTransactions(ctx, {
          limit: toInt(input?.limit, 8, 1, 30),
          bypassCache: toBool(input?.bypassCache, false),
        });
        const resultEvents = privacy.showTransactions
          ? events
          : events.map((event) => ({ ...event, quantity: 0, price: null, fee: null }));
        return toJson({
          ok: true,
          kind: "coinbase_recent_transactions",
          source: "coinbase",
          events: resultEvents,
          summary: {
            count: events.length,
            transactionsRedacted: !privacy.showTransactions,
          },
          checkedAtMs: Date.now(),
        });
      } catch (err) {
        return toJson(toCoinbaseToolError("coinbase_recent_transactions", err, "transactions"));
      }
    },
  };

  const reportTool: Tool = {
    name: "coinbase_portfolio_report",
    description: "Generate a concise Coinbase crypto report using portfolio and recent transactions.",
    capabilities: ["network.crypto", "finance.portfolio.read", "finance.transactions.read"],
    input_schema: {
      type: "object",
      properties: {
        userContextId: { type: "string", description: "Nova user context ID." },
        conversationId: { type: "string", description: "Optional conversation ID for audit logs." },
        transactionLimit: { type: "number", description: "Number of recent transactions to include (1-20)." },
        mode: { type: "string", description: "Report render mode: concise or detailed." },
      },
      required: ["userContextId"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const ctx = createRequestContext(input || {});
      if (!ctx.userContextId) {
        return toJson({
          ok: false,
          kind: "coinbase_portfolio_report",
          source: "coinbase",
          errorCode: "BAD_INPUT",
          message: "Missing userContextId.",
          safeMessage: "I couldn't verify Coinbase report because user context is missing.",
          guidance: "Retry from an authenticated Nova chat session.",
          retryable: false,
          requiredScopes: [...COINBASE_REQUIRED_SCOPES],
        });
      }
      const rollout = resolveCoinbaseRolloutAccess(ctx.userContextId);
      if (!rollout.enabled) return toJson(rolloutBlockedError("coinbase_portfolio_report", ctx.userContextId));
      const transactionLimit = toInt(input?.transactionLimit, 6, 1, 20);
      const mode = String(input?.mode || "").trim().toLowerCase() === "detailed" ? "detailed" : "concise";
      const startedAtMs = Date.now();
      // Initialise the service first so getPrivacySettings finds the DataStore in the
      // cache and avoids opening a second temporary SQLite connection on the first call.
      const service = getService(params.workspaceDir, ctx.userContextId);
      const privacy = getPrivacySettings(params.workspaceDir, ctx.userContextId);
      if (privacy.requireTransactionConsent && !privacy.transactionHistoryConsentGranted) {
        return toJson(buildConsentRequiredError("coinbase_portfolio_report"));
      }
      try {
        const portfolio = await service.getPortfolioSnapshot(ctx, { bypassCache: false });
        let transactions: Awaited<ReturnType<CoinbaseProvider["getRecentTransactions"]>> = [];
        let transactionsUnavailableReason = "";
        try {
          transactions = await service.getRecentTransactions(ctx, { limit: transactionLimit, bypassCache: false });
        } catch (error) {
          const mapped = asCoinbaseError(error, {
            code: "UNKNOWN",
            endpoint: "/api/v3/brokerage/orders/historical/fills",
            userContextId: ctx.userContextId,
          });
          if (mapped.code === "AUTH_FAILED" || mapped.code === "AUTH_UNSUPPORTED") {
            transactions = [];
            transactionsUnavailableReason = "Transaction history is unavailable for this key; generated balances-only report.";
          } else {
            throw error;
          }
        }
        const reportSkillPrefs = loadCoinbaseReportSkillPrefs(params.workspaceDir, ctx.userContextId);
        const filteredPortfolio = reportSkillPrefs
          ? {
              ...portfolio,
              balances: portfolio.balances.filter((entry) => {
                const symbol = String(entry.assetSymbol || "").toUpperCase();
                if (reportSkillPrefs.includeAssets.size > 0 && !reportSkillPrefs.includeAssets.has(symbol)) return false;
                if (reportSkillPrefs.excludeAssets.has(symbol)) return false;
                return true;
              }),
            }
          : portfolio;
        const filteredTransactions = reportSkillPrefs
          ? transactions.filter((event) => {
              const symbol = String(event.assetSymbol || "").toUpperCase();
              if (reportSkillPrefs.includeAssets.size > 0 && !reportSkillPrefs.includeAssets.has(symbol)) return false;
              if (reportSkillPrefs.excludeAssets.has(symbol)) return false;
              return true;
            })
          : transactions;
        const portfolioOut = privacy.showBalances
          ? filteredPortfolio
          : {
              ...filteredPortfolio,
              balances: filteredPortfolio.balances.map((entry) => ({ ...entry, available: 0, hold: 0, total: 0 })),
            };
        const transactionsOut = privacy.showTransactions
          ? filteredTransactions
          : filteredTransactions.map((event) => ({ ...event, quantity: 0, price: null, fee: null }));
        const [valuation, recentFlow] = await Promise.all([
          estimatePortfolioUsdTotal({
            service,
            ctx,
            balances: portfolioOut.balances,
          }),
          Promise.resolve(computeRecentFlowSummary(transactionsOut)),
        ]);
        const generatedAtMs = Date.now();
        const personaMeta = resolvePersonaMetaFromWorkspace(params.workspaceDir, ctx.userContextId);
        const personalityComment = buildCoinbasePnlPersonalityComment({
          assistantName: personaMeta.assistantName,
          tone: personaMeta.tone,
          cadence: "report",
          estimatedTotalUsd: valuation.estimatedTotalUsd,
          recentNetNotionalUsd: recentFlow.recentNetNotionalUsd,
          transactionCount: filteredTransactions.length,
          valuedAssetCount: valuation.valuedAssetCount,
          freshnessMs: portfolioOut.freshnessMs,
          thresholdPct: 10,
          minAbsoluteNotionalUsd: 250,
          minTransactionCount: 3,
          maxFreshnessMs: 6 * 60 * 60 * 1000,
          seedKey: `${ctx.userContextId}:${generatedAtMs}:${mode}`,
        });
        const rendered = renderCoinbasePortfolioReport({
          mode,
          source: "coinbase",
          generatedAtMs,
          portfolio: portfolioOut,
          transactions: transactionsOut,
          personalityComment,
          preferences: reportSkillPrefs
            ? {
                decimalPlaces: reportSkillPrefs.decimalPlaces,
                includeTimestamp: reportSkillPrefs.includeTimestamp,
                includeFreshness: reportSkillPrefs.includeFreshness,
                dateFormat: reportSkillPrefs.dateFormat,
              }
            : undefined,
        });
        getDataStore(params.workspaceDir, ctx.userContextId)?.appendReportHistory({
          userContextId: ctx.userContextId,
          missionRunId: "",
          reportType: mode === "detailed" ? "portfolio_detailed" : "portfolio_concise",
          deliveredChannel: "tool_loop",
          deliveredAtMs: generatedAtMs,
          payload: {
            mode,
            summary: {
              nonZeroAssetCount: filteredPortfolio.balances.filter((entry) => Number(entry.total || 0) > 0).length,
              transactionCount: filteredTransactions.length,
              estimatedTotalUsd: valuation.estimatedTotalUsd,
              valuedAssetCount: valuation.valuedAssetCount,
              recentFlowUpAssets: recentFlow.recentFlowUpAssets,
              recentFlowDownAssets: recentFlow.recentFlowDownAssets,
              recentNetNotionalUsd: recentFlow.recentNetNotionalUsd,
              includeRecentNetCashFlow: reportSkillPrefs?.includeRecentNetCashFlow !== false,
              transactionsUnavailableReason,
              assetFilter:
                reportSkillPrefs && reportSkillPrefs.includeAssets.size > 0
                  ? [...reportSkillPrefs.includeAssets]
                  : [],
              assetExcludeFilter:
                reportSkillPrefs && reportSkillPrefs.excludeAssets.size > 0
                  ? [...reportSkillPrefs.excludeAssets]
                  : [],
              decimalPlaces: reportSkillPrefs?.decimalPlaces ?? 2,
            },
          },
        });
        recordCoinbaseStructuredLog({
          ts: new Date().toISOString(),
          provider: "coinbase",
          event: "coinbase.report.generate",
          endpoint: "tool.coinbase_portfolio_report",
          status: "ok",
          userContextId: ctx.userContextId,
          conversationId: ctx.conversationId,
          missionRunId: ctx.missionRunId,
          latencyMs: Date.now() - startedAtMs,
          details: { mode, transactionLimit, source: "coinbase" },
        });
        recordCoinbaseMetric({
          endpoint: "tool.coinbase_portfolio_report",
          ok: true,
          latencyMs: Date.now() - startedAtMs,
          statusClass: "2xx",
          category: "report",
        });
        return toJson({
          ok: true,
          kind: "coinbase_portfolio_report",
          source: "coinbase",
          report: {
            generatedAtMs,
            mode,
            rendered,
            portfolio: portfolioOut,
            transactions: transactionsOut,
            summary: {
              nonZeroAssetCount: filteredPortfolio.balances.filter((entry) => Number(entry.total || 0) > 0).length,
              transactionCount: filteredTransactions.length,
              balancesRedacted: !privacy.showBalances,
              transactionsRedacted: !privacy.showTransactions,
              estimatedTotalUsd: valuation.estimatedTotalUsd,
              valuedAssetCount: valuation.valuedAssetCount,
              recentFlowUpAssets: recentFlow.recentFlowUpAssets,
              recentFlowDownAssets: recentFlow.recentFlowDownAssets,
              recentNetNotionalUsd: recentFlow.recentNetNotionalUsd,
              includeRecentNetCashFlow: reportSkillPrefs?.includeRecentNetCashFlow !== false,
              transactionsUnavailableReason,
              assetFilter:
                reportSkillPrefs && reportSkillPrefs.includeAssets.size > 0
                  ? [...reportSkillPrefs.includeAssets]
                  : [],
              assetExcludeFilter:
                reportSkillPrefs && reportSkillPrefs.excludeAssets.size > 0
                  ? [...reportSkillPrefs.excludeAssets]
                  : [],
              reportRules: reportSkillPrefs?.rules || [],
              decimalPlaces: reportSkillPrefs?.decimalPlaces ?? 2,
              assetFilterSource: reportSkillPrefs?.sourcePath || "",
            },
          },
        });
      } catch (err) {
        const mapped = asCoinbaseError(err, { code: "UNKNOWN", endpoint: "tool.coinbase_portfolio_report", userContextId: ctx.userContextId });
        recordCoinbaseStructuredLog({
          ts: new Date().toISOString(),
          provider: "coinbase",
          event: "coinbase.report.generate",
          endpoint: "tool.coinbase_portfolio_report",
          status: "error",
          userContextId: ctx.userContextId,
          conversationId: ctx.conversationId,
          missionRunId: ctx.missionRunId,
          latencyMs: Date.now() - startedAtMs,
          errorCode: mapped.code,
          message: mapped.message,
          details: { mode, transactionLimit },
        });
        recordCoinbaseMetric({
          endpoint: "tool.coinbase_portfolio_report",
          ok: false,
          latencyMs: Date.now() - startedAtMs,
          errorCode: mapped.code,
          statusClass: mapped.code === "AUTH_FAILED" ? "401" : "5xx",
          category: "report",
        });
        return toJson(toCoinbaseToolError("coinbase_portfolio_report", err, "portfolio report"));
      }
    },
  };

  return [capabilitiesTool, spotTool, portfolioTool, transactionsTool, reportTool];
}
