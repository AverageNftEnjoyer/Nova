const POLL_BASE_MS = 1500
const POLL_MAX_MS = 30000

function sanitizeScopePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export function buildPendingPollScopeKey(userContextId, conversationId) {
  const user = sanitizeScopePart(userContextId) || "anonymous"
  const convo = sanitizeScopePart(conversationId) || "none"
  return `poll:${user}:${convo}`
}

export function parseRetryAfterMs(retryAfterHeader, fallbackMs = 0) {
  const raw = String(retryAfterHeader || "").trim()
  if (!raw) return Math.max(0, Number(fallbackMs || 0))
  const seconds = Number.parseFloat(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.round(seconds * 1000))
  }
  const dateMs = Date.parse(raw)
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }
  return Math.max(0, Number(fallbackMs || 0))
}

export function computeBackoffDelayMs({
  attempt = 0,
  retryAfterMs = 0,
  baseMs = POLL_BASE_MS,
  maxMs = POLL_MAX_MS,
}) {
  const safeBase = Math.max(250, Number(baseMs || POLL_BASE_MS))
  const safeMax = Math.max(safeBase, Number(maxMs || POLL_MAX_MS))
  const exponential = Math.min(safeMax, safeBase * (2 ** Math.max(0, Number(attempt || 0))))
  const required = Math.max(exponential, Math.max(0, Number(retryAfterMs || 0)))
  const jitter = Math.floor(Math.random() * Math.max(80, Math.round(required * 0.2)))
  return Math.min(safeMax, required + jitter)
}

export function defaultPollIntervalMs() {
  return POLL_BASE_MS
}
