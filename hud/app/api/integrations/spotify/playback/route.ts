import { NextResponse } from "next/server"

import { controlSpotifyPlayback, findSpotifyPlaylistByQuery, getSpotifyCurrentContext } from "@/lib/integrations/spotify"
import { SpotifyServiceError } from "@/lib/integrations/spotify/errors/index"
import { clearSpotifyFavoritePlaylist, readSpotifySkillPrefs, writeSpotifyFavoritePlaylist } from "@/lib/integrations/spotify/skill-prefs/index"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logSpotifyApi, nowPlayingCacheByUser, playbackBodySchema, safeJson, spotifyApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEVICE_UNAVAILABLE_COOLDOWN_MS = 20_000
const PLAY_SMART_UNAVAIL_MAX_USERS = 200
const playSmartUnavailableByUser = new Map<string, { lastAt: number; suppressed: number }>()

function normalizeUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function deviceUnavailablePlaybackResponse(input?: {
  action?: string
  retryAfterMs?: number
}): NextResponse {
  return NextResponse.json({
    ok: false,
    action: input?.action || "play_smart",
    code: "spotify.device_unavailable",
    error: "No active Spotify playback device. Open Spotify and try again.",
    retryAfterMs: Number.isFinite(Number(input?.retryAfterMs)) ? Math.max(0, Math.floor(Number(input?.retryAfterMs))) : undefined,
  })
}

export async function POST(req: Request) {
  try {
    const body = await safeJson(req)
    const parsed = playbackBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid playback request.")
    }
    const payload = parsed.data
    const { unauthorized, verified } = await requireSupabaseApiUser(req)
    const requestedUserContextId = normalizeUserContextId(payload.userContextId)
    const runtimeTokenDecision = verified
      ? { ok: true, authenticated: false as const }
      : verifyRuntimeSharedToken(req)
    if (!verified && !runtimeTokenDecision.ok) {
      const hasAuthorizationHeader = String(req.headers.get("authorization") || "").trim().length > 0
      if (!hasAuthorizationHeader) {
        return runtimeSharedTokenErrorResponse(runtimeTokenDecision)
      }
    }
    const runtimeAuthenticated = runtimeTokenDecision.authenticated === true

    let userId = ""
    let scope: Parameters<typeof controlSpotifyPlayback>[2]

    if (verified) {
      const verifiedUserContextId = normalizeUserContextId(verified.user.id)
      if (requestedUserContextId && requestedUserContextId !== verifiedUserContextId) {
        // Treat userContextId in payload as a client hint only; authenticated user scope
        // is always derived from verified Supabase identity.
        logSpotifyApi("playback.user_scope_hint_mismatch", {
          requestedUserContextId,
          verifiedUserContextId,
        })
      }
      userId = verifiedUserContextId || verified.user.id
      scope = verified
    } else {
      if (!runtimeAuthenticated) {
        return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
      }
      if (!requestedUserContextId) {
        return NextResponse.json(
          { ok: false, code: "spotify.user_context_required", error: "Spotify runtime requests require userContextId." },
          { status: 400 },
        )
      }
      userId = requestedUserContextId
      scope = {
        userId,
        allowServiceRole: true,
        serviceRoleReason: "runtime-bridge",
      }
      logSpotifyApi("playback.runtime_bridge", {
        userContextId: userId,
        action: payload.action,
      })
    }

    const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.spotifyPlayback)
    if (!limit.allowed) return rateLimitExceededResponse(limit)

    // Invalidate the server-side now-playing cache so the very next poll after this
    // command always fetches fresh state from Spotify's API rather than stale cache.
    nowPlayingCacheByUser.delete(userId)

    if (payload.action === "play_smart") {
      const now = Date.now()
      if (playSmartUnavailableByUser.size > PLAY_SMART_UNAVAIL_MAX_USERS) {
        for (const [key, entry] of playSmartUnavailableByUser.entries()) {
          if (now - entry.lastAt > DEVICE_UNAVAILABLE_COOLDOWN_MS * 4) playSmartUnavailableByUser.delete(key)
        }
      }
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
          scope,
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
        const ctx = await getSpotifyCurrentContext(scope)
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

    if (payload.action === "set_favorite_playlist") {
      const query = String(payload.query || "").trim()
      if (!query) {
        return NextResponse.json(
          { ok: false, error: "Tell me the playlist name to set as favorite.", code: "spotify.invalid_request" },
          { status: 400 },
        )
      }
      const resolved = await findSpotifyPlaylistByQuery(query, scope)
      if (!resolved.match) {
        const suffix = resolved.suggestions.length > 0
          ? ` Did you mean: ${resolved.suggestions.join(", ")}?`
          : ""
        return NextResponse.json(
          { ok: false, error: `No exact playlist match for "${query}".${suffix}`.trim(), code: "spotify.not_found" },
          { status: 404 },
        )
      }
      const writeResult = writeSpotifyFavoritePlaylist(userId, resolved.match.uri, resolved.match.name || query)
      if (!writeResult.ok) {
        return NextResponse.json(
          { ok: false, error: writeResult.message, code: "spotify.internal" },
          { status: 500 },
        )
      }
      logSpotifyApi("playback.success", {
        userContextId: userId,
        action: "set_favorite_playlist",
        playlistUri: resolved.match.uri,
        playlistName: resolved.match.name || query,
      })
      return NextResponse.json({
        ok: true,
        action: "set_favorite_playlist",
        message: `Saved "${resolved.match.name || query}" as your favorite Spotify playlist.`,
        skipNowPlayingRefresh: true,
      })
    }

    if (payload.action === "clear_favorite_playlist") {
      const clearResult = clearSpotifyFavoritePlaylist(userId)
      if (!clearResult.ok) {
        return NextResponse.json(
          { ok: false, error: clearResult.message, code: "spotify.internal" },
          { status: 500 },
        )
      }
      logSpotifyApi("playback.success", {
        userContextId: userId,
        action: "clear_favorite_playlist",
      })
      return NextResponse.json({
        ok: true,
        action: "clear_favorite_playlist",
        message: clearResult.message,
        skipNowPlayingRefresh: true,
      })
    }

    if (payload.action === "add_to_playlist") {
      const prefs = readSpotifySkillPrefs(userId)
      const result = await controlSpotifyPlayback(
        "add_to_playlist",
        {
          query: payload.query || "",
          playlistUri: prefs.favoritePlaylistUri,
          playlistName: prefs.favoritePlaylistName,
        },
        scope,
      )
      logSpotifyApi("playback.success", {
        userContextId: userId,
        action: "add_to_playlist",
        playlistName: prefs.favoritePlaylistName,
      })
      return NextResponse.json(result)
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
        scope,
      )
    logSpotifyApi("playback.success", {
      userContextId: userId,
      action: payload.action,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SpotifyServiceError && error.code === "spotify.device_unavailable") {
      logSpotifyApi("playback.device_unavailable", { action: "general" })
      return deviceUnavailablePlaybackResponse({
        action: "general",
      })
    }
    return spotifyApiErrorResponse(error, "Failed to control Spotify playback.")
  }
}
