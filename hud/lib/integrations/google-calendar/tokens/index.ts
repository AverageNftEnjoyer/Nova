/**
 * GmailCalendar token management.
 *
 * Stores the calendar-scoped token in the `gcalendar` key of IntegrationsConfig.
 * Reuses Gmail's token endpoint, encryption, and client fetch utilities.
 */
import { decryptSecret, encryptSecret } from "../../../security/encryption/index.ts"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "../../store/server-store.ts"
import { assertGmailOk, gmailFetchWithRetry } from "../../gmail/client.ts"
import { gmailError } from "../../gmail/errors.ts"
import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  type GmailClientConfig,
  type GmailScope,
} from "../../gmail/types.ts"
import type { GmailCalendarScope } from "../types/index.ts"

// GmailCalendar scopes use GmailScope (same IntegrationsStoreScope union)
export type GmailCalTokenScope = GmailCalendarScope

// ─── In-process token cache ────────────────────────────────────────────────
// Keyed by "<userId>:<accountId>". Avoids a DB read + AES decrypt on every
// Google Calendar API call when the access token is still valid.
interface GcalTokenCacheEntry {
  token: string
  expiry: number // ms epoch — matches account.tokenExpiry
}
const _gcalTokenCache = new Map<string, GcalTokenCacheEntry>()
const GCAL_TOKEN_CACHE_MAX = 200

// Dedup concurrent refresh calls — keyed by "<userId>:<accountId>".
const _gcalRefreshInFlight = new Map<string, Promise<string>>()

function gcalCacheKey(scope: GmailCalTokenScope | undefined, accountId: string): string {
  const userId = (scope as { userId?: string } | undefined)?.userId ?? "default"
  return `${userId}:${accountId}`
}

const GCALENDAR_CALLBACK_PATH = "/api/integrations/gmail-calendar/callback"
const DEFAULT_LOCAL_GCAL_CALLBACK_URL = "http://localhost:3000/api/integrations/gmail-calendar/callback"
const LEGACY_LOCAL_GCAL_CALLBACK_URL = "http://localhost:3000/api/integrations/gcalendar/callback"

function normalizeCalendarRedirectUri(rawValue: string, appUrl: string): string {
  const raw = String(rawValue || "").trim()
  if (!raw) return `${appUrl}${GCALENDAR_CALLBACK_PATH}`
  return raw
}

function isDefaultLocalCalendarRedirect(value: string): boolean {
  return value === DEFAULT_LOCAL_GCAL_CALLBACK_URL || value === LEGACY_LOCAL_GCAL_CALLBACK_URL
}

export async function getGmailCalendarClientConfig(scope?: GmailCalTokenScope): Promise<GmailClientConfig> {
  const integrations = await loadIntegrationsConfig(scope)
  const appUrl = String(process.env.NOVA_APP_URL || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "")
  const gmailRedirect = String(integrations.gmail.redirectUri || "").trim()
  const gcalendarRedirect = String(integrations.gcalendar.redirectUri || "").trim()
  const preferredGcalendarRedirect = !isDefaultLocalCalendarRedirect(gcalendarRedirect) ? gcalendarRedirect : ""
  const configuredRedirect = String(
    process.env.NOVA_GMAIL_CALENDAR_REDIRECT_URI ||
      process.env.NOVA_GMAIL_REDIRECT_URI ||
      preferredGcalendarRedirect ||
      gmailRedirect ||
      gcalendarRedirect ||
      "",
  ).trim()
  return {
    clientId: String(
      integrations.gmail.oauthClientId || process.env.NOVA_GMAIL_CLIENT_ID || "",
    ).trim(),
    clientSecret: String(
      integrations.gmail.oauthClientSecret || process.env.NOVA_GMAIL_CLIENT_SECRET || "",
    ).trim(),
    redirectUri: normalizeCalendarRedirectUri(configuredRedirect, appUrl),
    appUrl,
  }
}

