import "server-only"

import { NextResponse } from "next/server"

type FixedWindowEntry = {
  count: number
  resetAt: number
}

export type RateLimitPolicy = {
  bucket: string
  limit: number
  windowMs: number
}

export type RateLimitDecision = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

type GlobalRateLimitState = typeof globalThis & {
  __novaRateLimitStore?: Map<string, FixedWindowEntry>
  __novaRateLimitLastGcAt?: number
}

const globalState = globalThis as GlobalRateLimitState
const rateLimitStore = globalState.__novaRateLimitStore ?? new Map<string, FixedWindowEntry>()
globalState.__novaRateLimitStore = rateLimitStore

function readIntEnv(name: string, fallback: number, minValue: number, maxValue: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minValue, Math.min(maxValue, parsed))
}

const GC_INTERVAL_MS = readIntEnv("NOVA_RATE_LIMIT_GC_INTERVAL_MS", 60_000, 5_000, 600_000)

export const RATE_LIMIT_POLICIES = {
  chat: {
    bucket: "chat",
    limit: readIntEnv("NOVA_RATE_LIMIT_CHAT_PER_MIN", 20, 1, 500),
    windowMs: 60_000,
  },
  missionBuild: {
    bucket: "mission-build",
    limit: readIntEnv("NOVA_RATE_LIMIT_MISSION_BUILD_PER_MIN", 8, 1, 200),
    windowMs: 60_000,
  },
  missionSuggest: {
    bucket: "mission-suggest",
    limit: readIntEnv("NOVA_RATE_LIMIT_MISSION_SUGGEST_PER_MIN", 10, 1, 300),
    windowMs: 60_000,
  },
  missionTrigger: {
    bucket: "mission-trigger",
    limit: readIntEnv("NOVA_RATE_LIMIT_MISSION_TRIGGER_PER_MIN", 5, 1, 120),
    windowMs: 60_000,
  },
  missionTriggerStream: {
    bucket: "mission-trigger-stream",
    limit: readIntEnv("NOVA_RATE_LIMIT_MISSION_TRIGGER_STREAM_PER_MIN", 4, 1, 120),
    windowMs: 60_000,
  },
  integrationModelProbe: {
    bucket: "integration-model-probe",
    limit: readIntEnv("NOVA_RATE_LIMIT_INTEGRATION_PROBE_PER_MIN", 18, 1, 500),
    windowMs: 60_000,
  },
  accountDelete: {
    bucket: "account-delete",
    limit: readIntEnv("NOVA_RATE_LIMIT_ACCOUNT_DELETE_PER_10M", 3, 1, 60),
    windowMs: 10 * 60_000,
  },
  threadMessagesWrite: {
    bucket: "thread-messages-write",
    limit: readIntEnv("NOVA_RATE_LIMIT_THREAD_MESSAGES_WRITE_PER_MIN", 24, 1, 500),
    windowMs: 60_000,
  },
  novachatPendingPoll: {
    bucket: "novachat-pending-poll",
    limit: readIntEnv("NOVA_RATE_LIMIT_NOVACHAT_POLL_PER_MIN", 90, 1, 1000),
    windowMs: 60_000,
  },
} as const satisfies Record<string, RateLimitPolicy>

function maybeCollectGarbage(nowMs: number): void {
  const lastGc = Number(globalState.__novaRateLimitLastGcAt || 0)
  if (nowMs - lastGc < GC_INTERVAL_MS) return
  globalState.__novaRateLimitLastGcAt = nowMs
  for (const [key, entry] of rateLimitStore.entries()) {
    if (!entry || entry.resetAt <= nowMs) {
      rateLimitStore.delete(key)
    }
  }
}

function sanitizeScope(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export function checkRateLimit(key: string, policy: RateLimitPolicy, cost = 1): RateLimitDecision {
  const nowMs = Date.now()
  maybeCollectGarbage(nowMs)

  const scopedKey = String(key || "").trim()
  if (!scopedKey) {
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: nowMs + policy.windowMs,
      retryAfterSeconds: 0,
    }
  }

  const normalizedCost = Number.isFinite(cost) ? Math.max(1, Math.floor(cost)) : 1
  const existing = rateLimitStore.get(scopedKey)
  const active = !existing || existing.resetAt <= nowMs
    ? { count: 0, resetAt: nowMs + policy.windowMs }
    : { ...existing }

  const nextCount = active.count + normalizedCost
  const allowed = nextCount <= policy.limit
  if (allowed) {
    active.count = nextCount
  } else {
    active.count = Math.max(active.count, policy.limit)
  }
  rateLimitStore.set(scopedKey, active)

  const remaining = Math.max(0, policy.limit - active.count)
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((active.resetAt - nowMs) / 1000))
  return {
    allowed,
    limit: policy.limit,
    remaining,
    resetAt: active.resetAt,
    retryAfterSeconds,
  }
}

export function checkUserRateLimit(userId: string, policy: RateLimitPolicy, cost = 1): RateLimitDecision {
  const scope = sanitizeScope(userId)
  const bucket = sanitizeScope(policy.bucket)
  if (!scope || !bucket) {
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit,
      resetAt: Date.now() + policy.windowMs,
      retryAfterSeconds: 0,
    }
  }
  return checkRateLimit(`user:${scope}:bucket:${bucket}`, policy, cost)
}

export function createRateLimitHeaders(decision: RateLimitDecision, base?: HeadersInit): Headers {
  const headers = new Headers(base)
  headers.set("X-RateLimit-Limit", String(decision.limit))
  headers.set("X-RateLimit-Remaining", String(decision.remaining))
  headers.set("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)))
  if (!decision.allowed && decision.retryAfterSeconds > 0) {
    headers.set("Retry-After", String(decision.retryAfterSeconds))
  }
  return headers
}

export function rateLimitExceededResponse(decision: RateLimitDecision, error = "Rate limit exceeded."): NextResponse {
  const retryAfterMs = Math.max(0, Math.round(Number(decision.retryAfterSeconds || 0) * 1000))
  return NextResponse.json(
    {
      ok: false,
      code: "RATE_LIMITED",
      error,
      message: error,
      retryAfterMs,
    },
    {
      status: 429,
      headers: createRateLimitHeaders(decision),
    },
  )
}
