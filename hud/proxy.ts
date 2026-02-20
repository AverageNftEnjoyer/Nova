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

function maybeCollectGarbage(nowMs: number): void {
  const lastGc = Number(globalState.__novaIpRateLimitLastGcAt || 0)
  if (nowMs - lastGc < GC_INTERVAL_MS) return
  globalState.__novaIpRateLimitLastGcAt = nowMs
  for (const [key, entry] of ipStore.entries()) {
    if (!entry || entry.resetAt <= nowMs) ipStore.delete(key)
  }
}

function getClientIp(req: NextRequest): string {
  const forwarded = String(req.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim()
  const realIp = String(req.headers.get("x-real-ip") || "").trim()
  return String(forwarded || realIp || "unknown").trim().toLowerCase()
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

export function proxy(req: NextRequest): NextResponse {
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
