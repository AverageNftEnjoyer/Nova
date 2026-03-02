import { fetchWithSsrfGuard, readResponseTextWithLimit } from "../../../tools/web/net-guard/index.js";
import { CoinbaseError } from "../errors/index.js";
import type { CoinbaseAuthStrategy, CoinbaseCredentials } from "../types/index.js";

export interface CoinbaseHttpClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  maxErrorBytes?: number;
  hostnameAllowlist?: string[];
  authStrategy?: CoinbaseAuthStrategy | null;
}

type InternalRequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  userContextId: string;
  credentials?: CoinbaseCredentials | null;
  authRequired: boolean;
};

const DEFAULT_BASE_URL = "https://api.coinbase.com";

export function computeCoinbaseRetryDelayMs(attempt: number, retryAfterMs?: number): number {
  const base = Math.min(5_000, 250 * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * 120);
  const candidate = base + jitter;
  if (Number.isFinite(retryAfterMs || NaN) && (retryAfterMs || 0) > 0) {
    return Math.max(candidate, Number(retryAfterMs));
  }
  return candidate;
}

export function mapCoinbaseHttpError(input: {
  status: number;
  endpoint: string;
  userContextId: string;
  detail: string;
  retryAfterHeader: string | null;
}): CoinbaseError {
  const trimmedDetail = String(input.detail || "").trim();
  const messageSuffix = trimmedDetail ? ` ${trimmedDetail.slice(0, 600)}` : "";
  const retryAfterMs = parseRetryAfterHeader(input.retryAfterHeader);

  if (input.status === 401 || input.status === 403) {
    return new CoinbaseError({
      code: "AUTH_FAILED",
      message: `Coinbase authentication failed (${input.status}).${messageSuffix}`,
      statusCode: input.status,
      retryable: false,
      endpoint: input.endpoint,
      userContextId: input.userContextId,
    });
  }
  if (input.status === 404) {
    return new CoinbaseError({
      code: "NOT_FOUND",
      message: `Coinbase endpoint not found (${input.status}).${messageSuffix}`,
      statusCode: input.status,
      retryable: false,
      endpoint: input.endpoint,
      userContextId: input.userContextId,
    });
  }
  if (input.status === 429) {
    return new CoinbaseError({
      code: "RATE_LIMITED",
      message: `Coinbase rate limit reached (${input.status}).${messageSuffix}`,
      statusCode: input.status,
      retryAfterMs: retryAfterMs || undefined,
      retryable: true,
      endpoint: input.endpoint,
      userContextId: input.userContextId,
    });
  }
  if (input.status >= 500) {
    return new CoinbaseError({
      code: "UPSTREAM_UNAVAILABLE",
      message: `Coinbase upstream error (${input.status}).${messageSuffix}`,
      statusCode: input.status,
      retryable: true,
      endpoint: input.endpoint,
      userContextId: input.userContextId,
    });
  }
  return new CoinbaseError({
    code: "BAD_INPUT",
    message: `Coinbase request failed (${input.status}).${messageSuffix}`,
    statusCode: input.status,
    retryable: false,
    endpoint: input.endpoint,
    userContextId: input.userContextId,
  });
}

