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
} from "./types/index.js";

export {
  CoinbaseError,
  asCoinbaseError,
  isCoinbaseError,
  isRateLimitedCoinbaseError,
} from "./errors/index.js";

export { MemoryTtlCache } from "./cache/index.js";
export { CoinbaseRateLimitAdapter } from "./rate-limit/index.js";
export { CoinbaseHttpClient, computeCoinbaseRetryDelayMs, mapCoinbaseHttpError } from "./client/index.js";
export { CoinbaseCircuitBreaker } from "./circuit-breaker/index.js";
export { CoinbaseService, createStaticCredentialProvider } from "./service/index.js";
export { FileBackedCoinbaseCredentialProvider } from "./credentials/index.js";
export { createCoinbaseAutoAuthStrategy } from "./auth-strategy/index.js";
export { renderCoinbasePortfolioReport, type CoinbaseRenderInput, type CoinbaseReportMode } from "./report-renderer/index.js";
export { buildCoinbasePnlPersonalityComment, type CoinbasePnlPersonalityCommentInput } from "./pnl-personality-comment/index.js";
export {
  recordCoinbaseMetric,
  recordCoinbaseStructuredLog,
  getCoinbaseMetricsSnapshot,
  resetCoinbaseObservabilityForTests,
} from "./observability/index.js";
export {
  resolveCoinbaseRolloutAccess,
  evaluateCoinbaseRolloutHealth,
  type CoinbaseRolloutStage,
  type CoinbaseRolloutAccess,
  type CoinbaseRolloutHealthSnapshot,
} from "./rollout/index.js";
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
} from "./store/index.js";
export { encryptTokenForStorage, decryptTokenFromStorage, type EncryptedTokenEnvelope } from "./crypto/index.js";
