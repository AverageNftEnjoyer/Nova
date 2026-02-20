export type {
  CoinbaseAuthBuildInput,
  CoinbaseAuthStrategy,
  CoinbaseBalance,
  CoinbaseCapabilityLevel,
  CoinbaseCapabilityStatus,
  CoinbaseConnectionStatus,
  CoinbaseCredentialProvider,
  CoinbaseCredentials,
  CoinbaseHealthProbeResult,
  CoinbaseMarketPrice,
  CoinbasePortfolioSnapshot,
  CoinbaseProvider,
  CoinbaseRequestContext,
  CoinbaseSpotPriceParams,
  CoinbaseTransactionEvent,
  CoinbaseTransactionsParams,
} from "./types.js";

export {
  CoinbaseError,
  asCoinbaseError,
  isCoinbaseError,
  isRateLimitedCoinbaseError,
} from "./errors.js";

export { MemoryTtlCache } from "./cache.js";
export { CoinbaseRateLimitAdapter } from "./rate-limit.js";
export { CoinbaseHttpClient } from "./client.js";
export { CoinbaseService, createStaticCredentialProvider } from "./service.js";
export { FileBackedCoinbaseCredentialProvider } from "./credentials.js";
export {
  CoinbaseDataStore,
  type CoinbaseSnapshotType,
  type CoinbaseAuditStatus,
  type CoinbaseIdempotencyStatus,
  type CoinbaseSnapshotRecordInput,
  type CoinbaseReportHistoryInput,
  type CoinbaseAuditLogInput,
  type CoinbaseConnectionMetadataInput,
  type CoinbaseIdempotencyClaimInput,
  type CoinbaseIdempotencyClaimResult,
  type CoinbaseOAuthTokenInput,
  type CoinbaseOAuthTokenRecord,
} from "./store.js";
export { encryptTokenForStorage, decryptTokenFromStorage, type EncryptedTokenEnvelope } from "./crypto.js";