export class CoinbaseHttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly maxErrorBytes: number;
  private readonly hostnameAllowlist: string[];
  private readonly authStrategy: CoinbaseAuthStrategy | null;

  constructor(options?: CoinbaseHttpClientOptions) {
    const normalizedBase = String(options?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    this.baseUrl = normalizedBase || DEFAULT_BASE_URL;
    this.timeoutMs = Math.max(500, Math.floor(Number(options?.timeoutMs || 10_000)));
    this.maxRetries = Math.max(0, Math.floor(Number(options?.maxRetries || 2)));
    this.maxResponseBytes = Math.max(10_000, Math.floor(Number(options?.maxResponseBytes || 1_500_000)));
    this.maxErrorBytes = Math.max(1_000, Math.floor(Number(options?.maxErrorBytes || 128_000)));
    this.authStrategy = options?.authStrategy || null;

    const fromBaseUrl = (() => {
      try {
        return new URL(this.baseUrl).hostname;
      } catch {
        return "api.coinbase.com";
      }
    })();
    this.hostnameAllowlist = Array.from(
      new Set((options?.hostnameAllowlist || [fromBaseUrl]).map((value) => String(value || "").trim()).filter(Boolean)),
    );
  }

  public async getPublicJson<T>(
    path: string,
    params: {
      query?: Record<string, string | number | boolean | undefined>;
      userContextId: string;
    },
  ): Promise<T> {
    return await this.requestJson<T>({
      method: "GET",
      path,
      query: params.query,
      userContextId: params.userContextId,
      authRequired: false,
    });
  }

  public async getPrivateJson<T>(
    path: string,
    params: {
      query?: Record<string, string | number | boolean | undefined>;
      userContextId: string;
      credentials: CoinbaseCredentials;
    },
  ): Promise<T> {
    return await this.requestJson<T>({
      method: "GET",
      path,
      query: params.query,
      userContextId: params.userContextId,
      credentials: params.credentials,
      authRequired: true,
    });
  }

  private async requestJson<T>(options: InternalRequestOptions): Promise<T> {
    const userContextId = String(options.userContextId || "").trim();
    if (!userContextId) {
      throw new CoinbaseError({
        code: "BAD_INPUT",
        message: "Missing userContextId for Coinbase request.",
      });
    }

    const url = new URL(options.path, this.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const bodyText = options.body ? JSON.stringify(options.body) : "";
    const requestPath = `${url.pathname}${url.search}`;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        if (bodyText) headers["content-type"] = "application/json";

        if (options.authRequired) {
          if (!options.credentials || !options.credentials.connected) {
            throw new CoinbaseError({
              code: "DISCONNECTED",
              message: "Coinbase credentials are not connected for this user.",
              userContextId,
              endpoint: requestPath,
            });
          }
          if (!this.authStrategy) {
            throw new CoinbaseError({
              code: "AUTH_UNSUPPORTED",
              message: "Coinbase private endpoint requested without an auth strategy.",
              userContextId,
              endpoint: requestPath,
            });
          }
          const authHeaders = await this.authStrategy.buildHeaders({
            method: options.method,
            path: url.pathname,
            query: url.searchParams,
            bodyText: bodyText || undefined,
            timestampMs: Date.now(),
            credentials: options.credentials,
            userContextId,
          });
          Object.assign(headers, authHeaders);
        }

        const { response } = await fetchWithSsrfGuard({
          url: url.toString(),
          timeoutMs: this.timeoutMs,
          maxRedirects: 1,
          policy: {
            hostnameAllowlist: this.hostnameAllowlist,
          },
          auditContext: `coinbase_http:${options.method.toLowerCase()}`,
          init: {
            method: options.method,
            headers,
            body: bodyText || undefined,
          },
        });

        if (response.ok) {
          const raw = await readResponseTextWithLimit(response, this.maxResponseBytes);
          if (!raw.trim()) return {} as T;
          try {
            return JSON.parse(raw) as T;
          } catch (error) {
            throw new CoinbaseError({
              code: "INVALID_RESPONSE",
              message: `Coinbase returned non-JSON payload for ${requestPath}.`,
              statusCode: response.status,
              retryable: false,
              endpoint: requestPath,
              userContextId,
              cause: error,
            });
          }
        }

        const detail = await readResponseTextWithLimit(response, this.maxErrorBytes).catch(() => "");
        const mapped = mapCoinbaseHttpError({
          status: response.status,
          endpoint: requestPath,
          userContextId,
          detail,
          retryAfterHeader: response.headers.get("retry-after"),
        });
        if (attempt < this.maxRetries && mapped.retryable) {
          await sleep(computeCoinbaseRetryDelayMs(attempt, mapped.retryAfterMs));
          attempt += 1;
          continue;
        }
        throw mapped;
      } catch (error) {
        if (error instanceof CoinbaseError) {
          if (attempt < this.maxRetries && error.retryable) {
            await sleep(computeCoinbaseRetryDelayMs(attempt, error.retryAfterMs));
            attempt += 1;
            continue;
          }
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error ?? "Unknown network error");
        const timeoutLike = /timed out|abort|aborted/i.test(message);
        const mapped = new CoinbaseError({
          code: timeoutLike ? "TIMEOUT" : "NETWORK",
          message: `Coinbase request failed for ${requestPath}: ${message}`,
          retryable: true,
          endpoint: requestPath,
          userContextId,
          cause: error,
        });
        if (attempt < this.maxRetries) {
          await sleep(computeCoinbaseRetryDelayMs(attempt, undefined));
          attempt += 1;
          continue;
        }
        throw mapped;
      }
    }

    throw new CoinbaseError({
      code: "UNKNOWN",
      message: `Coinbase request exhausted retries for ${requestPath}.`,
      endpoint: requestPath,
      userContextId,
      retryable: false,
    });
  }

}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000;
  const absolute = Date.parse(trimmed);
  if (!Number.isNaN(absolute)) {
    const delta = absolute - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))));
}
