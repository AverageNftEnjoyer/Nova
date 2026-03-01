/**
 * GmailCalendar OAuth helpers.
 *
 * Reuses Gmail's OAuth app credentials and HMAC state signing.
 * Requests calendar event management scope in addition to base Gmail scopes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { gmailError } from "../gmail/errors.ts"
import type { GmailClientConfig, GmailOAuthStatePayload } from "../gmail/types.ts"

export const GMAIL_CALENDAR_EXTRA_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
]

const DEV_FALLBACK_STATE_SECRET = createHash("sha256")
  .update(`nova-dev-gmail-calendar-oauth:${process.cwd()}`)
  .digest("hex")

function getOAuthSecret(): string {
  const configured = String(
    process.env.NOVA_GMAIL_OAUTH_STATE_SECRET || process.env.NOVA_ENCRYPTION_KEY || "",
  ).trim()
  if (configured) return configured
  if (process.env.NODE_ENV !== "development") {
    throw gmailError(
      "gmail.internal",
      "NOVA_GMAIL_OAUTH_STATE_SECRET (or NOVA_ENCRYPTION_KEY) is required in production.",
    )
  }
  return DEV_FALLBACK_STATE_SECRET
}

function signState(payload: GmailOAuthStatePayload & { flow: "gmail-calendar" }): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function verifyState(raw: string): (GmailOAuthStatePayload & { flow: "gmail-calendar" }) | null {
  const [body, signature] = String(raw || "").split(".")
  if (!body || !signature) return null
  const expected = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  const expectedBuf = Buffer.from(expected, "utf8")
  const signatureBuf = Buffer.from(signature, "utf8")
  if (expectedBuf.length !== signatureBuf.length) return null
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as (GmailOAuthStatePayload & { flow?: string }) | null
    if (!parsed || typeof parsed !== "object") return null
    if (parsed.flow !== "gmail-calendar") return null
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null
    if (typeof parsed.returnTo !== "string") return null
    return parsed as GmailOAuthStatePayload & { flow: "gmail-calendar" }
  } catch {
    return null
  }
}

export function parseGmailCalendarOAuthState(state: string): { userId: string; returnTo: string } | null {
  const parsed = verifyState(state)
  if (!parsed) return null
  const userId = String(parsed.userId || "").trim()
  if (!userId) return null
  return { userId, returnTo: parsed.returnTo || "/integrations" }
}

export function buildGmailCalendarOAuthUrl(params: {
  returnTo: string
  userId: string
  config: GmailClientConfig
  currentGmailScopes: string[]
}): string {
  const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"

  const userId = String(params.userId || "").trim()
  if (!userId) throw gmailError("gmail.invalid_request", "Missing user scope for GmailCalendar OAuth.", { status: 400 })
  const clientId = String(params.config.clientId || "").trim()
  if (!clientId) throw gmailError("gmail.invalid_request", "Gmail OAuth client id is missing (NOVA_GMAIL_CLIENT_ID).", { status: 400 })

  const safeReturnTo = params.returnTo.startsWith("/") ? params.returnTo : "/integrations"
  const state = signState({
    ts: Date.now(),
    nonce: randomBytes(8).toString("hex"),
    userId,
    returnTo: safeReturnTo,
    flow: "gmail-calendar",
  })

  // Combine existing Gmail scopes with calendar scope, deduplicating
  const scopeSet = new Set([
    "openid",
    "email",
    "profile",
    ...params.currentGmailScopes,
    ...GMAIL_CALENDAR_EXTRA_SCOPES,
  ])
  // Must match the redirect URI used in token exchange exactly.
  const redirectTarget = params.config.redirectUri || `${params.config.appUrl}/api/integrations/gmail-calendar/callback`

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectTarget,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [...scopeSet].join(" "),
    state,
  })
  return `${GOOGLE_OAUTH_BASE}?${query.toString()}`
}
