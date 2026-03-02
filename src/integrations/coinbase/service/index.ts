import { MemoryTtlCache } from "../cache/index.js";
import { CoinbaseCircuitBreaker } from "../circuit-breaker/index.js";
import { CoinbaseHttpClient } from "../client/index.js";
import { CoinbaseError, asCoinbaseError } from "../errors/index.js";
import { recordCoinbaseMetric, recordCoinbaseStructuredLog } from "../observability/index.js";
import { CoinbaseRateLimitAdapter } from "../rate-limit/index.js";
import { CoinbaseDataStore } from "../store/index.js";
import type {
  CoinbaseAuthStrategy,
  CoinbaseBalance,
  CoinbaseCapabilityStatus,
  CoinbaseCredentialProvider,
  CoinbaseCredentials,
  CoinbaseHealthProbeResult,
  CoinbaseMarketPrice,
  CoinbasePortfolioParams,
  CoinbasePortfolioSnapshot,
  CoinbaseProvider,
  CoinbaseRequestContext,
  CoinbaseSpotPriceParams,
  CoinbaseTransactionEvent,
  CoinbaseTransactionsParams,
} from "../types/index.js";

type CacheRecord = {
  value: unknown;
  fetchedAtMs: number;
};

export interface CoinbaseServiceOptions {
  credentialProvider: CoinbaseCredentialProvider;
  authStrategy?: CoinbaseAuthStrategy | null;
  baseUrl?: string;
  cacheTtlMs?: {
    market?: number;
    portfolio?: number;
    transactions?: number;
  };
  cache?: MemoryTtlCache<CacheRecord>;
  rateLimiter?: CoinbaseRateLimitAdapter;
  dataStore?: CoinbaseDataStore | null;
  circuitBreaker?: CoinbaseCircuitBreaker;
}

type CoinbasePriceResponse = {
  data?: {
    amount?: string;
    base?: string;
    currency?: string;
  };
};

type CoinbaseAccountsResponse = {
  accounts?: Array<{
    uuid?: string;
    name?: string;
    type?: string;
    currency?: string;
    available_balance?: { value?: string };
    hold?: { value?: string };
  }>;
};

type CoinbaseFillsResponse = {
  fills?: Array<{
    entry_id?: string;
    side?: string;
    size?: string;
    price?: string;
    commission?: string;
    trade_time?: string;
    product_id?: string;
    order_status?: string;
  }>;
};

export class CoinbaseService implements CoinbaseProvider {
  private readonly credentialProvider: CoinbaseCredentialProvider;
  private readonly authStrategy: CoinbaseAuthStrategy | null;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: { market: number; portfolio: number; transactions: number };
  private readonly cache: MemoryTtlCache<CacheRecord>;
  private readonly rateLimiter: CoinbaseRateLimitAdapter;
  private readonly dataStore: CoinbaseDataStore | null;
  private readonly circuitBreaker: CoinbaseCircuitBreaker;

  constructor(options: CoinbaseServiceOptions) {
    this.credentialProvider = options.credentialProvider;
    this.authStrategy = options.authStrategy || null;
    this.baseUrl = String(options.baseUrl || "https://api.coinbase.com").trim();
    this.cacheTtlMs = {
      market: Math.max(1_000, Math.floor(Number(options.cacheTtlMs?.market || 30_000))),
      portfolio: Math.max(1_000, Math.floor(Number(options.cacheTtlMs?.portfolio || 20_000))),
      transactions: Math.max(1_000, Math.floor(Number(options.cacheTtlMs?.transactions || 15_000))),
    };
    this.cache = options.cache || new MemoryTtlCache<CacheRecord>({ maxEntries: 2_000 });
    this.rateLimiter = options.rateLimiter || new CoinbaseRateLimitAdapter();
    this.dataStore = options.dataStore || null;
    this.circuitBreaker = options.circuitBreaker || new CoinbaseCircuitBreaker();
  }

