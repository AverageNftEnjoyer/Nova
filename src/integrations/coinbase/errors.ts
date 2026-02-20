export type CoinbaseErrorCode =
  | "BAD_INPUT"
  | "DISCONNECTED"
  | "AUTH_UNSUPPORTED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "NOT_FOUND"
  | "UNKNOWN";

export interface CoinbaseErrorOptions {
  code: CoinbaseErrorCode;
  message: string;
  retryable?: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  endpoint?: string;
  userContextId?: string;
  cause?: unknown;
}

export class CoinbaseError extends Error {
  public readonly code: CoinbaseErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;
  public readonly endpoint?: string;
  public readonly userContextId?: string;

  constructor(options: CoinbaseErrorOptions) {
    super(options.message);
    this.name = "CoinbaseError";
    this.code = options.code;
    this.retryable = Boolean(options.retryable);
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.endpoint = options.endpoint;
    this.userContextId = options.userContextId;
    if (options.cause !== undefined) {
      // Node >=16 supports ErrorOptions.cause; assign manually to keep TS target simple.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isCoinbaseError(value: unknown): value is CoinbaseError {
  return value instanceof CoinbaseError;
}

export function isRateLimitedCoinbaseError(value: unknown): value is CoinbaseError {
  return value instanceof CoinbaseError && value.code === "RATE_LIMITED";
}

export function asCoinbaseError(
  value: unknown,
  fallback: Omit<CoinbaseErrorOptions, "message"> & { message?: string } = { code: "UNKNOWN" },
): CoinbaseError {
  if (value instanceof CoinbaseError) return value;
  const message = value instanceof Error ? value.message : String(value ?? fallback.message ?? "Unknown Coinbase error");
  return new CoinbaseError({
    code: fallback.code,
    message,
    retryable: fallback.retryable,
    statusCode: fallback.statusCode,
    retryAfterMs: fallback.retryAfterMs,
    endpoint: fallback.endpoint,
    userContextId: fallback.userContextId,
    cause: value,
  });
}

