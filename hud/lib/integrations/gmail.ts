import "server-only"

import { createHash, createHmac, randomBytes } from "node:crypto"

import { decryptSecret, encryptSecret } from "@/lib/security/encryption"
import { type IntegrationsStoreScope, loadIntegrationsConfig, updateIntegrationsConfig } from "@/lib/integrations/server-store"

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
const DEFAULT_GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
]
const DEV_FALLBACK_OAUTH_STATE_SECRET = createHash("sha256")
  .update(`nova-dev-gmail-oauth:${process.cwd()}`)
  .digest("hex")

interface GmailOAuthStatePayload {
  ts: number
  nonce: string
  userId: string
  returnTo: string
}

export interface GmailMessageSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

type GmailAccountRecord = {
  id: string
  email: string
  scopes: string[]
  enabled: boolean
  accessTokenEnc: string
  refreshTokenEnc: string
  tokenExpiry: number
  connectedAt: string
}

function getOAuthSecret(): string {
  const configured = String(process.env.NOVA_GMAIL_OAUTH_STATE_SECRET || process.env.NOVA_ENCRYPTION_KEY || "").trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw new Error("NOVA_GMAIL_OAUTH_STATE_SECRET (or NOVA_ENCRYPTION_KEY) is required in production.")
  }
  return DEV_FALLBACK_OAUTH_STATE_SECRET
}

async function getGmailClientConfig(scope?: IntegrationsStoreScope) {
  const integrations = await loadIntegrationsConfig(scope)
  const clientId = String(integrations.gmail.oauthClientId || process.env.NOVA_GMAIL_CLIENT_ID || "").trim()
  const clientSecret = String(integrations.gmail.oauthClientSecret || process.env.NOVA_GMAIL_CLIENT_SECRET || "").trim()
  const redirectUri = String(integrations.gmail.redirectUri || process.env.NOVA_GMAIL_REDIRECT_URI || "http://localhost:3000/api/integrations/gmail/callback").trim()
  const appUrl = String(process.env.NOVA_APP_URL || "http://localhost:3000").trim().replace(/\/+$/, "")
  return { clientId, clientSecret, redirectUri, appUrl }
}

function signState(payload: GmailOAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function verifyState(raw: string): GmailOAuthStatePayload | null {
  const [body, signature] = String(raw || "").split(".")
  if (!body || !signature) return null
  const expected = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  if (expected !== signature) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GmailOAuthStatePayload
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null
    if (typeof parsed.returnTo !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export async function buildGmailOAuthUrl(returnTo: string, scope?: IntegrationsStoreScope): Promise<string> {
  const { clientId, redirectUri, appUrl } = await getGmailClientConfig(scope)
  const userId = String(scope?.userId || scope?.user?.id || "").trim()
  if (!clientId) throw new Error("Gmail OAuth client id is missing (NOVA_GMAIL_CLIENT_ID).")
  if (!userId) throw new Error("Missing user scope for Gmail OAuth.")
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/integrations"
  const state = signState({ ts: Date.now(), nonce: randomBytes(8).toString("hex"), userId, returnTo: safeReturnTo })
  const redirectTarget = redirectUri || `${appUrl}/api/integrations/gmail/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectTarget,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: DEFAULT_GMAIL_SCOPES.join(" "),
    state,
  })
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`
}

export function parseGmailOAuthState(state: string): { userId: string; returnTo: string } | null {
  const parsed = verifyState(state)
  if (!parsed) return null
  const userId = String(parsed.userId || "").trim()
  if (!userId) return null
  return { userId, returnTo: parsed.returnTo || "/integrations" }
}

export async function exchangeCodeForGmailTokens(code: string, scope?: IntegrationsStoreScope): Promise<void> {
  const { clientId, clientSecret, redirectUri } = await getGmailClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth client credentials are missing.")
  }
  const payload = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })
  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
    cache: "no-store",
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok) {
    const msg = tokenData && typeof tokenData === "object" && "error_description" in tokenData
      ? String((tokenData as { error_description?: string }).error_description || "")
      : ""
    throw new Error(msg || `Google token exchange failed (${tokenRes.status}).`)
  }

  const accessToken = String((tokenData as { access_token?: string }).access_token || "").trim()
  const refreshToken = String((tokenData as { refresh_token?: string }).refresh_token || "").trim()
  const expiresIn = Number((tokenData as { expires_in?: number }).expires_in || 0)
  const scopeText = String((tokenData as { scope?: string }).scope || "")
  const scopes = scopeText.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
  if (!accessToken) throw new Error("Google token exchange returned no access token.")

  const profileRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  const profileData = await profileRes.json().catch(() => null)
  const email = profileRes.ok
    ? String((profileData as { email?: string })?.email || "").trim()
    : ""

  const current = await loadIntegrationsConfig(scope)
  const accountId = (email || "gmail-primary").toLowerCase()
  const existing = current.gmail.accounts.find((account) => account.id === accountId)
  const existingRefresh = existing ? decryptSecret(existing.refreshTokenEnc) : decryptSecret(current.gmail.refreshTokenEnc)
  const refreshToStore = refreshToken || existingRefresh
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

