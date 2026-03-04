import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { youtubeError } from "../errors/index"
import { DEFAULT_YOUTUBE_SCOPES, GOOGLE_OAUTH_BASE, type YouTubeClientConfig, type YouTubeOAuthStatePayload } from "../types/index"

const DEV_FALLBACK_OAUTH_STATE_SECRET = createHash("sha256")
  .update(`nova-dev-youtube-oauth:${process.cwd()}`)
  .digest("hex")

function sanitizeReturnToPath(value: string): string {
  const raw = String(value || "").trim().slice(0, 2048)
  if (!raw) return "/integrations"
  if (/[\r\n]/.test(raw)) return "/integrations"
  if (!raw.startsWith("/")) return "/integrations"
  if (/^\/{2,}/.test(raw)) return "/integrations"
  if (raw.includes("\\") || /%5c/i.test(raw)) return "/integrations"
  try {
    const parsed = new URL(raw, "http://localhost")
    if (parsed.origin !== "http://localhost") return "/integrations"
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return "/integrations"
  }
}

function getOAuthSecret(): string {
  const configured = String(
    process.env.NOVA_YOUTUBE_OAUTH_STATE_SECRET ||
    process.env.NOVA_GMAIL_OAUTH_STATE_SECRET ||
    process.env.NOVA_ENCRYPTION_KEY ||
    "",
  ).trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") {
    throw youtubeError(
      "youtube.internal",
      "NOVA_YOUTUBE_OAUTH_STATE_SECRET (or NOVA_GMAIL_OAUTH_STATE_SECRET / NOVA_ENCRYPTION_KEY) is required in production.",
    )
  }
  return DEV_FALLBACK_OAUTH_STATE_SECRET
}

function signState(payload: YouTubeOAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

function verifyState(raw: string): YouTubeOAuthStatePayload | null {
  const [body, signature] = String(raw || "").split(".")
  if (!body || !signature) return null
  const expected = createHmac("sha256", getOAuthSecret()).update(body).digest("base64url")
  const expectedBuf = Buffer.from(expected, "utf8")
  const signatureBuf = Buffer.from(signature, "utf8")
  if (expectedBuf.length !== signatureBuf.length) return null
  if (!timingSafeEqual(expectedBuf, signatureBuf)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as YouTubeOAuthStatePayload
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null
    if (typeof parsed.returnTo !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export function parseYouTubeOAuthState(state: string): { userId: string; returnTo: string } | null {
  const parsed = verifyState(state)
  if (!parsed) return null
  const userId = String(parsed.userId || "").trim()
  if (!userId) return null
  return { userId, returnTo: sanitizeReturnToPath(parsed.returnTo || "/integrations") }
}

export function buildYouTubeOAuthUrl(params: {
  returnTo: string
  userId: string
  config: YouTubeClientConfig
}): string {
  const userId = String(params.userId || "").trim()
  if (!userId) throw youtubeError("youtube.invalid_request", "Missing user scope for YouTube OAuth.", { status: 400 })
  const clientId = String(params.config.clientId || "").trim()
  if (!clientId) throw youtubeError("youtube.invalid_request", "Google OAuth client id is missing for YouTube.", { status: 400 })

  const safeReturnTo = sanitizeReturnToPath(params.returnTo)
  const state = signState({
    ts: Date.now(),
    nonce: randomBytes(8).toString("hex"),
    userId,
    returnTo: safeReturnTo,
  })
  const redirectTarget = params.config.redirectUri || `${params.config.appUrl}/api/integrations/youtube/callback`
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectTarget,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: DEFAULT_YOUTUBE_SCOPES.join(" "),
    state,
  })
  return `${GOOGLE_OAUTH_BASE}?${query.toString()}`
}
