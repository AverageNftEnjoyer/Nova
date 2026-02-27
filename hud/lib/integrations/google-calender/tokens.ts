/**
 * GmailCalendar token management.
 *
 * Stores the calendar-scoped token in the `gcalendar` key of IntegrationsConfig.
 * Reuses Gmail's token endpoint, encryption, and client fetch utilities.
 */
import { decryptSecret, encryptSecret } from "../../security/encryption.ts"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "../server-store.ts"
import { assertGmailOk, gmailFetchWithRetry } from "../gmail/client.ts"
import { gmailError } from "../gmail/errors.ts"
import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  type GmailClientConfig,
  type GmailScope,
} from "../gmail/types.ts"
import type { GmailCalendarScope } from "./types.ts"

// GmailCalendar scopes use GmailScope (same IntegrationsStoreScope union)
export type GmailCalTokenScope = GmailCalendarScope

export async function getGmailCalendarClientConfig(scope?: GmailCalTokenScope): Promise<GmailClientConfig> {
  const integrations = await loadIntegrationsConfig(scope)
  return {
    clientId: String(
      integrations.gmail.oauthClientId || process.env.NOVA_GMAIL_CLIENT_ID || "",
    ).trim(),
    clientSecret: String(
      integrations.gmail.oauthClientSecret || process.env.NOVA_GMAIL_CLIENT_SECRET || "",
    ).trim(),
    redirectUri: String(
      process.env.NOVA_GMAIL_CALENDAR_REDIRECT_URI ||
        process.env.NOVA_GMAIL_REDIRECT_URI ||
        integrations.gmail.redirectUri ||
        integrations.gcalendar.redirectUri ||
        "http://localhost:3000/api/integrations/gmail/callback",
    ).trim(),
    appUrl: String(process.env.NOVA_APP_URL || "http://localhost:3000")
      .trim()
      .replace(/\/+$/, ""),
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
  const account = enabled.find((a) => a.id === preferredId) || enabled[0]
  if (!account) throw gmailError("gmail.account_not_found", "No GmailCalendar account linked.", { status: 404 })

  const now = Date.now()
  const cached = decryptSecret(account.accessTokenEnc)
  if (!forceRefresh && cached && account.tokenExpiry > now + 30_000) return cached

  const refreshToken = decryptSecret(account.refreshTokenEnc)
  if (!refreshToken) throw gmailError("gmail.token_missing", "No calendar refresh token. Reconnect.", { status: 400 })

  const refreshed = await refreshCalendarAccessToken(refreshToken, scope)
  const nextAccounts = config.gcalendar.accounts.map((a) =>
    a.id === account.id
      ? { ...a, accessTokenEnc: encryptSecret(refreshed.accessToken), tokenExpiry: now + Math.max(refreshed.expiresIn - 60, 60) * 1000 }
      : a,
  )
  const selected = nextAccounts.find((a) => a.id === account.id)!
  await updateIntegrationsConfig({
    gcalendar: {
      ...config.gcalendar,
      accounts: nextAccounts,
      accessTokenEnc: selected.accessTokenEnc,
      tokenExpiry: selected.tokenExpiry,
    },
  }, scope)
  return refreshed.accessToken
}

export async function disconnectGmailCalendar(accountId?: string, scope?: GmailCalTokenScope): Promise<void> {
  const current = await loadIntegrationsConfig(scope)
  const targetId = String(accountId || "").trim().toLowerCase()
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

