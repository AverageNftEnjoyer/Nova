import { NextResponse } from "next/server"

import { controlSpotifyPlayback, getSpotifyCurrentContext } from "@/lib/integrations/spotify"
import { SpotifyServiceError } from "@/lib/integrations/spotify/errors"
import { readSpotifySkillPrefs, writeSpotifyFavoritePlaylist } from "@/lib/integrations/spotify/skill-prefs"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logSpotifyApi, playbackBodySchema, safeJson, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEVICE_UNAVAILABLE_COOLDOWN_MS = 20_000
const playSmartUnavailableByUser = new Map<string, { lastAt: number; suppressed: number }>()

function normalizeUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function deviceUnavailablePlaybackResponse(input?: {
  action?: string
  fallbackRecommended?: boolean
  retryAfterMs?: number
}): NextResponse {
  return NextResponse.json({
    ok: false,
    action: input?.action || "play_smart",
    code: "spotify.device_unavailable",
    error: "No active Spotify playback device. Open Spotify and try again.",
    fallbackRecommended: input?.fallbackRecommended ?? true,
    retryAfterMs: Number.isFinite(Number(input?.retryAfterMs)) ? Math.max(0, Math.floor(Number(input?.retryAfterMs))) : undefined,
  })
}

export async function POST(req: Request) {
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) return runtimeSharedTokenErrorResponse(runtimeTokenDecision)

  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.spotifyPlayback)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const body = await safeJson(req)
    const parsed = playbackBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid playback request.")
    }
    const payload = parsed.data
    const requestedUserContextId = normalizeUserContextId(payload.userContextId)
    const verifiedUserContextId = normalizeUserContextId(verified.user.id)
    if (requestedUserContextId && requestedUserContextId !== verifiedUserContextId) {
      return NextResponse.json(
        { ok: false, error: "Spotify playback user scope mismatch.", code: "FORBIDDEN_USER_SCOPE" },
        { status: 403 },
      )
    }

    const userId = verifiedUserContextId || verified.user.id

    if (payload.action === "play_smart") {
      const now = Date.now()
      const recentUnavailable = playSmartUnavailableByUser.get(userId)
      if (recentUnavailable && now - recentUnavailable.lastAt < DEVICE_UNAVAILABLE_COOLDOWN_MS) {
        const suppressed = recentUnavailable.suppressed + 1
        playSmartUnavailableByUser.set(userId, {
          lastAt: recentUnavailable.lastAt,
          suppressed,
        })
        const retryAfterMs = Math.max(0, DEVICE_UNAVAILABLE_COOLDOWN_MS - (now - recentUnavailable.lastAt))
        logSpotifyApi("playback.device_unavailable_throttled", {
          userContextId: userId,
          action: "play_smart",
          suppressed,
          retryAfterMs,
        })
        return NextResponse.json({
          ok: false,
          action: "play_smart",
          code: "spotify.device_unavailable",
          error: "No active Spotify playback device. Open Spotify and try again.",
          fallbackRecommended: false,
          retryAfterMs,
        })
      }

      const prefs = readSpotifySkillPrefs(userId)
      try {
        const result = await controlSpotifyPlayback(
          "play_smart",
          {
            playlistUri: prefs.favoritePlaylistUri,
            playlistName: prefs.favoritePlaylistName,
          },
          verified,
        )
        playSmartUnavailableByUser.delete(userId)
        logSpotifyApi("playback.success", { userContextId: userId, action: "play_smart" })
        return NextResponse.json(result)
      } catch (err) {
        if (err instanceof SpotifyServiceError && err.code === "spotify.device_unavailable") {
          playSmartUnavailableByUser.set(userId, { lastAt: Date.now(), suppressed: 0 })
          logSpotifyApi("playback.device_unavailable", { userContextId: userId, action: "play_smart" })
          return deviceUnavailablePlaybackResponse({
            action: "play_smart",
            fallbackRecommended: true,
          })
        }
        throw err
      }
    }

    // save_playlist: auto-detect what playlist is currently playing, then write to skill file.
    if (payload.action === "save_playlist") {
      // Allow caller to pass an explicit URI, or auto-detect from currently playing context.
      let playlistUri = String(payload.playlistUri || "").trim()
      let playlistName = String(payload.playlistName || "").trim()

      if (!playlistUri) {
        // Detect current context via the service layer
        const ctx = await getSpotifyCurrentContext(verified)
        if (!ctx.playing) {
          return NextResponse.json(
            { ok: false, error: "Nothing is playing. Start a playlist first, then ask me to save it.", code: "spotify.not_found" },
            { status: 404 },
          )
        }
        if (!ctx.contextUri) {
          return NextResponse.json(
            { ok: false, error: "No playlist context detected. Start a playlist (not just a single track) first.", code: "spotify.not_found" },
            { status: 404 },
          )
        }
        playlistUri = ctx.contextUri
        if (!playlistName) playlistName = ctx.contextName
      }

      const writeResult = writeSpotifyFavoritePlaylist(userId, playlistUri, playlistName)
      if (!writeResult.ok) {
        return NextResponse.json(
          { ok: false, error: writeResult.message, code: "spotify.internal" },
          { status: 500 },
        )
      }
      logSpotifyApi("playback.success", { userContextId: userId, action: "save_playlist", playlistUri, playlistName })
      return NextResponse.json({
        ok: true,
        action: "save_playlist",
        message: writeResult.message,
        skipNowPlayingRefresh: true,
      })
    }

    const result = await controlSpotifyPlayback(
      payload.action,
      {
        query: payload.query || "",
        type: payload.type,
        positionMs: payload.positionMs,
        volumePercent: payload.volumePercent,
        shuffleOn: payload.shuffleOn,
        repeatMode: payload.repeatMode,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
      },
      verified,
    )
    logSpotifyApi("playback.success", {
      userContextId: userId,
      action: payload.action,
      fallbackRecommended: result.fallbackRecommended === true,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SpotifyServiceError && error.code === "spotify.device_unavailable") {
      logSpotifyApi("playback.device_unavailable", { action: "general" })
      return deviceUnavailablePlaybackResponse({
        action: "general",
        fallbackRecommended: true,
      })
    }
    return spotifyApiErrorResponse(error, "Failed to control Spotify playback.")
  }
}
