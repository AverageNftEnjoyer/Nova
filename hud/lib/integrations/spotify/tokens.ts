import { decryptSecret, encryptSecret } from "@/lib/security/encryption"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "../server-store"
import { assertSpotifyOk, spotifyFetchWithRetry } from "./client"
import { spotifyError } from "./errors"
import {
  SPOTIFY_API_BASE,
  SPOTIFY_TOKEN_ENDPOINT,
  type SpotifyClientConfig,
  type SpotifyScope,
  type SpotifyTokenRefreshResult,
} from "./types"

export async function getSpotifyClientConfig(scope?: SpotifyScope): Promise<SpotifyClientConfig> {
  const integrations = await loadIntegrationsConfig(scope)
  return {
    clientId: String(integrations.spotify.oauthClientId || process.env.NOVA_SPOTIFY_CLIENT_ID || "").trim(),
    redirectUri: String(
      integrations.spotify.redirectUri ||
      process.env.NOVA_SPOTIFY_REDIRECT_URI ||
      "http://localhost:3000/api/integrations/spotify/callback",
    ).trim(),
    appUrl: String(process.env.NOVA_APP_URL || "http://localhost:3000").trim().replace(/\/+$/, ""),
  }
}

async function refreshSpotifyAccessToken(refreshToken: string, scope?: SpotifyScope): Promise<SpotifyTokenRefreshResult> {
  const { clientId } = await getSpotifyClientConfig(scope)
  if (!clientId) {
    throw spotifyError("spotify.invalid_request", "Spotify OAuth client id is missing.", { status: 400 })
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: "refresh_token",
  })
  const tokenRes = await spotifyFetchWithRetry(
    SPOTIFY_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "spotify_token_refresh", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertSpotifyOk(tokenRes, "Spotify token refresh failed.")
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
  if (!accessToken) throw spotifyError("spotify.token_missing", "Spotify token refresh returned no access token.", { status: 502 })
  return { accessToken, refreshToken: nextRefresh, expiresIn, scopes }
}

export async function exchangeCodeForSpotifyTokens(
  code: string,
  codeVerifier: string,
  scope?: SpotifyScope,
): Promise<void> {
  const { clientId, redirectUri } = await getSpotifyClientConfig(scope)
  if (!clientId) {
    throw spotifyError("spotify.invalid_request", "Spotify OAuth client id is missing.", { status: 400 })
  }
  const normalizedCode = String(code || "").trim()
  const normalizedVerifier = String(codeVerifier || "").trim()
  if (!normalizedCode) throw spotifyError("spotify.invalid_request", "Missing OAuth code.", { status: 400 })
  if (!normalizedVerifier) throw spotifyError("spotify.invalid_state", "Missing PKCE verifier.", { status: 400 })

  const body = new URLSearchParams({
    code: normalizedCode,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: normalizedVerifier,
  })
  const tokenRes = await spotifyFetchWithRetry(
    SPOTIFY_TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    { operation: "spotify_token_exchange", maxAttempts: 3, timeoutMs: 10_000 },
  )
  await assertSpotifyOk(tokenRes, "Spotify token exchange failed.")
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
  if (!accessToken) throw spotifyError("spotify.token_missing", "Spotify token exchange returned no access token.", { status: 502 })

  const profileRes = await spotifyFetchWithRetry(
    `${SPOTIFY_API_BASE}/me`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { operation: "spotify_profile", maxAttempts: 2, timeoutMs: 8_000 },
  )
  await assertSpotifyOk(profileRes, "Spotify profile fetch failed.")
  const profileData = await profileRes.json().catch(() => null) as { id?: string; display_name?: string } | null
  const spotifyUserId = String(profileData?.id || "").trim()
  const displayName = String(profileData?.display_name || "").trim()

  const current = await loadIntegrationsConfig(scope)
  const existingRefresh = decryptSecret(current.spotify.refreshTokenEnc)
  const refreshToStore = refreshToken || existingRefresh
  if (!refreshToStore) throw spotifyError("spotify.token_missing", "No Spotify refresh token available. Reconnect Spotify.", { status: 400 })
  const expiry = Date.now() + Math.max(expiresIn - 60, 60) * 1000

  await updateIntegrationsConfig({
    spotify: {
      ...current.spotify,
      connected: true,
      spotifyUserId,
      displayName,
      scopes: scopes.length > 0 ? scopes : current.spotify.scopes,
      accessTokenEnc: encryptSecret(accessToken),
      refreshTokenEnc: encryptSecret(refreshToStore),
      tokenExpiry: expiry,
    },
  }, scope)
}

// In-process token cache — avoids a DB read on every request within the same server process.
// Keyed by userId so multi-user isolation is preserved.
const _tokenCache = new Map<string, { token: string; expiry: number }>()

function _tokenCacheKey(scope?: SpotifyScope): string {
  return String(scope?.userId || scope?.user?.id || "").trim().toLowerCase()
}

export async function getValidSpotifyAccessToken(
  forceRefresh = false,
  scope?: SpotifyScope,
): Promise<string> {
  const now = Date.now()
  const cacheKey = _tokenCacheKey(scope)

  // Fast path: serve from in-process cache (saves a Supabase round trip)
  if (!forceRefresh && cacheKey) {
    const cached = _tokenCache.get(cacheKey)
    if (cached && cached.expiry > now + 30_000) return cached.token
  }

  const config = await loadIntegrationsConfig(scope)
  if (!config.spotify.connected) throw spotifyError("spotify.not_connected", "Spotify is not connected.", { status: 409 })

  const cachedAccess = decryptSecret(config.spotify.accessTokenEnc)
  if (!forceRefresh && cachedAccess && config.spotify.tokenExpiry > now + 30_000) {
    if (cacheKey) _tokenCache.set(cacheKey, { token: cachedAccess, expiry: config.spotify.tokenExpiry })
    return cachedAccess
  }

  const refreshToken = decryptSecret(config.spotify.refreshTokenEnc)
  if (!refreshToken) throw spotifyError("spotify.token_missing", "No Spotify refresh token available. Reconnect Spotify.", { status: 400 })

  const refreshed = await refreshSpotifyAccessToken(refreshToken, scope)
  const nextRefresh = refreshed.refreshToken || refreshToken
  const nextExpiry = now + Math.max(refreshed.expiresIn - 60, 60) * 1000
  await updateIntegrationsConfig({
    spotify: {
      ...config.spotify,
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      refreshTokenEnc: encryptSecret(nextRefresh),
      tokenExpiry: nextExpiry,
      scopes: refreshed.scopes.length > 0 ? refreshed.scopes : config.spotify.scopes,
      connected: true,
    },
  }, scope)
  if (cacheKey) _tokenCache.set(cacheKey, { token: refreshed.accessToken, expiry: nextExpiry })
  return refreshed.accessToken
}

export async function disconnectSpotify(scope?: SpotifyScope): Promise<void> {
  const current = await loadIntegrationsConfig(scope)
  await updateIntegrationsConfig({
    spotify: {
      ...current.spotify,
      connected: false,
      spotifyUserId: "",
      displayName: "",
      accessTokenEnc: "",
      refreshTokenEnc: "",
      tokenExpiry: 0,
    },
  }, scope)
}
