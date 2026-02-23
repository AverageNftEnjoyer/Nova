import { NextResponse } from "next/server"
import { createHmac, createPrivateKey, createSign, randomUUID } from "node:crypto"

import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/agent-runtime-sync"
import { loadIntegrationsConfig, updateIntegrationsConfig, type CoinbaseIntegrationConfig, type CoinbaseSyncErrorCode } from "@/lib/integrations/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ProbeFailure = {
  code: CoinbaseSyncErrorCode
  message: string
  status: number
}

function maskSecret(value: string): string {
  const trimmed = String(value || "").trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`
}

function toClientCoinbaseConfig(config: CoinbaseIntegrationConfig): CoinbaseIntegrationConfig & {
  apiKeyConfigured: boolean
  apiSecretConfigured: boolean
  apiKeyMasked: string
  apiSecretMasked: string
} {
  return {
    ...config,
    apiKey: "",
    apiSecret: "",
    apiKeyConfigured: String(config.apiKey || "").trim().length > 0,
    apiSecretConfigured: String(config.apiSecret || "").trim().length > 0,
    apiKeyMasked: maskSecret(config.apiKey),
    apiSecretMasked: maskSecret(config.apiSecret),
  }
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

function extractCoinbaseDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const asRecord = payload as Record<string, unknown>
  if (Array.isArray(asRecord.errors) && asRecord.errors.length > 0) {
    const first = asRecord.errors[0] as { message?: unknown }
    const message = String(first?.message || "").trim()
    if (message) return message
  }
  if (typeof asRecord.error === "string" && asRecord.error.trim().length > 0) return asRecord.error.trim()
  if (typeof asRecord.message === "string" && asRecord.message.trim().length > 0) return asRecord.message.trim()
  return ""
}

function toBase64Url(input: Buffer | string): string {
  const encoded = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input, "utf8").toString("base64")
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function normalizePrivateKeyPem(raw: string): string {
  const key = String(raw || "").trim().replace(/\\n/g, "\n").trim()
  if (!key) return ""
  if (key.includes("BEGIN EC PRIVATE KEY") || key.includes("BEGIN PRIVATE KEY")) return key
  return ""
}

function tryConvertSecretStringToPrivateKeyPem(raw: string): string {
  const compact = String(raw || "").trim().replace(/\s+/g, "")
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return ""
  let decoded: Buffer
  try {
    decoded = Buffer.from(compact, "base64")
  } catch {
    return ""
  }
  if (!decoded || decoded.length < 16) return ""
  const attempts: Array<() => ReturnType<typeof createPrivateKey>> = [
    () => createPrivateKey({ key: decoded, format: "der", type: "pkcs8" }),
    () => createPrivateKey({ key: decoded, format: "der", type: "sec1" }),
  ]
  for (const build of attempts) {
    try {
      const keyObj = build()
      return keyObj.export({ format: "pem", type: "pkcs8" }).toString()
    } catch {
      // keep trying
    }
  }
  return ""
}

function decodeHmacSecret(raw: string): Buffer {
  const compact = String(raw || "").trim().replace(/\s+/g, "")
  if (!compact) return Buffer.alloc(0)
  if (/^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      const decoded = Buffer.from(compact, "base64")
      if (decoded.length > 0) return decoded
    } catch {
      // fallback below
    }
  }
  return Buffer.from(compact, "utf8")
}

function buildCoinbaseJwt(params: {
  apiKey: string
  privateKeyPem: string
  method: string
  pathWithQuery: string
  host: string
}): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const header = {
    alg: "ES256",
    kid: params.apiKey,
    typ: "JWT",
    nonce: randomUUID().replace(/-/g, ""),
  }
  const payload = {
    iss: "cdp",
    sub: params.apiKey,
    nbf: nowSec,
    exp: nowSec + 120,
    uri: `${params.method.toUpperCase()} ${params.host}${params.pathWithQuery}`,
  }
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`
  const signature = createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({ key: params.privateKeyPem, dsaEncoding: "ieee-p1363" })
  return `${signingInput}.${toBase64Url(signature)}`
}