export async function disconnectGmail(accountId?: string, scope?: IntegrationsStoreScope): Promise<void> {
  const current = await loadIntegrationsConfig(scope)
  const targetId = String(accountId || "").trim().toLowerCase()
  const nextAccounts = targetId
    ? current.gmail.accounts.filter((account) => account.id !== targetId)
    : []
  const enabledAccounts = nextAccounts.filter((account) => account.enabled)
  const nextActiveId = enabledAccounts[0]?.id || nextAccounts[0]?.id || ""
  const nextActive = nextAccounts.find((account) => account.id === nextActiveId)
  await updateIntegrationsConfig({
    gmail: {
      ...current.gmail,
      connected: enabledAccounts.length > 0,
      email: nextActive?.email || "",
      scopes: nextActive?.scopes || [],
      accounts: nextAccounts,
      activeAccountId: nextActiveId,
      accessTokenEnc: nextActive?.accessTokenEnc || "",
      refreshTokenEnc: nextActive?.refreshTokenEnc || "",
      tokenExpiry: nextActive?.tokenExpiry || 0,
    },
  }, scope)
}

async function refreshGmailAccessToken(refreshToken: string, scope?: IntegrationsStoreScope): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = await getGmailClientConfig(scope)
  if (!clientId || !clientSecret) throw new Error("Gmail OAuth client credentials are missing.")
  const payload = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  })
  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
    cache: "no-store",
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok) {
    const msg = tokenData && typeof tokenData === "object" && "error_description" in tokenData
      ? String((tokenData as { error_description?: string }).error_description || "")
      : ""
    throw new Error(msg || `Google token refresh failed (${tokenRes.status}).`)
  }
  const accessToken = String((tokenData as { access_token?: string }).access_token || "").trim()
  const expiresIn = Number((tokenData as { expires_in?: number }).expires_in || 0)
  if (!accessToken) throw new Error("Google token refresh returned no access token.")
  return { accessToken, expiresIn }
}

export async function getValidGmailAccessToken(accountId?: string, forceRefresh = false, scope?: IntegrationsStoreScope): Promise<string> {
  const config = await loadIntegrationsConfig(scope)
  const gmail = config.gmail
  if (!gmail.connected) throw new Error("Gmail is not connected.")
  const preferredId = String(accountId || gmail.activeAccountId || "").trim().toLowerCase()
  const enabledAccounts = gmail.accounts.filter((item) => item.enabled)
  const account =
    enabledAccounts.find((item) => item.id === preferredId) ||
    enabledAccounts[0]
  if (!account) throw new Error("No Gmail account linked. Connect Gmail first.")

  const now = Date.now()
  const cachedAccess = decryptSecret(account.accessTokenEnc)
  if (!forceRefresh && cachedAccess && account.tokenExpiry > now + 30_000) return cachedAccess

  const refreshToken = decryptSecret(account.refreshTokenEnc)
  if (!refreshToken) throw new Error("No Gmail refresh token available. Reconnect Gmail.")

  const refreshed = await refreshGmailAccessToken(refreshToken, scope)
  const nextAccounts = gmail.accounts.map((item) =>
    item.id === account.id
      ? {
          ...item,
          accessTokenEnc: encryptSecret(refreshed.accessToken),
          tokenExpiry: now + Math.max(refreshed.expiresIn - 60, 60) * 1000,
        }
      : item,
  )
  const nextEnabled = nextAccounts.filter((item) => item.enabled)
  const nextActive = nextEnabled.find((item) => item.id === account.id) || nextEnabled[0] || nextAccounts[0]
  await updateIntegrationsConfig({
    gmail: {
      ...gmail,
      connected: nextEnabled.length > 0,
      accounts: nextAccounts,
      activeAccountId: nextActive?.id || "",
      email: nextActive?.email || gmail.email,
      scopes: nextActive?.scopes || gmail.scopes,
      accessTokenEnc: nextActive?.accessTokenEnc || "",
      refreshTokenEnc: nextActive?.refreshTokenEnc || "",
      tokenExpiry: nextActive?.tokenExpiry || 0,
    },
  }, scope)
  return refreshed.accessToken
}

