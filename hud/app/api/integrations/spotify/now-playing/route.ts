import { NextResponse } from "next/server"

import { toSpotifyServiceError } from "@/lib/integrations/spotify/errors"
import { getSpotifyNowPlaying } from "@/lib/integrations/spotify"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { evictStaleNowPlayingCache, logSpotifyApi, nowPlayingCacheByUser, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOW_PLAYING_LOG_HEARTBEAT_MS = 120_000
const nowPlayingLogStateByUser = new Map<string, { playing: boolean; trackId: string; loggedAt: number }>()
const NOW_PLAYING_LOG_MAX_USERS = 200

// Short-lived per-user cache (declared in ../_shared.ts, imported above).
// Serving from cache for the first 1.5s avoids hammering Spotify's API on every 2s poll
// while still delivering fresh data within one extra poll cycle of any real change.
// The playback route invalidates this cache immediately after any command.
const NOW_PLAYING_CACHE_TTL_PLAYING_MS = 1_500
const NOW_PLAYING_CACHE_TTL_PAUSED_MS  = 4_000

function disconnectedNowPlayingResponse(): ReturnType<typeof NextResponse.json> {
  return NextResponse.json({
    ok: true,
    connected: false,
    nowPlaying: {
      connected: false,
      playing: false,
      progressMs: 0,
      durationMs: 0,
      trackId: "",
      trackName: "",
      artistName: "",
      albumName: "",
      albumArtUrl: "",
      deviceId: "",
      deviceName: "",
    },
  })
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.spotifyNowPlaying)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const userContextId = verified.user.id
    const now = Date.now()

    // Serve from cache if fresh enough — avoids a Spotify API round-trip on every 2s poll.
    // Cache TTL is shorter than the poll interval so clients always see fresh data
    // within one extra cycle of any real change.
    const cached = nowPlayingCacheByUser.get(userContextId)
    const cacheTtl = cached?.data.playing ? NOW_PLAYING_CACHE_TTL_PLAYING_MS : NOW_PLAYING_CACHE_TTL_PAUSED_MS
    if (cached && now - cached.cachedAt < cacheTtl) {
      return NextResponse.json({ ok: true, connected: cached.data.connected, nowPlaying: cached.data })
    }

    const nowPlaying = await getSpotifyNowPlaying(verified)
    evictStaleNowPlayingCache(now)
    nowPlayingCacheByUser.set(userContextId, { data: nowPlaying, cachedAt: now })
    const previous = nowPlayingLogStateByUser.get(userContextId)
    const changed = !previous
      || previous.playing !== nowPlaying.playing
      || previous.trackId !== nowPlaying.trackId
    const dueHeartbeat = !previous || (now - previous.loggedAt >= NOW_PLAYING_LOG_HEARTBEAT_MS)
    if (changed || dueHeartbeat) {
      logSpotifyApi("now_playing.success", {
        userContextId,
        playing: nowPlaying.playing,
        trackId: nowPlaying.trackId,
      })
      if (nowPlayingLogStateByUser.size > NOW_PLAYING_LOG_MAX_USERS) {
        for (const [key, state] of nowPlayingLogStateByUser.entries()) {
          if (now - state.loggedAt > NOW_PLAYING_LOG_HEARTBEAT_MS * 4) nowPlayingLogStateByUser.delete(key)
        }
      }
      nowPlayingLogStateByUser.set(userContextId, {
        playing: nowPlaying.playing,
        trackId: nowPlaying.trackId,
        loggedAt: now,
      })
    }
    return NextResponse.json({
      ok: true,
      connected: nowPlaying.connected,
      nowPlaying,
    })
  } catch (error) {
    const normalized = toSpotifyServiceError(error, "Failed to read Spotify now playing.")
    const normalizedMessage = String(normalized.message || "").toLowerCase()
    const invalidGrant = normalized.code === "spotify.invalid_request" && normalizedMessage.includes("invalid_grant")
    if (invalidGrant) {
      logSpotifyApi("now_playing.soft_fail", {
        userContextId: verified.user.id,
        code: "spotify.token_missing",
      })
      return disconnectedNowPlayingResponse()
    }
    if (normalized.code === "spotify.not_connected" || normalized.code === "spotify.token_missing") {
      logSpotifyApi("now_playing.soft_fail", {
        userContextId: verified.user.id,
        code: normalized.code,
      })
      return disconnectedNowPlayingResponse()
    }
    return spotifyApiErrorResponse(error, "Failed to read Spotify now playing.")
  }
}
