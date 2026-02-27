import { NextResponse } from "next/server"

import { toSpotifyServiceError } from "@/lib/integrations/spotify/errors"
import { getSpotifyNowPlaying } from "@/lib/integrations/spotify"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logSpotifyApi, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOW_PLAYING_LOG_HEARTBEAT_MS = 120_000
const nowPlayingLogStateByUser = new Map<string, { playing: boolean; trackId: string; loggedAt: number }>()

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const nowPlaying = await getSpotifyNowPlaying(verified)
    const userContextId = verified.user.id
    const now = Date.now()
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
    if (normalized.code === "spotify.not_connected" || normalized.code === "spotify.token_missing") {
      logSpotifyApi("now_playing.soft_fail", {
        userContextId: verified.user.id,
        code: normalized.code,
      })
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
    return spotifyApiErrorResponse(error, "Failed to read Spotify now playing.")
  }
}
