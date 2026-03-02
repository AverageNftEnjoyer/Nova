import type { SpotifyErrorCode } from "../types/index"

interface SpotifyErrorOptions {
  status?: number
  retryable?: boolean
  cause?: unknown
}

export class SpotifyServiceError extends Error {
  code: SpotifyErrorCode
  status: number
  retryable: boolean
  cause?: unknown

  constructor(code: SpotifyErrorCode, message: string, options?: SpotifyErrorOptions) {
    super(message)
    this.name = "SpotifyServiceError"
    this.code = code
    this.status = options?.status ?? 500
    this.retryable = Boolean(options?.retryable)
    this.cause = options?.cause
  }
}

export function spotifyError(code: SpotifyErrorCode, message: string, options?: SpotifyErrorOptions): SpotifyServiceError {
  return new SpotifyServiceError(code, message, options)
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

export function fromSpotifyHttpStatus(status: number, fallbackMessage: string): SpotifyServiceError {
  if (status === 400) return spotifyError("spotify.invalid_request", fallbackMessage, { status })
  if (status === 401) return spotifyError("spotify.unauthorized", fallbackMessage, { status })
  if (status === 403) return spotifyError("spotify.forbidden", fallbackMessage, { status })
  if (status === 404) return spotifyError("spotify.not_found", fallbackMessage, { status })
  if (status === 429) return spotifyError("spotify.rate_limited", fallbackMessage, { status, retryable: true })
  if (status >= 500) return spotifyError("spotify.transient", fallbackMessage, { status, retryable: true })
  return spotifyError("spotify.internal", fallbackMessage, { status, retryable: isTransientHttpStatus(status) })
}

export function toSpotifyServiceError(error: unknown, fallback = "Spotify operation failed."): SpotifyServiceError {
  if (error instanceof SpotifyServiceError) return error
  if (error instanceof Error) return spotifyError("spotify.internal", error.message || fallback, { cause: error })
  return spotifyError("spotify.internal", fallback, { cause: error })
}

export function toApiErrorBody(error: unknown, fallback = "Spotify operation failed."): {
  ok: false
  error: string
  code: SpotifyErrorCode
} {
  const normalized = toSpotifyServiceError(error, fallback)
  return {
    ok: false,
    error: normalized.message,
    code: normalized.code,
  }
}