  public async getCapabilities(ctx: CoinbaseRequestContext): Promise<CoinbaseCapabilityStatus> {
    const userContextId = normalizeUserContextId(ctx.userContextId);
    if (!userContextId) {
      return {
        status: "disconnected",
        marketData: "unavailable",
        portfolio: "unavailable",
        transactions: "unavailable",
        reason: "Missing userContextId.",
      };
    }

    const credentials = await this.credentialProvider.resolve(userContextId);
    if (!credentials || !credentials.connected || !credentials.apiKey || !credentials.apiSecret) {
      this.writeAudit({
        userContextId,
        eventType: "coinbase.capabilities",
        status: "error",
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        details: { reason: "missing_credentials" },
      });
      return {
        status: "disconnected",
        marketData: "unavailable",
        portfolio: "unavailable",
        transactions: "unavailable",
        reason: "Coinbase credentials are not connected for this user.",
      };
    }

    const privateAvailable = this.authStrategy !== null;
    this.writeAudit({
      userContextId,
      eventType: "coinbase.capabilities",
      status: privateAvailable ? "ok" : "error",
      conversationId: ctx.conversationId,
      missionRunId: ctx.missionRunId,
      details: { privateAvailable },
    });
    return {
      status: privateAvailable ? "connected" : "degraded",
      marketData: "available",
      portfolio: privateAvailable ? "available" : "degraded",
      transactions: privateAvailable ? "available" : "degraded",
      reason: privateAvailable ? undefined : "Private endpoint auth strategy is not configured.",
    };
  }

  public async probeHealth(ctx: CoinbaseRequestContext): Promise<CoinbaseHealthProbeResult> {
    const startedAt = Date.now();
    const capabilities = await this.getCapabilities(ctx);
    if (capabilities.status === "disconnected") {
      return {
        ok: false,
        status: "disconnected",
        checkedAtMs: Date.now(),
        latencyMs: Date.now() - startedAt,
        capabilities,
        errorCode: "DISCONNECTED",
        message: capabilities.reason || "Coinbase is not connected.",
      };
    }

    try {
      await this.getSpotPrice(ctx, { symbolPair: "BTC-USD", bypassCache: true });
      return {
        ok: true,
        status: capabilities.status,
        checkedAtMs: Date.now(),
        latencyMs: Date.now() - startedAt,
        capabilities,
      };
    } catch (error) {
      const mapped = asCoinbaseError(error, { code: "UNKNOWN" });
      return {
        ok: false,
        status: capabilities.status === "connected" ? "degraded" : capabilities.status,
        checkedAtMs: Date.now(),
        latencyMs: Date.now() - startedAt,
        capabilities,
        errorCode: mapped.code,
        message: mapped.message,
      };
    }
  }

  public async getSpotPrice(ctx: CoinbaseRequestContext, params: CoinbaseSpotPriceParams): Promise<CoinbaseMarketPrice> {
    const userContextId = requireUserContextId(ctx.userContextId);
    const normalizedPair = normalizeSymbolPair(params.symbolPair);
    const cacheKey = `coinbase:spot:${userContextId}:${normalizedPair}`;
    const now = Date.now();

    if (!params.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached?.value && typeof cached.value === "object") {
        const value = cached.value as CoinbaseMarketPrice;
        return {
          ...value,
          freshnessMs: Math.max(0, now - value.fetchedAtMs),
        };
      }
    }

