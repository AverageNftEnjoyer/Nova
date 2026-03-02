export type CoinbaseCapabilityLevel = "available" | "degraded" | "unavailable";
export type CoinbaseConnectionStatus = "connected" | "degraded" | "disconnected";

export interface CoinbaseCredentials {
  connected: boolean;
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
}

export interface CoinbaseCredentialProvider {
  resolve(userContextId: string): Promise<CoinbaseCredentials | null>;
}

export interface CoinbaseRequestContext {
  userContextId: string;
  conversationId?: string;
  missionRunId?: string;
}

export interface CoinbaseAuthBuildInput {
  method: string;
  path: string;
  query?: URLSearchParams;
  bodyText?: string;
  timestampMs: number;
  credentials: CoinbaseCredentials;
  userContextId: string;
}

export interface CoinbaseAuthStrategy {
  name: string;
  buildHeaders(input: CoinbaseAuthBuildInput): Promise<Record<string, string>>;
}

export interface CoinbaseMarketPrice {
  symbolPair: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  priceText: string;
  fetchedAtMs: number;
  freshnessMs: number;
  source: "coinbase";
}

export interface CoinbaseBalance {
  accountId: string;
  accountName: string;
  accountType: string;
  assetSymbol: string;
  available: number;
  hold: number;
  total: number;
}

export interface CoinbasePortfolioSnapshot {
  balances: CoinbaseBalance[];
  fetchedAtMs: number;
  freshnessMs: number;
  source: "coinbase";
}

export interface CoinbaseTransactionEvent {
  id: string;
  side: "buy" | "sell" | "other";
  assetSymbol: string;
  quantity: number;
  price: number | null;
  fee: number | null;
  occurredAtMs: number;
  status: string;
}

export interface CoinbaseCapabilityStatus {
  status: CoinbaseConnectionStatus;
  marketData: CoinbaseCapabilityLevel;
  portfolio: CoinbaseCapabilityLevel;
  transactions: CoinbaseCapabilityLevel;
  reason?: string;
}

export interface CoinbaseHealthProbeResult {
  ok: boolean;
  status: CoinbaseConnectionStatus;
  checkedAtMs: number;
  latencyMs: number;
  capabilities: CoinbaseCapabilityStatus;
  errorCode?: string;
  message?: string;
}

export interface CoinbaseSpotPriceParams {
  symbolPair: string;
  bypassCache?: boolean;
}

export interface CoinbasePortfolioParams {
  bypassCache?: boolean;
}

export interface CoinbaseTransactionsParams {
  limit?: number;
  bypassCache?: boolean;
}

export interface CoinbaseProvider {
  getCapabilities(ctx: CoinbaseRequestContext): Promise<CoinbaseCapabilityStatus>;
  probeHealth(ctx: CoinbaseRequestContext): Promise<CoinbaseHealthProbeResult>;
  getSpotPrice(ctx: CoinbaseRequestContext, params: CoinbaseSpotPriceParams): Promise<CoinbaseMarketPrice>;
  getPortfolioSnapshot(ctx: CoinbaseRequestContext, params?: CoinbasePortfolioParams): Promise<CoinbasePortfolioSnapshot>;
  getRecentTransactions(
    ctx: CoinbaseRequestContext,
    params?: CoinbaseTransactionsParams,
  ): Promise<CoinbaseTransactionEvent[]>;
  invalidateUserCache(userContextId: string): void;
}
