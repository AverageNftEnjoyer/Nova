import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { probeSpotifyConnection } from "@/lib/integrations/spotify"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.spotifyPlayback)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const probe = await probeSpotifyConnection(verified)
    const config = await loadIntegrationsConfig(verified)
    return NextResponse.json({
      ok: true,
      connected: probe.connected,
      profile: {
        spotifyUserId: probe.spotifyUserId,
        displayName: probe.displayName,
      },
      deviceCount: probe.deviceCount,
      nowPlaying: probe.nowPlaying,
      config: {
        spotify: {
          connected: config.spotify.connected,
          spotifyUserId: config.spotify.spotifyUserId,
          displayName: config.spotify.displayName,
          scopes: config.spotify.scopes,
          oauthClientId: config.spotify.oauthClientId,
          redirectUri: config.spotify.redirectUri,
          tokenConfigured:
            config.spotify.refreshTokenEnc.trim().length > 0 ||
            config.spotify.accessTokenEnc.trim().length > 0,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Spotify probe failed.",
      },
      { status: 400 },
    )
  }
}
