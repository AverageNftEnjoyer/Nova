import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { spotifyError } from "../errors/index"
import { getOAuthStateSecret } from "@/lib/security/oauth-state-secret"
import { DEFAULT_SPOTIFY_SCOPES, SPOTIFY_AUTH_BASE, type SpotifyClientConfig, type SpotifyOAuthStatePayload } from "../types/index"

function getOAuthSecret(): string {
  try {
    return getOAuthStateSecret()
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "NOVA_ENCRYPTION_KEY is required for OAuth state signing."
    throw spotifyError("spotify.internal", message)
  }
}

function base64UrlFromBuffer(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function sha256Base64Url(value: string): string {
  return base64UrlFromBuffer(createHash("sha256").update(value).digest())
}

function generatePkceCodeVerifier(): string {
  return base64UrlFromBuffer(randomBytes(64)).slice(0, 96)
}

function signState(payload: SpotifyOAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function verifyState(raw: string): SpotifyOAuthStatePayload | null {
  const [body, signature] = String(raw || "").split(".")
  if (!body || !signature) return null
  const expected = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  const expectedBuf = Buffer.from(expected, "utf8")
  const signatureBuf = Buffer.from(signature, "utf8")
  if (expectedBuf.length !== signatureBuf.length) return null
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SpotifyOAuthStatePayload
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null
    if (typeof parsed.returnTo !== "string") return null
    if (typeof parsed.codeVerifier !== "string" || parsed.codeVerifier.trim().length < 32) return null
    return parsed
  } catch {
    return null
  }
}

export function parseSpotifyOAuthState(state: string): { userId: string; returnTo: string; codeVerifier: string } | null {
  const parsed = verifyState(state)
  if (!parsed) return null
  const userId = String(parsed.userId || "").trim()
  if (!userId) return null
  return {
    userId,
    returnTo: parsed.returnTo || "/integrations",
    codeVerifier: String(parsed.codeVerifier || "").trim(),
  }
}

export function buildSpotifyOAuthUrl(params: {
  returnTo: string
  userId: string
  config: SpotifyClientConfig
}): string {
  const userId = String(params.userId || "").trim()
  if (!userId) throw spotifyError("spotify.invalid_request", "Missing user scope for Spotify OAuth.", { status: 400 })
  const clientId = String(params.config.clientId || "").trim()
  if (!clientId) throw spotifyError("spotify.invalid_request", "Spotify OAuth client id is missing.", { status: 400 })

  const safeReturnTo = params.returnTo.startsWith("/") ? params.returnTo : "/integrations"
  const codeVerifier = generatePkceCodeVerifier()
  const state = signState({
    ts: Date.now(),
    nonce: randomBytes(8).toString("hex"),
    userId,
    returnTo: safeReturnTo,
    codeVerifier,
  })
  const redirectTarget = params.config.redirectUri || `${params.config.appUrl}/api/integrations/spotify/callback`
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectTarget,
    state,
    scope: DEFAULT_SPOTIFY_SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: sha256Base64Url(codeVerifier),
  })
  return `${SPOTIFY_AUTH_BASE}?${query.toString()}`
}