function decodeBodyData(data: string | undefined): string {
  const raw = String(data || "")
  if (!raw) return ""
  try {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  } catch {
    return ""
  }
}

function pickHeader(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string {
  if (!Array.isArray(headers)) return ""
  const hit = headers.find((h) => String(h?.name || "").toLowerCase() === name.toLowerCase())
  return String(hit?.value || "").trim()
}

function extractPlainText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== "object") return ""
  const mimeType = String(payload.mimeType || "")
  const body = payload.body as { data?: string } | undefined
  if (mimeType === "text/plain") return decodeBodyData(body?.data)
  if (mimeType === "text/html") {
    const html = decodeBodyData(body?.data)
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  }
  const parts = Array.isArray(payload.parts) ? (payload.parts as Array<Record<string, unknown>>) : []
  for (const part of parts) {
    const text = extractPlainText(part)
    if (text) return text
  }
  return ""
}

export async function listRecentGmailMessages(maxResults = 10, accountId?: string, scope?: IntegrationsStoreScope): Promise<GmailMessageSummary[]> {
  let token = await getValidGmailAccessToken(accountId, false, scope)
  const listParams = new URLSearchParams({
    maxResults: String(Math.max(1, Math.min(25, maxResults))),
    q: "in:inbox -category:promotions",
  })
  let listRes = await fetch(`${GMAIL_API_BASE}/users/me/messages?${listParams.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (listRes.status === 401 || listRes.status === 403) {
    token = await getValidGmailAccessToken(accountId, true, scope)
    listRes = await fetch(`${GMAIL_API_BASE}/users/me/messages?${listParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
  }
  const listData = await listRes.json().catch(() => null)
  if (!listRes.ok) {
    const msg = listData && typeof listData === "object" && "error" in listData
      ? String((listData as { error?: { message?: string } }).error?.message || "")
      : ""
    throw new Error(msg || `Failed to list Gmail messages (${listRes.status}).`)
  }

  const rawMessages = Array.isArray((listData as { messages?: Array<{ id?: string; threadId?: string }> })?.messages)
    ? (listData as { messages: Array<{ id?: string; threadId?: string }> }).messages
    : []

  const details = await Promise.all(rawMessages.map(async (message) => {
    const id = String(message.id || "").trim()
    if (!id) return null
    const detailRes = await fetch(
      `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(id)}?format=full`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    )
    const detailData = await detailRes.json().catch(() => null)
    if (!detailRes.ok || !detailData || typeof detailData !== "object") return null

    const payload = (detailData as { payload?: Record<string, unknown> }).payload
    const headers = Array.isArray(payload?.headers)
      ? (payload!.headers as Array<{ name?: string; value?: string }>)
      : []
    const subject = pickHeader(headers, "subject")
    const from = pickHeader(headers, "from")
    const date = pickHeader(headers, "date")
    const snippet = String((detailData as { snippet?: string }).snippet || "").trim()
    const plain = extractPlainText(payload)

    return {
      id,
      threadId: String((detailData as { threadId?: string }).threadId || message.threadId || ""),
      from,
      subject,
      date,
      snippet: (snippet || plain || "").slice(0, 500),
    } satisfies GmailMessageSummary
  }))

  return details.filter((item): item is GmailMessageSummary => Boolean(item))
}
