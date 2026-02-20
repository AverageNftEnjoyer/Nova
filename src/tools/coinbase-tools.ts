import path from "node:path";

import {
  asCoinbaseError,
  CoinbaseDataStore,
  CoinbaseService,
  FileBackedCoinbaseCredentialProvider,
  type CoinbaseCapabilityStatus,
  type CoinbaseProvider,
  type CoinbaseRequestContext,
} from "../integrations/coinbase/index.js";
import type { Tool } from "./types.js";

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

type ServiceState = {
  service: CoinbaseProvider;
};

const serviceByWorkspace = new Map<string, ServiceState>();

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
    return `I couldn't verify Coinbase ${actionLabel} because private Coinbase auth is not enabled in this runtime yet.`;
  }
  if (code === "AUTH_FAILED") {
    return `I couldn't verify Coinbase ${actionLabel} because Coinbase rejected the credentials or scopes.`;
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
    return "Spot prices are available; portfolio and transactions need private-endpoint auth strategy wiring.";
  }
  if (code === "AUTH_FAILED") {
    return `Verify required scopes: ${COINBASE_REQUIRED_SCOPES.join(", ")} and ensure the key pair is valid.`;
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
  };
}

function getService(workspaceDir: string): CoinbaseProvider {
  const root = path.resolve(workspaceDir || process.cwd());
  const existing = serviceByWorkspace.get(root);
  if (existing?.service) return existing.service;

  const provider = new FileBackedCoinbaseCredentialProvider({
    workspaceRoot: root,
    cacheTtlMs: 15_000,
  });
  const dataStore = new CoinbaseDataStore(path.join(root, ".agent", "coinbase", "coinbase.sqlite"));
  const service = new CoinbaseService({
    credentialProvider: provider,
    dataStore,
  });
  serviceByWorkspace.set(root, { service });
  return service;
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

export function createCoinbaseTools(params: { workspaceDir: string }): Tool[] {
  const service = getService(params.workspaceDir);

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
      try {
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

      try {
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
        const data = await service.getPortfolioSnapshot(ctx, {
          bypassCache: toBool(input?.bypassCache, false),
        });
        const nonZeroBalances = data.balances.filter((entry) => Number(entry.total || 0) > 0);
        return toJson({
          ok: true,
          kind: "coinbase_portfolio_snapshot",
          source: "coinbase",
          data,
          summary: {
            assetCount: nonZeroBalances.length,
            totalAccounts: data.balances.length,
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

      try {
        const events = await service.getRecentTransactions(ctx, {
          limit: toInt(input?.limit, 8, 1, 30),
          bypassCache: toBool(input?.bypassCache, false),
        });
        return toJson({
          ok: true,
          kind: "coinbase_recent_transactions",
          source: "coinbase",
          events,
          summary: {
            count: events.length,
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
      const transactionLimit = toInt(input?.transactionLimit, 6, 1, 20);
      try {
        const [portfolio, transactions] = await Promise.all([
          service.getPortfolioSnapshot(ctx, { bypassCache: false }),
          service.getRecentTransactions(ctx, { limit: transactionLimit, bypassCache: false }),
        ]);
        return toJson({
          ok: true,
          kind: "coinbase_portfolio_report",
          source: "coinbase",
          report: {
            generatedAtMs: Date.now(),
            portfolio,
            transactions,
            summary: {
              nonZeroAssetCount: portfolio.balances.filter((entry) => Number(entry.total || 0) > 0).length,
              transactionCount: transactions.length,
            },
          },
        });
      } catch (err) {
        return toJson(toCoinbaseToolError("coinbase_portfolio_report", err, "portfolio report"));
      }
    },
  };

  return [capabilitiesTool, spotTool, portfolioTool, transactionsTool, reportTool];
}