async function refreshCalendarAccessToken(
  refreshToken: string,
  scope?: GmailCalTokenScope,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = await getGmailCalendarClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw gmailError("gmail.invalid_request", "Gmail OAuth credentials missing for calendar refresh.", { status: 400 })
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  })
  const res = await gmailFetchWithRetry(
    GOOGLE_TOKEN_ENDPOINT,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    { operation: "gmail_calendar_token_refresh", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertGmailOk(res, "Google calendar token refresh failed.")
  const data = await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  const accessToken = String(data?.access_token || "").trim()
  const expiresIn = Number(data?.expires_in || 0)
  if (!accessToken) throw gmailError("gmail.token_missing", "Calendar token refresh returned no access token.", { status: 502 })
  return { accessToken, expiresIn }
}

export async function exchangeCodeForGmailCalendarTokens(
  code: string,
  scope?: GmailCalTokenScope,
): Promise<void> {
  const { clientId, clientSecret, redirectUri } = await getGmailCalendarClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw gmailError("gmail.invalid_request", "Gmail OAuth credentials missing for calendar.", { status: 400 })
  }
  const normalizedCode = String(code || "").trim()
  if (!normalizedCode) throw gmailError("gmail.invalid_request", "Missing OAuth code.", { status: 400 })

  const body = new URLSearchParams({
    code: normalizedCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })
  const tokenRes = await gmailFetchWithRetry(
    GOOGLE_TOKEN_ENDPOINT,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    { operation: "gmail_calendar_token_exchange", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertGmailOk(tokenRes, "Google calendar token exchange failed.")
  const tokenData = await tokenRes.json().catch(() => null) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  } | null

  const accessToken = String(tokenData?.access_token || "").trim()
  const refreshToken = String(tokenData?.refresh_token || "").trim()
  const expiresIn = Number(tokenData?.expires_in || 0)
  const scopes = String(tokenData?.scope || "").split(/\s+/).map((s) => s.trim()).filter(Boolean)
  if (!accessToken) throw gmailError("gmail.token_missing", "Calendar token exchange returned no access token.", { status: 502 })

  const profileRes = await gmailFetchWithRetry(
    GOOGLE_USERINFO_ENDPOINT,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { operation: "gmail_calendar_userinfo", maxAttempts: 2, timeoutMs: 8_000 },
  )
  const profileData = await profileRes.json().catch(() => null) as { email?: string } | null
  const email = profileRes.ok ? String(profileData?.email || "").trim() : ""

  const current = await loadIntegrationsConfig(scope)
  const accountId = (email || "gmail-calendar-primary").toLowerCase()
  const existing = current.gcalendar.accounts.find((a) => a.id === accountId)
  const existingRefresh = existing
    ? decryptSecret(existing.refreshTokenEnc)
    : decryptSecret(current.gcalendar.refreshTokenEnc)
  const refreshToStore = refreshToken || existingRefresh
  if (!refreshToStore) throw gmailError("gmail.token_missing", "No refresh token for calendar. Reconnect.", { status: 400 })

  const expiry = Date.now() + Math.max(expiresIn - 60, 60) * 1000
  const nextAccount = {
    id: accountId,
    email: email || existing?.email || current.gcalendar.email || "unknown@gmail.local",
    scopes: scopes.length > 0 ? scopes : (existing?.scopes || current.gcalendar.scopes),
    enabled: existing?.enabled ?? true,
    accessTokenEnc: encryptSecret(accessToken),
    refreshTokenEnc: encryptSecret(refreshToStore),
    tokenExpiry: expiry,
    connectedAt: existing?.connectedAt || new Date().toISOString(),
  }
  const nextAccounts = [
    ...current.gcalendar.accounts.filter((a) => a.id !== accountId),
    nextAccount,
  ]
  await updateIntegrationsConfig({
    gcalendar: {
      ...current.gcalendar,
      connected: true,
      email: nextAccount.email,
      scopes: nextAccount.scopes,
      accounts: nextAccounts,
      activeAccountId: nextAccount.id,
      accessTokenEnc: nextAccount.accessTokenEnc,
      refreshTokenEnc: nextAccount.refreshTokenEnc,
      tokenExpiry: expiry,
    },
  }, scope)
}

export async function getValidGmailCalendarAccessToken(
  accountId?: string,
  forceRefresh = false,
  scope?: GmailCalTokenScope,
): Promise<string> {
  const config = await loadIntegrationsConfig(scope)
  if (!config.gcalendar.connected) {
    throw gmailError("gmail.not_connected", "Google Calendar is not connected.", { status: 409 })
  }

  const preferredId = String(accountId || config.gcalendar.activeAccountId || "").trim().toLowerCase()
  const enabled = config.gcalendar.accounts.filter((a) => a.enabled)
  const matched = enabled.find((a) => a.id === preferredId)
  if (!matched && preferredId && enabled.length > 0) {
    console.warn(
      `[gcal] Preferred account "${preferredId}" not found or disabled — falling back to "${enabled[0].id}".`,
    )
  }
  const account = matched ?? enabled[0]
  if (!account) throw gmailError("gmail.account_not_found", "No GmailCalendar account linked.", { status: 404 })

  const cacheKey = gcalCacheKey(scope, account.id)
  const now = Date.now()

  // Fast path: serve from in-process cache if still valid (30s headroom).
  if (!forceRefresh) {
    const cached = _gcalTokenCache.get(cacheKey)
    if (cached && cached.expiry > now + 30_000) return cached.token
  }

  // Dedup: if a refresh is already in-flight for this account, await it.
  const inflight = _gcalRefreshInFlight.get(cacheKey)
  if (inflight) return inflight

  const doRefresh = async (): Promise<string> => {
    // Re-read config inside the closure to get the latest refresh token.
    const freshConfig = await loadIntegrationsConfig(scope)
    const freshAccount = freshConfig.gcalendar.accounts.find((a) => a.id === account.id) ?? account

    const refreshToken = decryptSecret(freshAccount.refreshTokenEnc)
    if (!refreshToken) throw gmailError("gmail.token_missing", "No calendar refresh token. Reconnect.", { status: 400 })

    const refreshed = await refreshCalendarAccessToken(refreshToken, scope)
    const newExpiry = now + Math.max(refreshed.expiresIn - 60, 60) * 1000

    // Evict stale entries if cache is growing (unbounded user growth).
    if (_gcalTokenCache.size > GCAL_TOKEN_CACHE_MAX) {
      for (const [k, v] of _gcalTokenCache.entries()) {
        if (v.expiry < now) _gcalTokenCache.delete(k)
      }
    }
    _gcalTokenCache.set(cacheKey, { token: refreshed.accessToken, expiry: newExpiry })

    const nextAccounts = freshConfig.gcalendar.accounts.map((a) =>
      a.id === account.id
        ? { ...a, accessTokenEnc: encryptSecret(refreshed.accessToken), tokenExpiry: newExpiry }
        : a,
    )
    const selected = nextAccounts.find((a) => a.id === account.id)!
    await updateIntegrationsConfig({
      gcalendar: {
        ...freshConfig.gcalendar,
        accounts: nextAccounts,
        accessTokenEnc: selected.accessTokenEnc,
        tokenExpiry: selected.tokenExpiry,
      },
    }, scope)
    return refreshed.accessToken
  }

  const refreshPromise = doRefresh().finally(() => _gcalRefreshInFlight.delete(cacheKey))
  _gcalRefreshInFlight.set(cacheKey, refreshPromise)
  return refreshPromise
}

const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"

/** Best-effort token revocation at Google — never throws. */
async function revokeGoogleTokenSilently(token: string): Promise<void> {
  if (!token) return
  try {
    await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(6_000),
    })
  } catch {
    // Intentionally swallowed — revocation is best-effort.
    // Local tokens are cleared regardless of whether Google accepts the revocation.
  }
}

