// ===== Voice loop failure backoff =====
// Pure helper (no timers, no I/O) so the voice loop's retry policy can be unit tested.
// Consecutive failures back off exponentially; after `maxFailures` the loop is paused
// so a dead microphone / broken STT can never spin the CPU or spam the console.

export const VOICE_FAILURE_BASE_DELAY_MS = 1_000;
export const VOICE_FAILURE_MAX_DELAY_MS = 30_000;
export const VOICE_FAILURE_MAX_CONSECUTIVE = 5;
export const VOICE_FAILURE_PAUSE_MS = 5 * 60_000;

export function createFailureBackoff(options = {}) {
  const baseDelayMs = Math.max(1, Number(options.baseDelayMs) || VOICE_FAILURE_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs) || VOICE_FAILURE_MAX_DELAY_MS);
  const maxFailures = Math.max(1, Math.floor(Number(options.maxFailures) || VOICE_FAILURE_MAX_CONSECUTIVE));
  let failures = 0;

  return {
    /**
     * Register a failure. `delayMs` is how long to wait before the next attempt.
     * `paused` is true exactly on the failure that reaches the limit (log once, then pause).
     */
    recordFailure() {
      failures += 1;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - 1));
      return { failures, delayMs, paused: failures >= maxFailures, first: failures === 1 };
    },
    recordSuccess() {
      failures = 0;
    },
    reset() {
      failures = 0;
    },
    get failures() {
      return failures;
    },
  };
}
