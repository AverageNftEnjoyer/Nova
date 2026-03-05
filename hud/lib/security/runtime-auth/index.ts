import "server-only"

import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import { timingSafeStringEqual } from "../timing-safe"

function readOptionalBooleanEnv(name: string): boolean | null {
  const normalized = String(process.env[name] || "").trim().toLowerCase()
  if (!normalized) return null
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}

function normalizeHeaderName(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64) || "x-nova-runtime-token"
}

export type RuntimeSharedTokenConfig = {
  headerName: string
  token: string
  requireToken: boolean
}

export type RuntimeSharedTokenDecision = {
  ok: boolean
  authenticated?: boolean
  code?: "RUNTIME_TOKEN_REQUIRED" | "RUNTIME_TOKEN_INVALID"
}

function deriveRuntimeSharedTokenFallback(): string {
  const encryptionKey = String(process.env.NOVA_ENCRYPTION_KEY || "").trim()
  if (!encryptionKey) return ""
  return createHash("sha256")
    .update(`nova-runtime-shared-token:${encryptionKey}`)
    .digest("hex")
}

export function resolveRuntimeSharedTokenConfig(): RuntimeSharedTokenConfig {
  const token = String(process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim() || deriveRuntimeSharedTokenFallback()
  const headerName = normalizeHeaderName(
    String(process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token"),
  )
  const explicitRequireToken = readOptionalBooleanEnv("NOVA_RUNTIME_REQUIRE_SHARED_TOKEN")
  const requireTokenByDefault = token.length > 0 && process.env.NODE_ENV === "production"
  return {
    headerName,
    token,
    requireToken: explicitRequireToken ?? requireTokenByDefault,
  }
}

function readBearerToken(req: Request): string {
  const authHeader = String(req.headers.get("authorization") || "").trim()
  if (!authHeader) return ""
  const match = /^bearer\s+(.+)$/i.exec(authHeader)
  return match?.[1]?.trim() || ""
}

export function verifyRuntimeSharedToken(req: Request): RuntimeSharedTokenDecision {
  const config = resolveRuntimeSharedTokenConfig()
  const expectedToken = config.token
  if (!expectedToken) return { ok: true, authenticated: false }

  const providedToken = String(req.headers.get(config.headerName) || "").trim() || readBearerToken(req)
  if (!providedToken) {
    if (config.requireToken) {
      return { ok: false, code: "RUNTIME_TOKEN_REQUIRED" }
    }
    return { ok: true, authenticated: false }
  }

  if (!timingSafeStringEqual(providedToken, expectedToken)) {
    return { ok: false, code: "RUNTIME_TOKEN_INVALID" }
  }

  return { ok: true, authenticated: true }
}

export function runtimeSharedTokenErrorResponse(decision: RuntimeSharedTokenDecision): NextResponse {
  const message = decision.code === "RUNTIME_TOKEN_REQUIRED"
    ? "Runtime shared token required."
    : "Runtime shared token is invalid."
  return NextResponse.json(
    {
      ok: false,
      code: decision.code || "RUNTIME_TOKEN_INVALID",
      error: message,
      message,
    },
    { status: 401 },
  )
}
