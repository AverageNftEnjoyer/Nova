import { decryptSecret, encryptSecret } from "@/lib/security/encryption"

import { assertYouTubeOk, youtubeFetchWithRetry } from "../client/index"
import { youtubeError, toYouTubeServiceError } from "../errors/index"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "../../store/server-store"
import {
  GOOGLE_TOKEN_ENDPOINT,
  YOUTUBE_API_BASE,
  type YouTubeClientConfig,
  type YouTubeScope,
  type YouTubeTokenRefreshResult,
} from "../types/index"

const YOUTUBE_CALLBACK_PATH = "/api/integrations/youtube/callback"

function normalizeYoutubeRedirectUri(rawValue: string, appUrl: string): string {
  const raw = String(rawValue || "").trim()
  if (!raw) return `${appUrl}${YOUTUBE_CALLBACK_PATH}`
  return raw
}

export async function getYouTubeClientConfig(scope?: YouTubeScope): Promise<YouTubeClientConfig> {
  const integrations = await loadIntegrationsConfig(scope)
  const configuredRedirect = String(
    integrations.youtube.redirectUri || "",
  ).trim()
  const appUrl = (() => {
    if (!configuredRedirect) return "http://localhost:3000"
    try {
      return new URL(configuredRedirect).origin.replace(/\/+$/, "")
    } catch {
      return "http://localhost:3000"
    }
  })()
  return {
    clientId: String(
      integrations.gmail.oauthClientId ||
      "",
    ).trim(),
    clientSecret: String(
      integrations.gmail.oauthClientSecret ||
      "",
    ).trim(),
    redirectUri: normalizeYoutubeRedirectUri(configuredRedirect, appUrl),
    appUrl,
  }
}

export async function getYouTubeGrantedScopes(scope?: YouTubeScope): Promise<string[]> {
  const integrations = await loadIntegrationsConfig(scope)
  return Array.isArray(integrations.youtube.scopes)
    ? integrations.youtube.scopes.map((scopeText) => String(scopeText || "").trim()).filter(Boolean)
    : []
}

async function refreshYouTubeAccessToken(refreshToken: string, scope?: YouTubeScope): Promise<YouTubeTokenRefreshResult> {
  const { clientId, clientSecret } = await getYouTubeClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw youtubeError("youtube.invalid_request", "Google OAuth client credentials are missing for YouTube.", { status: 400 })
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  })
  const tokenRes = await youtubeFetchWithRetry(
    GOOGLE_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "youtube_token_refresh", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertYouTubeOk(tokenRes, "Google token refresh failed for YouTube.")
  const tokenData = await tokenRes.json().catch(() => null) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  } | null
  const accessToken = String(tokenData?.access_token || "").trim()
  const nextRefresh = String(tokenData?.refresh_token || "").trim()
  const expiresIn = Number(tokenData?.expires_in || 0)
  const scopes = String(tokenData?.scope || "").split(/\s+/).map((scopeText) => scopeText.trim()).filter(Boolean)
  if (!accessToken) {
    throw youtubeError("youtube.token_missing", "Google token refresh returned no access token for YouTube.", { status: 502 })
  }
  return { accessToken, refreshToken: nextRefresh, expiresIn, scopes }
}

