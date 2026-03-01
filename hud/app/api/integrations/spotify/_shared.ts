import { NextResponse } from "next/server"
import { z } from "zod"

import type { SpotifyNowPlaying } from "@/lib/integrations/spotify/types"
import { toApiErrorBody, toSpotifyServiceError } from "@/lib/integrations/spotify/errors"

// ─── Server-side now-playing cache ───────────────────────────────────────────
// Shared across now-playing GET and playback POST so the playback route can
// invalidate the cache immediately after any command, ensuring the very next
// poll always fetches fresh state from Spotify's API.
export type NowPlayingCacheEntry = { data: SpotifyNowPlaying; cachedAt: number }
export const nowPlayingCacheByUser = new Map<string, NowPlayingCacheEntry>()

const NOW_PLAYING_CACHE_MAX_USERS = 200
const NOW_PLAYING_CACHE_STALE_MS = 60_000

/** Evict users whose cache entry is older than STALE_MS when the Map grows beyond MAX_USERS. */
export function evictStaleNowPlayingCache(now: number): void {
  if (nowPlayingCacheByUser.size <= NOW_PLAYING_CACHE_MAX_USERS) return
  for (const [key, entry] of nowPlayingCacheByUser.entries()) {
    if (now - entry.cachedAt > NOW_PLAYING_CACHE_STALE_MS) nowPlayingCacheByUser.delete(key)
  }
}

export const connectQuerySchema = z.object({
  returnTo: z.string().trim().default("/integrations"),
  mode: z.enum(["json"]).optional(),
})

export const disconnectBodySchema = z.object({})

export const playbackBodySchema = z.object({
  action: z.enum([
    "open", "play", "pause", "next", "previous",
    "now_playing", "play_liked", "play_smart", "seek", "restart",
    "volume", "shuffle", "repeat",
    "queue", "like", "unlike",
    "list_devices", "transfer",
    "play_recommended", "save_playlist", "set_favorite_playlist", "clear_favorite_playlist", "add_to_playlist",
  ]),
  query: z.string().trim().optional(),
  type: z.enum(["track", "artist", "album", "playlist", "genre"]).optional(),
  positionMs: z.number().int().min(0).optional(),
  volumePercent: z.number().int().min(0).max(100).optional(),
  shuffleOn: z.boolean().optional(),
  repeatMode: z.enum(["off", "track", "context"]).optional(),
  deviceId: z.string().trim().optional(),
  deviceName: z.string().trim().optional(),
  userContextId: z.string().trim().toLowerCase().optional(),
  playlistUri: z.string().trim().optional(),
  playlistName: z.string().trim().optional(),
})

export async function safeJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}))
}

export function logSpotifyApi(event: string, payload: Record<string, unknown>): void {
  console.info("[SpotifyAPI]", {
    event,
    ts: new Date().toISOString(),
    ...payload,
  })
}

export function spotifyApiErrorResponse(
  error: unknown,
  fallback: string,
): NextResponse {
  const normalized = toSpotifyServiceError(error, fallback)
  logSpotifyApi("error", {
    code: normalized.code,
    status: normalized.status,
    retryable: normalized.retryable,
    message: normalized.message,
  })
  return NextResponse.json(toApiErrorBody(normalized, fallback), {
    status: normalized.status || 500,
  })
}