    const endpoint = "/v2/prices/:symbol/spot";
    const fresh = await this.rateLimiter.run(userContextId, async () => {
      const gate = this.circuitBreaker.canRequest(endpoint);
      if (!gate.ok) {
        throw new CoinbaseError({
          code: "UPSTREAM_UNAVAILABLE",
          message: `Coinbase circuit is open for ${endpoint}.`,
          retryable: true,
          endpoint,
          userContextId,
          retryAfterMs: gate.retryAfterMs,
        });
      }
      const startedAtMs = Date.now();
      const credentials = await this.requireCredentials(userContextId);
      const client = this.createClient(credentials, { timeoutMs: 4_000, maxRetries: 1 });
      try {
        const payload = await client.getPublicJson<CoinbasePriceResponse>(`/v2/prices/${normalizedPair}/spot`, { userContextId });
      const amountRaw = String(payload?.data?.amount || "").trim();
      const amount = Number.parseFloat(amountRaw);
      if (!Number.isFinite(amount)) {
        throw new CoinbaseError({
          code: "INVALID_RESPONSE",
          message: `Coinbase spot price response missing numeric amount for ${normalizedPair}.`,
          userContextId,
          endpoint: `/v2/prices/${normalizedPair}/spot`,
        });
      }

      const quoteAsset = String(payload?.data?.currency || normalizedPair.split("-")[1] || "USD").toUpperCase();
      const baseAsset = String(payload?.data?.base || normalizedPair.split("-")[0] || "").toUpperCase();
      const fetchedAtMs = Date.now();
      const model: CoinbaseMarketPrice = {
        symbolPair: normalizedPair,
        baseAsset,
        quoteAsset,
        price: amount,
        priceText: amountRaw || amount.toString(),
        fetchedAtMs,
        freshnessMs: 0,
        source: "coinbase",
      };
      this.cache.set(cacheKey, { value: model, fetchedAtMs }, this.cacheTtlMs.market);
      this.writeSnapshot({
        userContextId,
        snapshotType: "spot_price",
        symbolPair: normalizedPair,
        payload: model,
        fetchedAtMs: model.fetchedAtMs,
        freshnessMs: model.freshnessMs,
      });
      this.writeAudit({
        userContextId,
        eventType: "coinbase.spot_price",
        status: "ok",
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        details: { symbolPair: normalizedPair, source: model.source },
      });
      this.recordRequestTelemetry({
        event: "coinbase.spot_price",
        endpoint,
        ok: true,
        userContextId,
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        latencyMs: Date.now() - startedAtMs,
      });
      this.circuitBreaker.onSuccess(endpoint);
      return model;
      } catch (error) {
        const mapped = asCoinbaseError(error, { code: "UNKNOWN", endpoint, userContextId });
        this.circuitBreaker.onFailure(endpoint);
        this.recordRequestTelemetry({
          event: "coinbase.spot_price",
          endpoint,
          ok: false,
          errorCode: mapped.code,
          userContextId,
          conversationId: ctx.conversationId,
          missionRunId: ctx.missionRunId,
          latencyMs: Date.now() - startedAtMs,
          message: mapped.message,
        });
        throw error;
      }
    });