export async function exchangeCodeForYouTubeTokens(code: string, scope?: YouTubeScope): Promise<void> {
  const { clientId, clientSecret, redirectUri } = await getYouTubeClientConfig(scope)
  if (!clientId || !clientSecret) {
    throw youtubeError("youtube.invalid_request", "Google OAuth client credentials are missing for YouTube.", { status: 400 })
  }
  const normalizedCode = String(code || "").trim()
  if (!normalizedCode) throw youtubeError("youtube.invalid_request", "Missing OAuth code.", { status: 400 })

  const body = new URLSearchParams({
    code: normalizedCode,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })
  const tokenRes = await youtubeFetchWithRetry(
    GOOGLE_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "youtube_token_exchange", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertYouTubeOk(tokenRes, "Google token exchange failed for YouTube.")
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
  if (!accessToken) {
    throw youtubeError("youtube.token_missing", "Google token exchange returned no access token for YouTube.", { status: 502 })
  }

  const profileRes = await youtubeFetchWithRetry(
    `${YOUTUBE_API_BASE}/channels?part=snippet&mine=true&maxResults=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { operation: "youtube_profile_channel", maxAttempts: 2, timeoutMs: 8_000 },
  )
  await assertYouTubeOk(profileRes, "YouTube profile fetch failed.")
  const profileData = await profileRes.json().catch(() => null) as {
    items?: Array<{ id?: string; snippet?: { title?: string } }>
  } | null
  const channelId = String(profileData?.items?.[0]?.id || "").trim()
  const channelTitle = String(profileData?.items?.[0]?.snippet?.title || "").trim()

  const current = await loadIntegrationsConfig(scope)
  const existingRefresh = decryptSecret(current.youtube.refreshTokenEnc)
  const refreshToStore = refreshToken || existingRefresh
  if (!refreshToStore) {
    throw youtubeError("youtube.token_missing", "No YouTube refresh token available. Reconnect YouTube.", { status: 400 })
  }
  const expiry = Date.now() + Math.max(expiresIn - 60, 60) * 1000
  await updateIntegrationsConfig(
    {
      youtube: {
        connected: true,
        channelId,
        channelTitle,
        scopes: scopes.length > 0 ? scopes : current.youtube.scopes,
        accessTokenEnc: encryptSecret(accessToken),
        refreshTokenEnc: encryptSecret(refreshToStore),
        tokenExpiry: expiry,
      },
    },
    scope,
  )
}

const _tokenCache = new Map<string, { token: string; expiry: number }>()
const TOKEN_CACHE_MAX_USERS = 120
const _tokenRefreshInFlight = new Map<string, Promise<string>>()

function tokenCacheKey(scope?: YouTubeScope): string {
  return String(scope?.userId || scope?.user?.id || "").trim().toLowerCase()
}

export async function getValidYouTubeAccessToken(forceRefresh = false, scope?: YouTubeScope): Promise<string> {
  const now = Date.now()
  const cacheKey = tokenCacheKey(scope)
  if (!forceRefresh && cacheKey) {
    const cached = _tokenCache.get(cacheKey)
    if (cached && cached.expiry > now + 30_000) return cached.token
  }

  const config = await loadIntegrationsConfig(scope)
  if (!config.youtube.connected) {
    throw youtubeError("youtube.not_connected", "YouTube is not connected.", { status: 409 })
  }

  const cachedAccess = decryptSecret(config.youtube.accessTokenEnc)
  if (!forceRefresh && cachedAccess && config.youtube.tokenExpiry > now + 30_000) {
    if (cacheKey) _tokenCache.set(cacheKey, { token: cachedAccess, expiry: config.youtube.tokenExpiry })
    return cachedAccess
  }

  const refreshToken = decryptSecret(config.youtube.refreshTokenEnc)
  if (!refreshToken) {
    throw youtubeError("youtube.token_missing", "No YouTube refresh token available. Reconnect YouTube.", { status: 400 })
  }

  if (cacheKey) {
    const inflight = _tokenRefreshInFlight.get(cacheKey)
    if (inflight) return inflight
  }

  const doRefresh = async (): Promise<string> => {
    let refreshed: YouTubeTokenRefreshResult
    try {
      refreshed = await refreshYouTubeAccessToken(refreshToken, scope)
    } catch (error) {
      const normalized = toYouTubeServiceError(error, "YouTube token refresh failed.")
      const normalizedMessage = String(normalized.message || "").toLowerCase()
      const invalidGrant = normalized.code === "youtube.invalid_request" && normalizedMessage.includes("invalid_grant")
      if (invalidGrant) {
        throw youtubeError("youtube.token_missing", "YouTube authorization expired. Reconnect YouTube.", { status: 409, cause: error })
      }
      throw normalized
    }
    const nextRefresh = refreshed.refreshToken || refreshToken
    const refreshNow = Date.now()
    const nextExpiry = refreshNow + Math.max(refreshed.expiresIn - 60, 60) * 1000
    await updateIntegrationsConfig(
      {
        youtube: {
          connected: true,
          scopes: refreshed.scopes.length > 0 ? refreshed.scopes : config.youtube.scopes,
          accessTokenEnc: encryptSecret(refreshed.accessToken),
          refreshTokenEnc: encryptSecret(nextRefresh),
          tokenExpiry: nextExpiry,
        },
      },
      scope,
    )
    if (cacheKey) {
      if (_tokenCache.size > TOKEN_CACHE_MAX_USERS) {
        const evictBefore = Date.now()
        for (const [key, value] of _tokenCache.entries()) {
          if (value.expiry <= evictBefore) _tokenCache.delete(key)
        }
      }
      _tokenCache.set(cacheKey, { token: refreshed.accessToken, expiry: nextExpiry })
    }
    return refreshed.accessToken
  }

  const refreshPromise = doRefresh().finally(() => {
    if (cacheKey) _tokenRefreshInFlight.delete(cacheKey)
  })
  if (cacheKey) _tokenRefreshInFlight.set(cacheKey, refreshPromise)
  return refreshPromise
}

export async function disconnectYouTube(scope?: YouTubeScope): Promise<void> {
  await updateIntegrationsConfig(
    {
      youtube: {
        connected: false,
        channelId: "",
        channelTitle: "",
        accessTokenEnc: "",
        refreshTokenEnc: "",
        tokenExpiry: 0,
      },
    },
    scope,
  )
  const cacheKey = tokenCacheKey(scope)
  if (cacheKey) {
    _tokenCache.delete(cacheKey)
    _tokenRefreshInFlight.delete(cacheKey)
  }
}
