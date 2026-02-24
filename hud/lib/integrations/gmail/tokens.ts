import { decryptSecret, encryptSecret } from "../../security/encryption"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "../server-store"
import { deriveGmailAfterDisconnect, deriveGmailAfterTokenRefresh } from "./accounts"
import { assertGmailOk, gmailFetchWithRetry } from "./client"
import { gmailError } from "./errors"
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT, type GmailAccountRecord, type GmailClientConfig, type GmailScope, type GmailTokenRefreshResult } from "./types"

export async function getGmailClientConfig(scope?: GmailScope): Promise<GmailClientConfig> {
  const integrations = await loadIntegrationsConfig(scope)
  return {
    clientId: String(integrations.gmail.oauthClientId || process.env.NOVA_GMAIL_CLIENT_ID || "").trim(),
    clientSecret: String(integrations.gmail.oauthClientSecret || process.env.NOVA_GMAIL_CLIENT_SECRET || "").trim(),
    redirectUri: String(integrations.gmail.redirectUri || process.env.NOVA_GMAIL_REDIRECT_URI || "http://localhost:3000/api/integrations/gmail/callback").trim(),
    appUrl: String(process.env.NOVA_APP_URL || "http://localhost:3000").trim().replace(/\/+$/, ""),
  }
}

async function refreshGmailAccessToken(refreshToken: string, scope?: GmailScope): Promise<GmailTokenRefreshResult> {
  const { clientId, clientSecret } = await getGmailClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw gmailError("gmail.invalid_request", "Gmail OAuth client credentials are missing.", { status: 400 })
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  })
  const tokenRes = await gmailFetchWithRetry(
    GOOGLE_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "gmail_token_refresh", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertGmailOk(tokenRes, "Google token refresh failed.")
  const tokenData = await tokenRes.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  const accessToken = String(tokenData?.access_token || "").trim()
  const expiresIn = Number(tokenData?.expires_in || 0)
  if (!accessToken) throw gmailError("gmail.token_missing", "Google token refresh returned no access token.", { status: 502 })
  return { accessToken, expiresIn }
}

export async function exchangeCodeForGmailTokens(code: string, scope?: GmailScope): Promise<void> {
  const { clientId, clientSecret, redirectUri } = await getGmailClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw gmailError("gmail.invalid_request", "Gmail OAuth client credentials are missing.", { status: 400 })
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
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "gmail_token_exchange", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertGmailOk(tokenRes, "Google token exchange failed.")
  const tokenData = await tokenRes.json().catch(() => null) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  } | null
  const accessToken = String(tokenData?.access_token || "").trim()
  const refreshToken = String(tokenData?.refresh_token || "").trim()
  const expiresIn = Number(tokenData?.expires_in || 0)
  const scopes = String(tokenData?.scope || "").split(/\s+/).map((scopeText) => scopeText.trim()).filter(Boolean)
  if (!accessToken) throw gmailError("gmail.token_missing", "Google token exchange returned no access token.", { status: 502 })

  const profileRes = await gmailFetchWithRetry(
    GOOGLE_USERINFO_ENDPOINT,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { operation: "gmail_userinfo", maxAttempts: 2, timeoutMs: 8_000 },
  )
  const profileData = await profileRes.json().catch(() => null) as { email?: string } | null
  const email = profileRes.ok ? String(profileData?.email || "").trim() : ""

  const current = await loadIntegrationsConfig(scope)
  const accountId = (email || "gmail-primary").toLowerCase()
  const existing = current.gmail.accounts.find((account) => account.id === accountId)
  const existingRefresh = existing ? decryptSecret(existing.refreshTokenEnc) : decryptSecret(current.gmail.refreshTokenEnc)
  const refreshToStore = refreshToken || existingRefresh
  if (!refreshToStore) throw gmailError("gmail.token_missing", "No Gmail refresh token available. Reconnect Gmail.", { status: 400 })

  const expiry = Date.now() + Math.max(expiresIn - 60, 60) * 1000
  const nextAccount: GmailAccountRecord = {
    id: accountId,
    email: email || existing?.email || current.gmail.email || "unknown@gmail.local",
    scopes: scopes.length > 0 ? scopes : (existing?.scopes || current.gmail.scopes),
    enabled: existing?.enabled ?? true,
    accessTokenEnc: encryptSecret(accessToken),
    refreshTokenEnc: encryptSecret(refreshToStore),
    tokenExpiry: expiry,
    connectedAt: existing?.connectedAt || new Date().toISOString(),
  }
  const nextAccounts = [
    ...current.gmail.accounts.filter((account) => account.id !== accountId),
    nextAccount,
  ]
  await updateIntegrationsConfig({
    gmail: {
      ...current.gmail,
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

export async function getValidGmailAccessToken(
  accountId?: string,
  forceRefresh = false,
  scope?: GmailScope,
): Promise<string> {
  const config = await loadIntegrationsConfig(scope)
  if (!config.gmail.connected) throw gmailError("gmail.not_connected", "Gmail is not connected.", { status: 409 })

  const preferredId = String(accountId || config.gmail.activeAccountId || "").trim().toLowerCase()
  const enabledAccounts = config.gmail.accounts.filter((item) => item.enabled)
  const account = enabledAccounts.find((item) => item.id === preferredId) || enabledAccounts[0]
  if (!account) throw gmailError("gmail.account_not_found", "No Gmail account linked. Connect Gmail first.", { status: 404 })

  const now = Date.now()
  const cachedAccess = decryptSecret(account.accessTokenEnc)
  if (!forceRefresh && cachedAccess && account.tokenExpiry > now + 30_000) return cachedAccess

  const refreshToken = decryptSecret(account.refreshTokenEnc)
  if (!refreshToken) throw gmailError("gmail.token_missing", "No Gmail refresh token available. Reconnect Gmail.", { status: 400 })

  const refreshed = await refreshGmailAccessToken(refreshToken, scope)
  const nextGmail = deriveGmailAfterTokenRefresh(
    config.gmail,
    account.id,
    encryptSecret(refreshed.accessToken),
    now + Math.max(refreshed.expiresIn - 60, 60) * 1000,
  )
  await updateIntegrationsConfig({
    gmail: nextGmail,
  }, scope)
  return refreshed.accessToken
}

export async function disconnectGmail(accountId?: string, scope?: GmailScope): Promise<void> {
  const current = await loadIntegrationsConfig(scope)
  await updateIntegrationsConfig({
    gmail: deriveGmailAfterDisconnect(current.gmail, accountId),
  }, scope)
}
