import { NextResponse } from "next/server"
import path from "node:path"

import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/agent-runtime-sync"
import { loadIntegrationsConfig, updateIntegrationsConfig, type CoinbaseSyncErrorCode } from "@/lib/integrations/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ProbeFailure = {
  code: CoinbaseSyncErrorCode
  message: string
  status: number
}

function classifyHttpFailure(status: number, detail: string): ProbeFailure {
  if (status === 401 || status === 403) {
    return {
      code: "permission_denied",
      message: detail || "Coinbase rejected the request with permission/auth error.",
      status: 400,
    }
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      message: detail || "Coinbase rate limited this probe.",
      status: 429,
    }
  }
  if (status >= 500) {
    return {
      code: "coinbase_outage",
      message: detail || `Coinbase upstream returned ${status}.`,
      status: 502,
    }
  }
  return {
    code: "unknown",
    message: detail || `Coinbase probe failed with status ${status}.`,
    status: 400,
  }
}

function parseIsoTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.trim().length === 0) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const config = await loadIntegrationsConfig(verified)
  const hasCreds = config.coinbase.apiKey.trim().length > 0 && config.coinbase.apiSecret.trim().length > 0

  if (!hasCreds) {
    const next = await updateIntegrationsConfig(
      {
        coinbase: {
          ...config.coinbase,
          connected: false,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: "error",
          lastSyncErrorCode: "permission_denied",
          lastSyncErrorMessage: "Coinbase key pair is missing. Save API key + private key before testing.",
          lastFreshnessMs: 0,
        },
      },
      verified,
    )
    return NextResponse.json(
      {
        ok: false,
        error: "Coinbase API key + private key are required before running a probe.",
        code: "permission_denied",
        config: {
          coinbase: next.coinbase,
        },
      },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  let probeTimestamp = 0
  try {
    const res = await fetch("https://api.coinbase.com/v2/time", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = (() => {
        if (payload && typeof payload === "object" && "errors" in payload && Array.isArray((payload as { errors?: unknown[] }).errors)) {
          const first = (payload as { errors?: Array<{ message?: string }> }).errors?.[0]
          return String(first?.message || "").trim()
        }
        if (payload && typeof payload === "object" && "error" in payload) {
          return String((payload as { error?: string }).error || "").trim()
        }
        return ""
      })()
      const failure = classifyHttpFailure(res.status, detail)
      const next = await updateIntegrationsConfig(
        {
          coinbase: {
            ...config.coinbase,
            lastSyncAt: new Date().toISOString(),
            lastSyncStatus: "error",
            lastSyncErrorCode: failure.code,
            lastSyncErrorMessage: failure.message,
            lastFreshnessMs: 0,
          },
        },
        verified,
      )
      return NextResponse.json(
        {
          ok: false,
          error: failure.message,
          code: failure.code,
          config: {
            coinbase: next.coinbase,
          },
        },
        { status: failure.status },
      )
    }

    probeTimestamp = parseIsoTimestamp((payload as { data?: { iso?: string } }).data?.iso)
    const now = Date.now()
    const freshnessMs = probeTimestamp > 0 ? Math.max(0, now - probeTimestamp) : now - startedAt
    const next = await updateIntegrationsConfig(
      {
        coinbase: {
          ...config.coinbase,
          connected: true,
          lastSyncAt: new Date(now).toISOString(),
          lastSyncStatus: "success",
          lastSyncErrorCode: "none",
          lastSyncErrorMessage: "",
          lastFreshnessMs: freshnessMs,
        },
      },
      verified,
    )
    try {
      await syncAgentRuntimeIntegrationsSnapshot(path.resolve(process.cwd(), ".."), verified.user.id, next)
    } catch (error) {
      console.warn("[integrations/test-coinbase] Failed to sync agent runtime snapshot:", error)
    }
    return NextResponse.json({
      ok: true,
      latencyMs: Math.max(0, Date.now() - startedAt),
      freshnessMs,
      checkedAt: new Date().toISOString(),
      sourceTime: probeTimestamp > 0 ? new Date(probeTimestamp).toISOString() : "",
      config: {
        coinbase: next.coinbase,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Coinbase probe failed due to network error."
    const next = await updateIntegrationsConfig(
      {
        coinbase: {
          ...config.coinbase,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: "error",
          lastSyncErrorCode: "network",
          lastSyncErrorMessage: message,
          lastFreshnessMs: 0,
        },
      },
      verified,
    )
    return NextResponse.json(
      {
        ok: false,
        error: message,
        code: "network",
        config: {
          coinbase: next.coinbase,
        },
      },
      { status: 502 },
    )
  }
}
