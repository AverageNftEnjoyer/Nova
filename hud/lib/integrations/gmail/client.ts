import { setTimeout as delay } from "node:timers/promises"

import { fromGmailHttpStatus, gmailError, isTransientHttpStatus } from "./errors"

interface GmailRequestOptions {
  operation: string
  timeoutMs?: number
  signal?: AbortSignal
  maxAttempts?: number
}

function withAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs)
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener("abort", onAbort, { once: true })
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener("abort", onAbort)
    },
  }
}

export async function gmailFetchWithRetry(
  input: string,
  init: RequestInit,
  options: GmailRequestOptions,
): Promise<Response> {
  const operation = String(options.operation || "gmail_request")
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(1_000, Number(options.timeoutMs)) : 12_000
  const maxAttempts = Number.isFinite(Number(options.maxAttempts)) ? Math.max(1, Math.min(4, Number(options.maxAttempts))) : 3

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const scoped = withAbortSignal(options.signal, timeoutMs)
    try {
      const response = await fetch(input, { ...init, signal: scoped.signal, cache: "no-store" })
      if (!response.ok && isTransientHttpStatus(response.status) && attempt < maxAttempts) {
        await delay(120 * attempt)
        continue
      }
      return response
    } catch (error) {
      const aborted = scoped.signal.aborted
      if (aborted && options.signal?.aborted) {
        throw gmailError("gmail.cancelled", `${operation} cancelled.`, { status: 499, cause: error })
      }
      const timeoutLike = aborted || (error instanceof Error && /timeout|aborted/i.test(error.message))
      if (timeoutLike) {
        if (attempt < maxAttempts) {
          await delay(120 * attempt)
          continue
        }
        throw gmailError("gmail.timeout", `${operation} timed out.`, {
          status: 504,
          retryable: true,
          cause: error,
        })
      }
      if (attempt < maxAttempts) {
        await delay(120 * attempt)
        continue
      }
      throw gmailError("gmail.network", `${operation} network failure.`, {
        status: 503,
        retryable: true,
        cause: error,
      })
    } finally {
      scoped.cleanup()
    }
  }
  throw gmailError("gmail.transient", `${operation} exhausted retries.`, { status: 503, retryable: true })
}

export async function readGmailErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null)
  if (payload && typeof payload === "object") {
    const errorBlock = (payload as { error?: { message?: string } | string; error_description?: string })
    const nestedMessage = typeof errorBlock.error === "object" && errorBlock.error
      ? String(errorBlock.error.message || "").trim()
      : ""
    const errorCode = typeof errorBlock.error === "string" ? errorBlock.error.trim() : ""
    const errorDescription = String(errorBlock.error_description || "").trim()
    const message = nestedMessage || (errorCode && errorDescription ? `${errorCode}: ${errorDescription}` : (errorDescription || errorCode))
    if (message) return message
  }
  return fallback
}

export async function assertGmailOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return
  const message = await readGmailErrorMessage(response, fallback)
  throw fromGmailHttpStatus(response.status, message)
}