    return fresh;
  }

  public async getPortfolioSnapshot(
    ctx: CoinbaseRequestContext,
    params: CoinbasePortfolioParams = {},
  ): Promise<CoinbasePortfolioSnapshot> {
    const userContextId = requireUserContextId(ctx.userContextId);
    const cacheKey = `coinbase:portfolio:${userContextId}`;
    const now = Date.now();

    if (!params.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached?.value && typeof cached.value === "object") {
        const value = cached.value as CoinbasePortfolioSnapshot;
        return { ...value, freshnessMs: Math.max(0, now - value.fetchedAtMs) };
      }
    }

    const endpoint = "/api/v3/brokerage/accounts";
    const fresh = await this.rateLimiter.run(userContextId, async () => {
      const gate = this.circuitBreaker.canRequest(endpoint);
      if (!gate.ok) {
        throw new CoinbaseError({
          code: "UPSTREAM_UNAVAILABLE",
          message: `Coinbase circuit is open for ${endpoint}.`,
          retryable: true,
          endpoint,
          userContextId,
          retryAfterMs: gate.retryAfterMs,
        });
      }
      const startedAtMs = Date.now();
      const credentials = await this.requireCredentials(userContextId);
      const client = this.createClient(credentials, { timeoutMs: 6_000, maxRetries: 1 });
      try {
        const payload = await client.getPrivateJson<CoinbaseAccountsResponse>("/api/v3/brokerage/accounts", {
        userContextId,
        credentials,
      });

      const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
      if (accounts.length === 0) {
        throw new CoinbaseError({
          code: "INVALID_RESPONSE",
          message: "Coinbase accounts response was empty or malformed.",
          endpoint: "/api/v3/brokerage/accounts",
          userContextId,
        });
      }

      const balances: CoinbaseBalance[] = accounts.map((account) => {
        const available = toFiniteNumber(account?.available_balance?.value);
        const hold = toFiniteNumber(account?.hold?.value);
        return {
          accountId: String(account?.uuid || "").trim(),
          accountName: String(account?.name || "").trim() || "Coinbase Account",
          accountType: String(account?.type || "").trim() || "unknown",
          assetSymbol: String(account?.currency || "").trim().toUpperCase() || "UNKNOWN",
          available,
          hold,
          total: available + hold,
        };
      });

      const fetchedAtMs = Date.now();
      const model: CoinbasePortfolioSnapshot = {
        balances,
        fetchedAtMs,
        freshnessMs: 0,
        source: "coinbase",
      };
      this.cache.set(cacheKey, { value: model, fetchedAtMs }, this.cacheTtlMs.portfolio);
      this.writeSnapshot({
        userContextId,
        snapshotType: "portfolio",
        payload: model,
        fetchedAtMs: model.fetchedAtMs,
        freshnessMs: model.freshnessMs,
      });
      this.writeAudit({
        userContextId,
        eventType: "coinbase.portfolio",
        status: "ok",
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        details: { balances: model.balances.length, source: model.source },
      });
      this.recordRequestTelemetry({
        event: "coinbase.portfolio",
        endpoint,
        ok: true,
        userContextId,
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        latencyMs: Date.now() - startedAtMs,
      });
      this.circuitBreaker.onSuccess(endpoint);
      return model;
      } catch (error) {
        const mapped = asCoinbaseError(error, { code: "UNKNOWN", endpoint, userContextId });
        this.circuitBreaker.onFailure(endpoint);
        this.recordRequestTelemetry({
          event: "coinbase.portfolio",
          endpoint,
          ok: false,
          errorCode: mapped.code,
          userContextId,
          conversationId: ctx.conversationId,
          missionRunId: ctx.missionRunId,
          latencyMs: Date.now() - startedAtMs,
          message: mapped.message,
        });
        throw error;
      }
    });

    return fresh;
  }

  public async getRecentTransactions(
    ctx: CoinbaseRequestContext,
    params: CoinbaseTransactionsParams = {},
  ): Promise<CoinbaseTransactionEvent[]> {
    const userContextId = requireUserContextId(ctx.userContextId);
    const limit = clampInt(params.limit ?? 25, 1, 100);
    const cacheKey = `coinbase:transactions:${userContextId}:limit=${limit}`;

    if (!params.bypassCache) {
      const cached = this.cache.get(cacheKey);
      if (cached?.value && Array.isArray(cached.value)) {
        return cached.value as CoinbaseTransactionEvent[];
      }
    }

    const endpoint = "/api/v3/brokerage/orders/historical/fills";
    const fresh = await this.rateLimiter.run(userContextId, async () => {
      const gate = this.circuitBreaker.canRequest(endpoint);
      if (!gate.ok) {
        throw new CoinbaseError({
          code: "UPSTREAM_UNAVAILABLE",
          message: `Coinbase circuit is open for ${endpoint}.`,
          retryable: true,
          endpoint,
          userContextId,
          retryAfterMs: gate.retryAfterMs,
        });
      }
      const startedAtMs = Date.now();
      const credentials = await this.requireCredentials(userContextId);
      const client = this.createClient(credentials, { timeoutMs: 6_000, maxRetries: 1 });
      try {
        const payload = await client.getPrivateJson<CoinbaseFillsResponse>("/api/v3/brokerage/orders/historical/fills", {
        userContextId,
        credentials,
        query: { limit },
      });

      const fills = Array.isArray(payload?.fills) ? payload.fills : [];
      if (!Array.isArray(payload?.fills)) {
        throw new CoinbaseError({
          code: "INVALID_RESPONSE",
          message: "Coinbase fills response was malformed.",
          endpoint: "/api/v3/brokerage/orders/historical/fills",
          userContextId,
        });
      }

      const events: CoinbaseTransactionEvent[] = fills.map((fill) => {
        const productId = String(fill?.product_id || "").trim().toUpperCase();
        const assetSymbol = productId.includes("-") ? productId.split("-")[0] : (productId || "UNKNOWN");
        const sideRaw = String(fill?.side || "").trim().toLowerCase();
        const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : "other";
        return {
          id: String(fill?.entry_id || "").trim() || `${productId}:${fill?.trade_time || ""}`,
          side,
          assetSymbol,
          quantity: toFiniteNumber(fill?.size),
          price: toNullableFiniteNumber(fill?.price),
          fee: toNullableFiniteNumber(fill?.commission),
          occurredAtMs: parseDateMs(fill?.trade_time),
          status: String(fill?.order_status || "").trim() || "unknown",
        };
      });

      this.cache.set(cacheKey, { value: events, fetchedAtMs: Date.now() }, this.cacheTtlMs.transactions);
      this.writeSnapshot({
        userContextId,
        snapshotType: "transactions",
        payload: { items: events, limit },
        fetchedAtMs: Date.now(),
        freshnessMs: 0,
      });
      this.writeAudit({
        userContextId,
        eventType: "coinbase.transactions",
        status: "ok",
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        details: { count: events.length, limit },
      });
      this.recordRequestTelemetry({
        event: "coinbase.transactions",
        endpoint,
        ok: true,
        userContextId,
        conversationId: ctx.conversationId,
        missionRunId: ctx.missionRunId,
        latencyMs: Date.now() - startedAtMs,
      });
      this.circuitBreaker.onSuccess(endpoint);
      return events;
      } catch (error) {
        const mapped = asCoinbaseError(error, { code: "UNKNOWN", endpoint, userContextId });
        this.circuitBreaker.onFailure(endpoint);
        this.recordRequestTelemetry({
          event: "coinbase.transactions",
          endpoint,
          ok: false,
          errorCode: mapped.code,
          userContextId,
          conversationId: ctx.conversationId,
          missionRunId: ctx.missionRunId,
          latencyMs: Date.now() - startedAtMs,
          message: mapped.message,
        });
        throw error;
      }
    });

    return fresh;
  }

  public invalidateUserCache(userContextId: string): void {
    const normalized = normalizeUserContextId(userContextId);
    if (!normalized) return;
    this.cache.invalidatePrefix(`coinbase:spot:${normalized}:`);
    this.cache.invalidatePrefix(`coinbase:portfolio:${normalized}`);
    this.cache.invalidatePrefix(`coinbase:transactions:${normalized}:`);
    this.rateLimiter.invalidateUser(normalized);
    this.writeAudit({
      userContextId: normalized,
      eventType: "coinbase.cache_invalidate",
      status: "ok",
      details: {},
    });
  }

  private createClient(credentials: CoinbaseCredentials, options?: { timeoutMs?: number; maxRetries?: number }): CoinbaseHttpClient {
    return new CoinbaseHttpClient({
      baseUrl: String(credentials.baseUrl || this.baseUrl).trim() || this.baseUrl,
      authStrategy: this.authStrategy,
      timeoutMs: options?.timeoutMs ?? 6_000,
      maxRetries: options?.maxRetries ?? 1,
    });
  }

  private async requireCredentials(userContextId: string): Promise<CoinbaseCredentials> {
    const credentials = await this.credentialProvider.resolve(userContextId);
    if (!credentials || !credentials.connected) {
      this.recordRequestTelemetry({
        event: "coinbase.auth",
        endpoint: "auth.resolve",
        ok: false,
        errorCode: "DISCONNECTED",
        userContextId,
      });
      throw new CoinbaseError({
        code: "DISCONNECTED",
        message: `Coinbase credentials are not connected for user ${userContextId}.`,
        userContextId,
      });
    }
    if (!credentials.apiKey || !credentials.apiSecret) {
      this.recordRequestTelemetry({
        event: "coinbase.auth",
        endpoint: "auth.resolve",
        ok: false,
        errorCode: "AUTH_FAILED",
        userContextId,
      });
      throw new CoinbaseError({
        code: "DISCONNECTED",
        message: `Coinbase credentials are incomplete for user ${userContextId}.`,
        userContextId,
      });
    }
    this.dataStore?.upsertConnectionMetadata({
      userContextId,
      connected: true,
      mode: "api_key_pair",
      keyFingerprint: createKeyFingerprint(credentials.apiKey),
    });
    this.recordRequestTelemetry({
      event: "coinbase.auth",
      endpoint: "auth.resolve",
      ok: true,
      userContextId,
      category: "refresh",
    });
    return credentials;
  }

  private recordRequestTelemetry(input: {
    event: string;
    endpoint: string;
    ok: boolean;
    userContextId: string;
    conversationId?: string;
    missionRunId?: string;
    latencyMs?: number;
    errorCode?: string;
    message?: string;
    category?: "request" | "report" | "refresh";
  }): void {
    recordCoinbaseStructuredLog({
      ts: new Date().toISOString(),
      provider: "coinbase",
      event: input.event,
      endpoint: input.endpoint,
      status: input.ok ? "ok" : "error",
      userContextId: input.userContextId,
      conversationId: input.conversationId,
      missionRunId: input.missionRunId,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
      message: input.message,
    });
    const statusClass =
      input.ok ? "2xx" :
      input.errorCode === "RATE_LIMITED" ? "429" :
      input.errorCode === "AUTH_FAILED" || input.errorCode === "DISCONNECTED" ? "401" :
      "5xx";
    recordCoinbaseMetric({
      endpoint: input.endpoint,
      latencyMs: input.latencyMs,
      ok: input.ok,
      errorCode: input.errorCode,
      statusClass,
      category: input.category || "request",
    });
  }

  private writeSnapshot(input: {
    userContextId: string;
    snapshotType: "spot_price" | "portfolio" | "transactions";
    symbolPair?: string;
    payload: unknown;
    fetchedAtMs: number;
    freshnessMs: number;
  }): void {
    if (!this.dataStore) return;
    try {
      this.dataStore.appendSnapshot({
        userContextId: input.userContextId,
        snapshotType: input.snapshotType,
        symbolPair: input.symbolPair,
        payload: input.payload,
        fetchedAtMs: input.fetchedAtMs,
        freshnessMs: input.freshnessMs,
        source: "coinbase",
      });
    } catch {
      // Non-fatal persistence path.
    }
  }

  private writeAudit(input: {
    userContextId: string;
    eventType: string;
    status: "ok" | "error";
    conversationId?: string;
    missionRunId?: string;
    details?: Record<string, unknown>;
  }): void {
    if (!this.dataStore) return;
    try {
      this.dataStore.appendAuditLog({
        userContextId: input.userContextId,
        eventType: input.eventType,
        status: input.status,
        conversationId: input.conversationId,
        missionRunId: input.missionRunId,
        details: input.details,
      });
    } catch {
      // Non-fatal persistence path.
    }
  }
}

