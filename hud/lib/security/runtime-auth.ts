import "server-only"

import { NextResponse } from "next/server"

import { timingSafeStringEqual } from "./timing-safe"

function readBooleanEnv(name: string, fallback = false): boolean {
  const normalized = String(process.env[name] || "").trim().toLowerCase()
  if (!normalized) return fallback
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
  code?: "RUNTIME_TOKEN_REQUIRED" | "RUNTIME_TOKEN_INVALID"
}

export function resolveRuntimeSharedTokenConfig(): RuntimeSharedTokenConfig {
  const token = String(process.env.NOVA_RUNTIME_SHARED_TOKEN || "").trim()
  const headerName = normalizeHeaderName(
    String(process.env.NOVA_RUNTIME_SHARED_TOKEN_HEADER || "x-nova-runtime-token"),
  )
  return {
    headerName,
    token,
    requireToken: readBooleanEnv("NOVA_RUNTIME_REQUIRE_SHARED_TOKEN", false),
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
  if (!expectedToken) return { ok: true }

  const providedToken = String(req.headers.get(config.headerName) || "").trim() || readBearerToken(req)
  if (!providedToken) {
    if (config.requireToken) {
      return { ok: false, code: "RUNTIME_TOKEN_REQUIRED" }
    }
    return { ok: true }
  }

  if (!timingSafeStringEqual(providedToken, expectedToken)) {
    return { ok: false, code: "RUNTIME_TOKEN_INVALID" }
  }

  return { ok: true }
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
