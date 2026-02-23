export function createToolLoopBudget({
  maxDurationMs,
  minTimeoutMs = 1000,
  now = () => Date.now(),
} = {}) {
  const safeMaxDurationMs = Math.max(1, Number.parseInt(String(maxDurationMs || 0), 10) || 1);
  const safeMinTimeoutMs = Math.max(1, Number.parseInt(String(minTimeoutMs || 0), 10) || 1);
  const startedAtMs = Number(now());
  const deadlineMs = startedAtMs + safeMaxDurationMs;

  const remainingMs = () => Math.max(0, deadlineMs - Number(now()));
  const isExhausted = () => remainingMs() <= 0;
  const resolveTimeoutMs = (requestedMs, fallbackMs = safeMinTimeoutMs) => {
    const requested = Math.max(1, Number.parseInt(String(requestedMs || 0), 10) || fallbackMs);
    const remaining = remainingMs();
    if (remaining <= 0) return 0;
    return Math.max(safeMinTimeoutMs, Math.min(requested, remaining));
  };

  return {
    startedAtMs,
    deadlineMs,
    remainingMs,
    isExhausted,
    resolveTimeoutMs,
  };
}

export function capToolCallsPerStep(toolCalls, maxPerStep) {
  const cap = Math.max(1, Number.parseInt(String(maxPerStep || 0), 10) || 1);
  const source = Array.isArray(toolCalls) ? toolCalls : [];
  const capped = source.slice(0, cap);
  return {
    capped,
    wasCapped: source.length > capped.length,
    requestedCount: source.length,
    cappedCount: capped.length,
    cap,
  };
}

export function isLikelyTimeoutError(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  return /\btimed out\b|\btimeout\b|\babort\b|\baborted\b/i.test(text);
}