export function createStaticCredentialProvider(entries: Record<string, CoinbaseCredentials>): CoinbaseCredentialProvider {
  const map = new Map<string, CoinbaseCredentials>(
    Object.entries(entries).map(([key, value]) => [normalizeUserContextId(key), value]),
  );
  return {
    async resolve(userContextId: string): Promise<CoinbaseCredentials | null> {
      const key = normalizeUserContextId(userContextId);
      if (!key) return null;
      return map.get(key) || null;
    },
  };
}

function requireUserContextId(value: string): string {
  const normalized = normalizeUserContextId(value);
  if (!normalized) {
    throw new CoinbaseError({
      code: "BAD_INPUT",
      message: "Missing userContextId for Coinbase operation.",
    });
  }
  return normalized;
}

function normalizeUserContextId(value: string): string {
  return String(value || "").trim();
}

function normalizeSymbolPair(value: string): string {
  const raw = String(value || "").trim().toUpperCase();
  const normalized = raw.replace("/", "-");
  if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(normalized)) {
    throw new CoinbaseError({
      code: "BAD_INPUT",
      message: `Invalid symbol pair "${value}". Expected format like BTC-USD.`,
    });
  }
  return normalized;
}

function clampInt(value: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value) : min;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableFiniteNumber(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateMs(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function createKeyFingerprint(apiKey: string): string {
  const raw = String(apiKey || "").trim();
  if (!raw) return "";
  return raw.length <= 12 ? raw : `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}