function buildCoinbasePrivateAuthHeaders(params: {
  apiKey: string
  apiSecret: string
  method: string
  pathWithQuery: string
  host: string
}): { headers: Record<string, string>; mode: "jwt_bearer" | "hmac_secret" } {
  const normalizedPem = normalizePrivateKeyPem(params.apiSecret)
  const derivedPem = normalizedPem || tryConvertSecretStringToPrivateKeyPem(params.apiSecret)
  if (derivedPem) {
    const token = buildCoinbaseJwt({
      apiKey: params.apiKey,
      privateKeyPem: derivedPem,
      method: params.method,
      pathWithQuery: params.pathWithQuery,
      host: params.host,
    })
    return {
      headers: { Authorization: `Bearer ${token}` },
      mode: "jwt_bearer",
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const prehash = `${timestamp}${params.method.toUpperCase()}${params.pathWithQuery}`
  const signature = createHmac("sha256", decodeHmacSecret(params.apiSecret)).update(prehash).digest("base64")
  return {
    headers: {
      "CB-ACCESS-KEY": params.apiKey,
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestamp,
    },
    mode: "hmac_secret",
  }
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
          coinbase: toClientCoinbaseConfig(next.coinbase),
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
      const detail = extractCoinbaseDetail(payload)
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
            coinbase: toClientCoinbaseConfig(next.coinbase),
          },
        },
        { status: failure.status },
      )
    }

    const host = "api.coinbase.com"
    const privatePath = "/api/v3/brokerage/accounts"
    const privateAuth = buildCoinbasePrivateAuthHeaders({
      apiKey: config.coinbase.apiKey,
      apiSecret: config.coinbase.apiSecret,
      method: "GET",
      pathWithQuery: privatePath,
      host,
    })
    const privateRes = await fetch(`https://${host}${privatePath}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...privateAuth.headers,
      },
    })
    const privatePayload = await privateRes.json().catch(() => ({}))
    if (!privateRes.ok) {
      const detail = extractCoinbaseDetail(privatePayload)
      const failure = classifyHttpFailure(privateRes.status, detail || "Coinbase private account probe failed.")
      const next = await updateIntegrationsConfig(
        {
          coinbase: {
            ...config.coinbase,
            connected: true,
            lastSyncAt: new Date().toISOString(),
            lastSyncStatus: "error",
            lastSyncErrorCode: failure.code,
            lastSyncErrorMessage: `${failure.message} [auth=${privateAuth.mode}]`,
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
          authMode: privateAuth.mode,
          privateEndpoint: privatePath,
          guidance:
            "Use Coinbase Secret API key + matching private key, enable View scope, and ensure your current outbound public IP/IPv6 is allowlisted.",
          config: {
            coinbase: toClientCoinbaseConfig(next.coinbase),
          },
        },
        { status: failure.status },
      )
    }

    probeTimestamp = parseIsoTimestamp((payload as { data?: { iso?: string } }).data?.iso)
    const now = Date.now()
    const freshnessMs = probeTimestamp > 0 ? Math.max(0, now - probeTimestamp) : now - startedAt
    const privateAccountsCount = Array.isArray((privatePayload as { accounts?: unknown[] })?.accounts)
      ? (privatePayload as { accounts?: unknown[] }).accounts?.length || 0
      : 0
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
      await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), verified.user.id, next)
    } catch (error) {
      console.warn("[integrations/test-coinbase] Failed to sync agent runtime snapshot:", error)
    }
    return NextResponse.json({
      ok: true,
      latencyMs: Math.max(0, Date.now() - startedAt),
      freshnessMs,
      checkedAt: new Date().toISOString(),
      sourceTime: probeTimestamp > 0 ? new Date(probeTimestamp).toISOString() : "",
      authMode: privateAuth.mode,
      privateEndpoint: privatePath,
      privateAccountsCount,
      config: {
        coinbase: toClientCoinbaseConfig(next.coinbase),
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
          coinbase: toClientCoinbaseConfig(next.coinbase),
        },
      },
      { status: 502 },
    )
  }
}
