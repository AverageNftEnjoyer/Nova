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
export { CoinbaseHttpClient, computeCoinbaseRetryDelayMs, mapCoinbaseHttpError } from "./client.js";
export { CoinbaseCircuitBreaker } from "./circuit-breaker.js";
export { CoinbaseService, createStaticCredentialProvider } from "./service.js";
export { FileBackedCoinbaseCredentialProvider } from "./credentials.js";
export { createCoinbaseAutoAuthStrategy } from "./auth-strategy.js";
export { renderCoinbasePortfolioReport, type CoinbaseRenderInput, type CoinbaseReportMode } from "./report-renderer.js";
export { buildCoinbasePnlPersonalityComment, type CoinbasePnlPersonalityCommentInput } from "./pnl-personality-comment.js";
export {
  recordCoinbaseMetric,
  recordCoinbaseStructuredLog,
  getCoinbaseMetricsSnapshot,
  resetCoinbaseObservabilityForTests,
} from "./observability.js";
export {
  resolveCoinbaseRolloutAccess,
  evaluateCoinbaseRolloutHealth,
  type CoinbaseRolloutStage,
  type CoinbaseRolloutAccess,
  type CoinbaseRolloutHealthSnapshot,
} from "./rollout.js";
export {
  CoinbaseDataStore,
  coinbaseDbPathForUserContext,
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
  type CoinbaseReportHistoryRow,
  type CoinbaseSnapshotRow,
  type CoinbaseRetentionSettings,
  type CoinbasePrivacySettings,
} from "./store.js";
export { encryptTokenForStorage, decryptTokenFromStorage, type EncryptedTokenEnvelope } from "./crypto.js";
