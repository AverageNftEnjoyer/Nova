import { setTimeout as delay } from "node:timers/promises"

import { fromSpotifyHttpStatus, isTransientHttpStatus, spotifyError } from "./errors"

interface SpotifyRequestOptions {
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

export async function spotifyFetchWithRetry(
  input: string,
  init: RequestInit,
  options: SpotifyRequestOptions,
): Promise<Response> {
  const operation = String(options.operation || "spotify_request")
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
        throw spotifyError("spotify.cancelled", `${operation} cancelled.`, { status: 499, cause: error })
      }
      const timeoutLike = aborted || (error instanceof Error && /timeout|aborted/i.test(error.message))
      if (timeoutLike) {
        if (attempt < maxAttempts) {
          await delay(120 * attempt)
          continue
        }
        throw spotifyError("spotify.timeout", `${operation} timed out.`, {
          status: 504,
          retryable: true,
          cause: error,
        })
      }
      if (attempt < maxAttempts) {
        await delay(120 * attempt)
        continue
      }
      throw spotifyError("spotify.network", `${operation} network failure.`, {
        status: 503,
        retryable: true,
        cause: error,
      })
    } finally {
      scoped.cleanup()
    }
  }
  throw spotifyError("spotify.transient", `${operation} exhausted retries.`, { status: 503, retryable: true })
}

export async function readSpotifyErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null)
  if (payload && typeof payload === "object") {
    const record = payload as {
      error?: { message?: string; status?: number } | string
      error_description?: string
      message?: string
    }
    const nestedError = record.error && typeof record.error === "object"
      ? String(record.error.message || "").trim()
      : ""
    const simpleError = typeof record.error === "string" ? record.error.trim() : ""
    const description = String(record.error_description || "").trim()
    const message = String(record.message || "").trim()
    const normalized = nestedError || message || simpleError || description
    if (normalized) return normalized
  }
  return fallback
}

export async function assertSpotifyOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return
  const message = await readSpotifyErrorMessage(response, fallback)
  throw fromSpotifyHttpStatus(response.status, message)
}
