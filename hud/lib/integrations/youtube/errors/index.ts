import type { YouTubeErrorCode } from "../types/index"

interface YouTubeErrorOptions {
  status?: number
  retryable?: boolean
  cause?: unknown
}

export class YouTubeServiceError extends Error {
  code: YouTubeErrorCode
  status: number
  retryable: boolean
  cause?: unknown

  constructor(code: YouTubeErrorCode, message: string, options?: YouTubeErrorOptions) {
    super(message)
    this.name = "YouTubeServiceError"
    this.code = code
    this.status = options?.status ?? 500
    this.retryable = Boolean(options?.retryable)
    this.cause = options?.cause
  }
}

export function youtubeError(code: YouTubeErrorCode, message: string, options?: YouTubeErrorOptions): YouTubeServiceError {
  return new YouTubeServiceError(code, message, options)
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

export function fromYouTubeHttpStatus(status: number, fallbackMessage: string): YouTubeServiceError {
  if (status === 400) return youtubeError("youtube.invalid_request", fallbackMessage, { status })
  if (status === 401) return youtubeError("youtube.unauthorized", fallbackMessage, { status })
  if (status === 403) return youtubeError("youtube.forbidden", fallbackMessage, { status })
  if (status === 404) return youtubeError("youtube.not_found", fallbackMessage, { status })
  if (status === 429) return youtubeError("youtube.rate_limited", fallbackMessage, { status, retryable: true })
  if (status >= 500) return youtubeError("youtube.transient", fallbackMessage, { status, retryable: true })
  return youtubeError("youtube.internal", fallbackMessage, { status, retryable: isTransientHttpStatus(status) })
}

export function toYouTubeServiceError(error: unknown, fallback = "YouTube operation failed."): YouTubeServiceError {
  if (error instanceof YouTubeServiceError) return error
  if (error instanceof Error) return youtubeError("youtube.internal", error.message || fallback, { cause: error })
  return youtubeError("youtube.internal", fallback, { cause: error })
}

export function toApiErrorBody(error: unknown, fallback = "YouTube operation failed."): {
  ok: false
  error: string
  code: YouTubeErrorCode
} {
  const normalized = toYouTubeServiceError(error, fallback)
  return {
    ok: false,
    error: normalized.message,
    code: normalized.code,
  }
}