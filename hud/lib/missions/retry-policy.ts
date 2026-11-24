/**
 * Nova Mission Retry Policy
 *
 * Computes retry delay with exponential backoff and optional ±10% jitter.
 * Used by:
 *   - executeMission() wrapper for mission-level inline retries (retryOnFail)
 *   - Scheduler backoff guard (computeRetryDelayMs already in scheduler, will migrate here)
 *
 * Phase 1 gate: mission with retryCount=2 retries twice then marks status=dead.
 */

const DEFAULT_RETRY_BASE_MS = 5_000      // 5 seconds (matches MissionSettings.retryIntervalMs default)
const DEFAULT_RETRY_MAX_MS  = 5 * 60_000 // 5 minutes cap for mission-level retries

/**
 * Computes the delay before the next retry attempt using exponential backoff.
 *
 * @param attempt   The current attempt number (1 = first failure, 2 = second, …)
 * @param baseMs    Base delay in ms — first retry waits approximately this long
 * @param maxMs     Hard cap on the computed delay
 * @param jitter    If true, applies ±10% random jitter to avoid thundering herd
 * @returns         Delay in ms before retrying
 */
export function computeRetryDelayMs(
  attempt: number,
  baseMs: number = DEFAULT_RETRY_BASE_MS,
  maxMs: number = DEFAULT_RETRY_MAX_MS,
  jitter = true,
): number {
  const exp = Math.max(0, attempt - 1)
  const raw = baseMs * Math.pow(2, exp)
  const withJitter = jitter ? raw * (0.9 + Math.random() * 0.2) : raw
  return Math.min(Math.round(withJitter), maxMs)
}

/**
 * Returns true when a failed mission should be retried based on its settings.
 *
 * @param retryOnFail   MissionSettings.retryOnFail
 * @param retryCount    MissionSettings.retryCount (number of retries after initial failure)
 * @param attempt       Current attempt number (1 = initial run)
 */
export function shouldRetry(
  retryOnFail: boolean,
  retryCount: number,
  attempt: number,
): boolean {
  if (!retryOnFail) return false
  // attempt=1 is the first run; retries are attempts 2..retryCount+1
  return attempt <= retryCount
}
