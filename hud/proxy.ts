import { NextRequest, NextResponse } from "next/server"

type IpWindowEntry = {
  count: number
  resetAt: number
}

type GlobalMiddlewareState = typeof globalThis & {
  __novaIpRateLimitStore?: Map<string, IpWindowEntry>
  __novaIpRateLimitLastGcAt?: number
}

const globalState = globalThis as GlobalMiddlewareState
const ipStore = globalState.__novaIpRateLimitStore ?? new Map<string, IpWindowEntry>()
globalState.__novaIpRateLimitStore = ipStore

function readIntEnv(name: string, fallback: number, minValue: number, maxValue: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minValue, Math.min(maxValue, parsed))
}

const IP_WINDOW_MS = readIntEnv("NOVA_HTTP_IP_RATE_LIMIT_WINDOW_MS", 60_000, 5_000, 600_000)
const IP_MAX = readIntEnv("NOVA_HTTP_IP_RATE_LIMIT_MAX", 240, 10, 10_000)
const GC_INTERVAL_MS = readIntEnv("NOVA_HTTP_IP_RATE_LIMIT_GC_INTERVAL_MS", 60_000, 5_000, 600_000)
const MAX_IP_STORE_ENTRIES = readIntEnv("NOVA_HTTP_IP_RATE_LIMIT_MAX_KEYS", 50_000, 1_000, 500_000)
const MAX_IP_KEY_LEN = 96

function normalizeClientIp(rawValue: string): string {
  const raw = String(rawValue || "").trim().toLowerCase()
  if (!raw) return "unknown"
  const noPort = raw.includes(".") && raw.includes(":") ? raw.split(":")[0] : raw
  const noMappedPrefix = noPort.startsWith("::ffff:") ? noPort.slice("::ffff:".length) : noPort
  const safe = noMappedPrefix.replace(/[^a-f0-9:.]/g, "")
  if (!safe) return "unknown"
  return safe.slice(0, MAX_IP_KEY_LEN)
}

function enforceStoreSizeLimit(nowMs: number): void {
  if (ipStore.size <= MAX_IP_STORE_ENTRIES) return

  // Remove already-expired entries first.
  for (const [key, entry] of ipStore.entries()) {
    if (!entry || entry.resetAt <= nowMs) ipStore.delete(key)
  }
  if (ipStore.size <= MAX_IP_STORE_ENTRIES) return

  // If still oversized, drop oldest windows first.
  const overflow = ipStore.size - MAX_IP_STORE_ENTRIES
  if (overflow <= 0) return
  const sortedByResetAt = [...ipStore.entries()].sort(
    (a, b) => Number(a[1]?.resetAt || 0) - Number(b[1]?.resetAt || 0),
  )
  for (let i = 0; i < overflow && i < sortedByResetAt.length; i += 1) {
    ipStore.delete(sortedByResetAt[i][0])
  }
}

function maybeCollectGarbage(nowMs: number): void {
  const lastGc = Number(globalState.__novaIpRateLimitLastGcAt || 0)
  const shouldRunGc = nowMs - lastGc >= GC_INTERVAL_MS
  if (shouldRunGc) {
    globalState.__novaIpRateLimitLastGcAt = nowMs
    for (const [key, entry] of ipStore.entries()) {
      if (!entry || entry.resetAt <= nowMs) ipStore.delete(key)
    }
  }
  enforceStoreSizeLimit(nowMs)
}

function getClientIp(req: NextRequest): string {
  const realIp = String(req.headers.get("x-real-ip") || "").trim()
  const cfIp = String(req.headers.get("cf-connecting-ip") || "").trim()
  const forwarded = String(req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean)
  return normalizeClientIp(String(realIp || cfIp || forwarded || "unknown"))
}

function checkIpLimit(key: string): { allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number } {
  const nowMs = Date.now()
  maybeCollectGarbage(nowMs)
  const existing = ipStore.get(key)
  const active = !existing || existing.resetAt <= nowMs
    ? { count: 0, resetAt: nowMs + IP_WINDOW_MS }
    : { ...existing }

  const next = active.count + 1
  const allowed = next <= IP_MAX
  if (allowed) {
    active.count = next
  } else {
    active.count = Math.max(active.count, IP_MAX)
  }
  ipStore.set(key, active)

  const remaining = Math.max(0, IP_MAX - active.count)
  return {
    allowed,
    remaining,
    resetAt: active.resetAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((active.resetAt - nowMs) / 1000)),
  }
}

function createHeaders(details: { remaining: number; resetAt: number; retryAfterSeconds: number; allowed: boolean }): Headers {
  const headers = new Headers()
  headers.set("X-RateLimit-Limit", String(IP_MAX))
  headers.set("X-RateLimit-Remaining", String(details.remaining))
  headers.set("X-RateLimit-Reset", String(Math.ceil(details.resetAt / 1000)))
  if (!details.allowed) {
    headers.set("Retry-After", String(details.retryAfterSeconds))
  }
  return headers
}

function shouldBypassIpRateLimit(req: NextRequest): boolean {
  const pathname = String(req.nextUrl.pathname || "").trim()
  const method = String(req.method || "").trim().toUpperCase()
  // Skip preflight requests to reduce unnecessary limiter churn and latency.
  if (method === "OPTIONS") return true
  // Pending queue has its own authenticated per-user limiter and client backoff.
  // Bypass global IP limiter so unrelated API traffic doesn't starve pending delivery.
  if (pathname === "/api/novachat/pending" || pathname.startsWith("/api/novachat/pending/")) return true
  return false
}

export function proxy(req: NextRequest): NextResponse {
  if (shouldBypassIpRateLimit(req)) {
    return NextResponse.next()
  }
  const ip = getClientIp(req)
  const key = `ip:${ip}`
  const details = checkIpLimit(key)
  if (details.allowed) {
    const response = NextResponse.next()
    const headers = createHeaders(details)
    headers.forEach((value, name) => response.headers.set(name, value))
    return response
  }

  return NextResponse.json(
    { ok: false, error: "Too many requests." },
    {
      status: 429,
      headers: createHeaders(details),
    },
  )
}

export const config = {
  matcher: ["/api/:path*"],
}
