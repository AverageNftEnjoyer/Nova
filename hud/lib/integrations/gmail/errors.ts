import type { GmailErrorCode } from "./types"

interface GmailErrorOptions {
  status?: number
  retryable?: boolean
  cause?: unknown
}

export class GmailServiceError extends Error {
  code: GmailErrorCode
  status: number
  retryable: boolean
  cause?: unknown

  constructor(code: GmailErrorCode, message: string, options?: GmailErrorOptions) {
    super(message)
    this.name = "GmailServiceError"
    this.code = code
    this.status = options?.status ?? 500
    this.retryable = Boolean(options?.retryable)
    this.cause = options?.cause
  }
}

export function gmailError(
  code: GmailErrorCode,
  message: string,
  options?: GmailErrorOptions,
): GmailServiceError {
  return new GmailServiceError(code, message, options)
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

export function fromGmailHttpStatus(status: number, fallbackMessage: string): GmailServiceError {
  if (status === 400) return gmailError("gmail.invalid_request", fallbackMessage, { status })
  if (status === 401) return gmailError("gmail.unauthorized", fallbackMessage, { status })
  if (status === 403) return gmailError("gmail.forbidden", fallbackMessage, { status })
  if (status === 404) return gmailError("gmail.not_found", fallbackMessage, { status })
  if (status === 429) return gmailError("gmail.rate_limited", fallbackMessage, { status, retryable: true })
  if (status >= 500) return gmailError("gmail.transient", fallbackMessage, { status, retryable: true })
  return gmailError("gmail.internal", fallbackMessage, { status, retryable: isTransientHttpStatus(status) })
}

export function toGmailServiceError(error: unknown, fallback = "Gmail operation failed."): GmailServiceError {
  if (error instanceof GmailServiceError) return error
  if (error instanceof Error) return gmailError("gmail.internal", error.message || fallback, { cause: error })
  return gmailError("gmail.internal", fallback, { cause: error })
}

export function toApiErrorBody(error: unknown, fallback = "Gmail operation failed."): {
  ok: false
  error: string
  code: GmailErrorCode
} {
  const normalized = toGmailServiceError(error, fallback)
  return {
    ok: false,
    error: normalized.message,
    code: normalized.code,
  }
}