export async function disconnectGmailCalendar(accountId?: string, scope?: GmailCalTokenScope): Promise<void> {
  const current = await loadIntegrationsConfig(scope)
  const targetId = String(accountId || "").trim().toLowerCase()
  const accountsToRemove = targetId
    ? current.gcalendar.accounts.filter((a) => a.id === targetId)
    : current.gcalendar.accounts

  // Revoke tokens at Google before clearing local state (best-effort, 6s timeout).
  await Promise.allSettled(
    accountsToRemove.map((a) => {
      const token = decryptSecret(a.refreshTokenEnc) || decryptSecret(a.accessTokenEnc)
      return revokeGoogleTokenSilently(token)
    }),
  )

  // Evict removed accounts from the in-process token cache.
  for (const a of accountsToRemove) {
    const key = gcalCacheKey(scope, a.id)
    _gcalTokenCache.delete(key)
    _gcalRefreshInFlight.delete(key)
  }

  const nextAccounts = targetId
    ? current.gcalendar.accounts.filter((a) => a.id !== targetId)
    : []
  const enabled = nextAccounts.filter((a) => a.enabled)
  const selected = enabled[0] || nextAccounts[0] || null
  await updateIntegrationsConfig({
    gcalendar: {
      ...current.gcalendar,
      connected: enabled.length > 0,
      accounts: nextAccounts,
      activeAccountId: selected?.id || "",
      email: selected?.email || "",
      scopes: selected?.scopes || [],
      accessTokenEnc: selected?.accessTokenEnc || "",
      refreshTokenEnc: selected?.refreshTokenEnc || "",
      tokenExpiry: selected?.tokenExpiry || 0,
    },
  }, scope)
}

// Re-export the GmailClientConfig type for consumers
export type { GmailClientConfig }
// Re-export GmailScope alias
export type { GmailScope as GmailCalendarServiceScope }
