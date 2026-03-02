import { buildSpotifyOAuthUrl as buildOAuthUrl, parseSpotifyOAuthState as parseOAuthState } from "../auth/index"
import { assertSpotifyOk, readSpotifyErrorMessage, spotifyFetchWithRetry } from "../client/index"
import { spotifyError } from "../errors/index"
import {
  disconnectSpotify,
  exchangeCodeForSpotifyTokens,
  getSpotifyClientConfig,
  getSpotifyGrantedScopes,
  getValidSpotifyAccessToken,
} from "../tokens/index"
import {
  SPOTIFY_API_BASE,
  type SpotifyNowPlaying,
  type SpotifyPlaybackAction,
  type SpotifyPlaybackResult,
  type SpotifyRepeatMode,
  type SpotifyScope,
  type SpotifySearchType,
} from "../types/index"

type PlaybackAction = SpotifyPlaybackAction

async function ensureSpotifyScopeAny(
  scope: SpotifyScope | undefined,
  acceptedScopes: string[],
  operationLabel: string,
): Promise<void> {
  const granted = new Set(
    (await getSpotifyGrantedScopes(scope))
      .map((scopeText) => String(scopeText || "").trim().toLowerCase())
      .filter(Boolean),
  )
  const hasAny = acceptedScopes.some((required) => granted.has(String(required || "").trim().toLowerCase()))
  if (hasAny) return
  throw spotifyError(
    "spotify.forbidden",
    `Spotify permissions missing for ${operationLabel}. Reconnect Spotify to grant: ${acceptedScopes.join(", ")}.`,
    { status: 403 },
  )
}

function summarizeNowPlaying(nowPlaying: SpotifyNowPlaying): string {
  if (!nowPlaying.connected) return "Spotify is not connected."
  if (!nowPlaying.playing) return "Nothing is playing right now."
  const track = nowPlaying.trackName || "Unknown track"
  const artist = nowPlaying.artistName || "Unknown artist"
  const device = nowPlaying.deviceName ? ` on ${nowPlaying.deviceName}` : ""
  return `Now playing ${track} by ${artist}${device}.`
}

async function spotifyApiRequest(
  endpoint: string,
  init: RequestInit,
  operation: string,
  scope?: SpotifyScope,
): Promise<Response> {
  const token = await getValidSpotifyAccessToken(false, scope)
  const headers = new Headers(init.headers || {})
  headers.set("Authorization", `Bearer ${token}`)
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  let response = await spotifyFetchWithRetry(
    endpoint,
    {
      ...init,
      headers,
    },
    { operation, maxAttempts: 2, timeoutMs: 10_000 },
  )
  if (response.status === 401) {
    const refreshed = await getValidSpotifyAccessToken(true, scope)
    const retryHeaders = new Headers(init.headers || {})
    retryHeaders.set("Authorization", `Bearer ${refreshed}`)
    if (init.body && !retryHeaders.has("content-type")) retryHeaders.set("content-type", "application/json")
    response = await spotifyFetchWithRetry(
      endpoint,
      {
        ...init,
        headers: retryHeaders,
      },
      { operation: `${operation}_retry`, maxAttempts: 1, timeoutMs: 10_000 },
    )
  }
  return response
}

function toNowPlaying(data: unknown, connected = true): SpotifyNowPlaying {
  if (!data || typeof data !== "object") {
    return {
      connected,
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
    }
  }
  const payload = data as {
    is_playing?: boolean
    progress_ms?: number
    item?: {
      id?: string
      name?: string
      duration_ms?: number
      artists?: Array<{ name?: string }>
      album?: {
        name?: string
        images?: Array<{ url?: string }>
      }
    }
    device?: { id?: string; name?: string }
  }
  const firstArtist = Array.isArray(payload.item?.artists)
    ? payload.item?.artists.map((artist) => String(artist?.name || "").trim()).filter(Boolean)[0] || ""
    : ""
  const albumArtUrl = Array.isArray(payload.item?.album?.images)
    ? payload.item?.album?.images.map((image) => String(image?.url || "").trim()).filter(Boolean)[0] || ""
    : ""
  return {
    connected,
    playing: Boolean(payload.is_playing),
    progressMs: typeof payload.progress_ms === "number" ? Math.max(0, Math.floor(payload.progress_ms)) : 0,
    durationMs: typeof payload.item?.duration_ms === "number" ? Math.max(0, Math.floor(payload.item.duration_ms)) : 0,
    trackId: String(payload.item?.id || "").trim(),
    trackName: String(payload.item?.name || "").trim(),
    artistName: firstArtist,
    albumName: String(payload.item?.album?.name || "").trim(),
    albumArtUrl,
    deviceId: String(payload.device?.id || "").trim(),
    deviceName: String(payload.device?.name || "").trim(),
  }
}

async function throwPlaybackError(response: Response, fallback: string): Promise<never> {
  const message = await readSpotifyErrorMessage(response, fallback)
  const normalizedMessage = String(message || "").trim().toLowerCase()
  const deviceUnavailableLike = normalizedMessage.includes("no active device")
    || normalizedMessage.includes("no active spotify playback device")
    || normalizedMessage.includes("device not found")
    || (normalizedMessage.includes("restriction violated") && normalizedMessage.includes("device"))
  if (response.status === 404) {
    throw spotifyError("spotify.device_unavailable", "No active Spotify playback device is available.", { status: 409 })
  }
  if (response.status === 403 && deviceUnavailableLike) {
    throw spotifyError("spotify.device_unavailable", "No active Spotify playback device is available.", { status: 409 })
  }
  if (response.status === 403) {
    throw spotifyError("spotify.forbidden", message || "Spotify playback is not available for this account/device.", { status: 403 })
  }
  throw spotifyError("spotify.internal", message || fallback, { status: response.status || 500 })
}

async function searchSpotifyUri(query: string, searchType: SpotifySearchType = "track", scope?: SpotifyScope): Promise<string> {
  // genres aren't searchable as a type — use track search with the genre term as query
  const apiType = searchType === "genre" ? "track" : searchType
  const endpoint = `${SPOTIFY_API_BASE}/search?${new URLSearchParams({ type: apiType, limit: "1", q: query }).toString()}`
  const response = await spotifyApiRequest(endpoint, { method: "GET" }, `spotify_search_${apiType}`, scope)
  await assertSpotifyOk(response, "Spotify search failed.")
  const payload = await response.json().catch(() => null) as Record<string, { items?: Array<{ uri?: string; id?: string }> }> | null
  const key = `${apiType}s`
  const uri = String(payload?.[key]?.items?.[0]?.uri || "").trim()
  return uri
}

type UserPlaylistMatch = { uri: string; id: string; name: string }

function normalizePlaylistName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function scorePlaylistName(query: string, candidate: string): number {
  const q = normalizePlaylistName(query)
  const c = normalizePlaylistName(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  if (c.includes(q)) return 0.92
  if (q.includes(c)) return 0.82
  const qTokens = new Set(q.split(" ").filter(Boolean))
  const cTokens = new Set(c.split(" ").filter(Boolean))
  if (qTokens.size === 0 || cTokens.size === 0) return 0
  let overlap = 0
  for (const token of qTokens) {
    if (cTokens.has(token)) overlap += 1
  }
  const tokenScore = overlap / Math.max(qTokens.size, cTokens.size)
  return Math.max(0, Math.min(0.8, tokenScore))
}

async function listUserSpotifyPlaylists(scope?: SpotifyScope): Promise<UserPlaylistMatch[]> {
  const collected: UserPlaylistMatch[] = []
  const seen = new Set<string>()
  for (let page = 0; page < 3; page += 1) {
    const limit = 50
    const offset = page * limit
    const endpoint = `${SPOTIFY_API_BASE}/me/playlists?${new URLSearchParams({ limit: String(limit), offset: String(offset) }).toString()}`
    const response = await spotifyApiRequest(endpoint, { method: "GET" }, "spotify_user_playlists", scope)
    await assertSpotifyOk(response, "Spotify playlists read failed.")
    const payload = await response.json().catch(() => null) as {
      items?: Array<{ uri?: string; id?: string; name?: string }>
      next?: string | null
    } | null
    const items = Array.isArray(payload?.items) ? payload.items : []
    for (const item of items) {
      const uri = String(item?.uri || "").trim()
      const id = String(item?.id || "").trim()
      const name = String(item?.name || "").trim()
      if (!uri || !id || !name) continue
      if (seen.has(id)) continue
      seen.add(id)
      collected.push({ uri, id, name })
    }
    if (!payload?.next) break
  }
  return collected
}

export async function findSpotifyPlaylistByQuery(
  query: string,
  scope?: SpotifyScope,
): Promise<{ match: UserPlaylistMatch | null; suggestions: string[] }> {
  await ensureSpotifyScopeAny(scope, ["playlist-read-private", "playlist-read-collaborative"], "playlist lookup")
  const normalizedQuery = String(query || "").trim()
  if (!normalizedQuery) return { match: null, suggestions: [] }
  const playlists = await listUserSpotifyPlaylists(scope)
  if (playlists.length === 0) return { match: null, suggestions: [] }
  const scored = playlists
    .map((playlist) => ({
      playlist,
      score: scorePlaylistName(normalizedQuery, playlist.name),
    }))
    .sort((a, b) => b.score - a.score)
  const top = scored[0]
  const match = top && top.score >= 0.9 ? top.playlist : null
  const suggestions = scored
    .filter((entry) => entry.score >= 0.35)
    .slice(0, 3)
    .map((entry) => entry.playlist.name)
  return { match, suggestions }
}

function parseTrackAndArtistQuery(query: string): { track: string; artist: string } | null {
  const normalized = String(query || "").trim()
  if (!normalized) return null
  const match = normalized.match(/^(.+?)\s+\bby\b\s+(.+)$/i)
  if (!match) return null
  const track = String(match[1] || "").trim().replace(/^["']|["']$/g, "")
  const artist = String(match[2] || "").trim().replace(/^["']|["']$/g, "")
  if (!track || !artist) return null
  return { track, artist }
}

function buildStrictTrackArtistQueries(track: string, artist: string): string[] {
  const normalizedTrack = String(track || "").trim()
  const normalizedArtist = String(artist || "").trim()
  if (!normalizedTrack || !normalizedArtist) return []
  return [
    `track:${normalizedTrack} artist:${normalizedArtist}`,
    `track:"${normalizedTrack}" artist:"${normalizedArtist}"`,
  ]
}

function normalizeComparableMusicText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenizeComparableMusicText(value: string): string[] {
  return normalizeComparableMusicText(value).split(" ").filter((token) => token.length >= 2)
}

function hasAllNeedleTokens(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return false
  const normalizedHaystack = normalizeComparableMusicText(haystack)
  if (!normalizedHaystack) return false
  const haystackTokens = new Set(tokenizeComparableMusicText(normalizedHaystack))
  for (const token of needles) {
    if (!haystackTokens.has(token)) return false
  }
  return true
}

async function waitForStrictTrackArtistVerification(
  input: { track: string; artist: string },
  scope?: SpotifyScope,
): Promise<{ matched: boolean; nowPlaying: SpotifyNowPlaying }> {
  const requiredTrackTokens = tokenizeComparableMusicText(input.track)
  const requiredArtistTokens = tokenizeComparableMusicText(input.artist)
  let latest = await getSpotifyNowPlaying(scope)
  const matchesNowPlaying = (candidate: SpotifyNowPlaying): boolean => {
    const nowPlaying = candidate
    const trackMatches = hasAllNeedleTokens(nowPlaying.trackName, requiredTrackTokens)
    const artistMatches = hasAllNeedleTokens(nowPlaying.artistName, requiredArtistTokens)
    return trackMatches && artistMatches
  }
  if (matchesNowPlaying(latest)) return { matched: true, nowPlaying: latest }

  // Spotify player state can lag briefly after a successful play command.
  // Retry a few short polls to avoid false not_found responses.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 180))
    latest = await getSpotifyNowPlaying(scope)
    if (matchesNowPlaying(latest)) return { matched: true, nowPlaying: latest }
  }
  return { matched: false, nowPlaying: latest }
}

async function getSpotifyDevices(scope?: SpotifyScope): Promise<Array<{ id: string; name: string; type: string; is_active: boolean; volume_percent: number }>> {
  const response = await spotifyApiRequest(`${SPOTIFY_API_BASE}/me/player/devices`, { method: "GET" }, "spotify_devices", scope)
  if (!response.ok) return []
  const payload = await response.json().catch(() => null) as { devices?: Array<{ id?: string; name?: string; type?: string; is_active?: boolean; volume_percent?: number }> } | null
  return (payload?.devices || []).map((d) => ({
    id: String(d.id || "").trim(),
    name: String(d.name || "").trim(),
    type: String(d.type || "").trim(),
    is_active: Boolean(d.is_active),
    volume_percent: Number(d.volume_percent ?? 50),
  })).filter((d) => d.id)
}

function pickPreferredSpotifyDevice(
  devices: Array<{ id: string; name: string; type: string; is_active: boolean }>
): { id: string; name: string; type: string; is_active: boolean } | null {
  if (devices.length === 0) return null
  const active = devices.find((device) => device.is_active)
  if (active) return active
  const desktop = devices.find((device) => {
    const type = device.type.toLowerCase()
    const name = device.name.toLowerCase()
    return type === "computer" || name.includes("desktop") || name.includes("pc") || name.includes("mac")
  })
  if (desktop) return desktop
  return devices[0]
}

async function activateSpotifyDevice(scope?: SpotifyScope): Promise<boolean> {
  const devices = await getSpotifyDevices(scope)
  const target = pickPreferredSpotifyDevice(devices)
  if (!target) return false
  const transferRes = await spotifyApiRequest(
    `${SPOTIFY_API_BASE}/me/player`,
    { method: "PUT", body: JSON.stringify({ device_ids: [target.id], play: false }) },
    "spotify_transfer_auto_activate",
    scope,
  )
  return transferRes.status === 204 || transferRes.status === 202 || transferRes.ok
}

async function pickLikedTrackUri(scope?: SpotifyScope): Promise<string> {
  // First fetch total count, then pick a random offset across the full library
  const countRes = await spotifyApiRequest(
    `${SPOTIFY_API_BASE}/me/tracks?${new URLSearchParams({ limit: "1", offset: "0" }).toString()}`,
    { method: "GET" },
    "spotify_liked_count",
    scope,
  )
  await assertSpotifyOk(countRes, "Failed to read Spotify liked songs.")
  const countPayload = await countRes.json().catch(() => null) as { total?: number } | null
  const total = Math.max(1, Number(countPayload?.total || 50))
  // Pick a random offset, leaving room for limit=1
  const offset = Math.floor(Math.random() * Math.min(total, 2000))
  const endpoint = `${SPOTIFY_API_BASE}/me/tracks?${new URLSearchParams({ limit: "1", offset: String(offset) }).toString()}`
  const response = await spotifyApiRequest(endpoint, { method: "GET" }, "spotify_liked_tracks", scope)
  await assertSpotifyOk(response, "Failed to read Spotify liked songs.")
  const payload = await response.json().catch(() => null) as {
    items?: Array<{ track?: { uri?: string } }>
  } | null
  const uri = String(payload?.items?.[0]?.track?.uri || "").trim()
  return uri
}

const PLAY_CONTINUATION_QUEUE_TARGET = Math.max(
  2,
  Math.min(12, Number.parseInt(process.env.NOVA_SPOTIFY_CONTINUATION_QUEUE_TARGET || "8", 10) || 8),
)

function extractTrackIdFromUri(uri: string): string {
  const normalized = String(uri || "").trim()
  if (!normalized) return ""
  if (normalized.startsWith("spotify:track:")) {
    return normalized.replace("spotify:track:", "").trim()
  }
  return ""
}

async function fetchRecommendationUrisFromSeedTrack(seedTrackId: string, scope?: SpotifyScope): Promise<string[]> {
  const normalizedSeed = String(seedTrackId || "").trim()
  if (!normalizedSeed) return []
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(20, PLAY_CONTINUATION_QUEUE_TARGET))),
    seed_tracks: normalizedSeed,
  })
  const response = await spotifyApiRequest(
    `${SPOTIFY_API_BASE}/recommendations?${params.toString()}`,
    { method: "GET" },
    "spotify_continuation_recommendations",
    scope,
  )
  if (!response.ok) return []
  const payload = await response.json().catch(() => null) as {
    tracks?: Array<{ uri?: string }>
  } | null
  const uris = Array.isArray(payload?.tracks)
    ? payload.tracks.map((track) => String(track?.uri || "").trim()).filter(Boolean)
    : []
  return uris
}

async function enqueueTrackUri(uri: string, scope?: SpotifyScope): Promise<boolean> {
  const normalized = String(uri || "").trim()
  if (!normalized) return false
  const endpoint = `${SPOTIFY_API_BASE}/me/player/queue?uri=${encodeURIComponent(normalized)}`
  const response = await spotifyApiRequest(endpoint, { method: "POST" }, "spotify_continuation_queue", scope)
  if (response.status === 204 || response.status === 202 || response.status === 200 || response.ok) return true
  if (response.status !== 404 && response.status !== 403) return false
  const activated = await activateSpotifyDevice(scope).catch(() => false)
  if (!activated) return false
  await new Promise((resolve) => setTimeout(resolve, 350))
  const retry = await spotifyApiRequest(endpoint, { method: "POST" }, "spotify_continuation_queue_retry_after_activate", scope)
  return retry.status === 204 || retry.status === 202 || retry.status === 200 || retry.ok
}

async function primeContinuationQueueFromTrackUri(trackUri: string, scope?: SpotifyScope): Promise<number> {
  const seedTrackId = extractTrackIdFromUri(trackUri)
  if (!seedTrackId) return 0
  try {
    // Allow playback to settle before queueing follow-up tracks.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const recommendationUris = await fetchRecommendationUrisFromSeedTrack(seedTrackId, scope)
    if (recommendationUris.length === 0) return 0
    let queued = 0
    for (const uri of recommendationUris) {
      if (uri === trackUri) continue
      const ok = await enqueueTrackUri(uri, scope).catch(() => false)
      if (!ok) continue
      queued += 1
      if (queued >= PLAY_CONTINUATION_QUEUE_TARGET) break
    }
    return queued
  } catch {
    return 0
  }
}

async function sendPlayerCommand(
  action: "play" | "pause" | "next" | "previous",
  payload: Record<string, unknown> | null,
  scope?: SpotifyScope,
): Promise<void> {
  const method = action === "next" || action === "previous" ? "POST" : "PUT"
  const endpoint = action === "play"
    ? `${SPOTIFY_API_BASE}/me/player/play`
    : action === "pause"
      ? `${SPOTIFY_API_BASE}/me/player/pause`
      : action === "next"
        ? `${SPOTIFY_API_BASE}/me/player/next`
        : `${SPOTIFY_API_BASE}/me/player/previous`
  const response = await spotifyApiRequest(
    endpoint,
    {
      method,
      body: payload ? JSON.stringify(payload) : undefined,
    },
    `spotify_player_${action}`,
    scope,
  )
  if (response.status === 204 || response.status === 202 || response.ok) return

  // Spotify may report "no active device" even when desktop app is open but idle.
  // For play-like actions, auto-activate an available device once and retry.
  if (action === "play" && (response.status === 404 || response.status === 403)) {
    const activated = await activateSpotifyDevice(scope)
    if (activated) {
      await new Promise((resolve) => setTimeout(resolve, 350))
      const retry = await spotifyApiRequest(
        endpoint,
        {
          method,
          body: payload ? JSON.stringify(payload) : undefined,
        },
        `spotify_player_${action}_retry_after_activate`,
        scope,
      )
      if (retry.status === 204 || retry.status === 202 || retry.ok) return
      await throwPlaybackError(retry, `Spotify ${action} request failed.`)
    }
  }

  await throwPlaybackError(response, `Spotify ${action} request failed.`)
}

export async function buildSpotifyOAuthUrl(returnTo: string, scope?: SpotifyScope): Promise<string> {
  const config = await getSpotifyClientConfig(scope)
  const userId = String(scope?.userId || scope?.user?.id || "").trim()
  return buildOAuthUrl({ returnTo, userId, config })
}

export const parseSpotifyOAuthState = parseOAuthState

export { exchangeCodeForSpotifyTokens, disconnectSpotify }

export async function getSpotifyCurrentContext(scope?: SpotifyScope): Promise<{
  playing: boolean
  contextUri: string
  contextType: string
  contextName: string
}> {
  const response = await spotifyApiRequest(
    `${SPOTIFY_API_BASE}/me/player`,
    { method: "GET" },
    "spotify_player_state",
    scope,
  )
  if (!response.ok || response.status === 204) {
    return { playing: false, contextUri: "", contextType: "", contextName: "" }
  }
  const payload = await response.json().catch(() => null) as {
    is_playing?: boolean
    context?: { uri?: string; type?: string }
    item?: { album?: { name?: string } }
  } | null
  const contextUri = String(payload?.context?.uri || "").trim()
  const contextType = String(payload?.context?.type || "").trim()
  const playing = Boolean(payload?.is_playing)

  let contextName = ""
  // Resolve playlist name if context is a playlist
  if (contextType === "playlist" && contextUri) {
    try {
      const playlistId = contextUri.replace("spotify:playlist:", "")
      const plRes = await spotifyApiRequest(
        `${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=name`,
        { method: "GET" },
        "spotify_playlist_name",
        scope,
      )
      if (plRes.ok) {
        const plData = await plRes.json().catch(() => null) as { name?: string } | null
        contextName = String(plData?.name || "").trim()
      }
    } catch {}
  } else if (contextType === "album" && payload?.item?.album?.name) {
    contextName = String(payload.item.album.name).trim()
  }

  return { playing, contextUri, contextType, contextName }
}

export async function getSpotifyNowPlaying(scope?: SpotifyScope): Promise<SpotifyNowPlaying> {
  const response = await spotifyApiRequest(
    `${SPOTIFY_API_BASE}/me/player/currently-playing?additional_types=track`,
    { method: "GET" },
    "spotify_now_playing",
    scope,
  )
  if (response.status === 204 || response.status === 404) {
    return toNowPlaying(null, true)
  }
  await assertSpotifyOk(response, "Failed to fetch Spotify now playing.")
  const payload = await response.json().catch(() => null)
  return toNowPlaying(payload, true)
}

export async function probeSpotifyConnection(scope?: SpotifyScope): Promise<{
  connected: boolean
  displayName: string
  spotifyUserId: string
  deviceCount: number
  nowPlaying: SpotifyNowPlaying
}> {
  const profileRes = await spotifyApiRequest(`${SPOTIFY_API_BASE}/me`, { method: "GET" }, "spotify_probe_profile", scope)
  await assertSpotifyOk(profileRes, "Spotify profile probe failed.")
  const profile = await profileRes.json().catch(() => null) as { id?: string; display_name?: string } | null

  const devicesRes = await spotifyApiRequest(`${SPOTIFY_API_BASE}/me/player/devices`, { method: "GET" }, "spotify_probe_devices", scope)
  const devicesPayload = devicesRes.ok
    ? await devicesRes.json().catch(() => null) as { devices?: Array<{ id?: string }> } | null
    : null
  const deviceCount = Array.isArray(devicesPayload?.devices) ? devicesPayload!.devices.length : 0
  const nowPlaying = await getSpotifyNowPlaying(scope)

  return {
    connected: true,
    displayName: String(profile?.display_name || "").trim(),
    spotifyUserId: String(profile?.id || "").trim(),
    deviceCount,
    nowPlaying,
  }
}

export async function controlSpotifyPlayback(
  action: PlaybackAction,
  options?: {
    query?: string
    type?: SpotifySearchType
    positionMs?: number
    volumePercent?: number
    shuffleOn?: boolean
    repeatMode?: SpotifyRepeatMode
    deviceId?: string
    deviceName?: string
    /** Pre-resolved favorite playlist URI for play_smart */
    playlistUri?: string
    /** Display name for the saved playlist (used in confirmation) */
    playlistName?: string
  },
  scope?: SpotifyScope,
): Promise<SpotifyPlaybackResult> {
  if (action === "seek") {
    const positionMs = Math.max(0, Math.floor(Number(options?.positionMs ?? 0)))
    const endpoint = `${SPOTIFY_API_BASE}/me/player/seek?position_ms=${positionMs}`
    const response = await spotifyApiRequest(endpoint, { method: "PUT" }, "spotify_seek", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: "Seeked.", skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify seek failed.")
  }

  if (action === "restart") {
    const endpoint = `${SPOTIFY_API_BASE}/me/player/seek?position_ms=0`
    const response = await spotifyApiRequest(endpoint, { method: "PUT" }, "spotify_restart", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: "Restarted track from the beginning.", skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify restart failed.")
  }

  if (action === "volume") {
    const vol = Math.max(0, Math.min(100, Math.round(Number(options?.volumePercent ?? 50))))
    const endpoint = `${SPOTIFY_API_BASE}/me/player/volume?volume_percent=${vol}`
    const response = await spotifyApiRequest(endpoint, { method: "PUT" }, "spotify_volume", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: `Volume set to ${vol}%.`, skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify volume change failed.")
  }

  if (action === "shuffle") {
    const state = options?.shuffleOn !== false
    const endpoint = `${SPOTIFY_API_BASE}/me/player/shuffle?state=${state}`
    const response = await spotifyApiRequest(endpoint, { method: "PUT" }, "spotify_shuffle", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: state ? "Shuffle on." : "Shuffle off.", skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify shuffle change failed.")
  }

  if (action === "repeat") {
    const mode: SpotifyRepeatMode = options?.repeatMode ?? "off"
    const endpoint = `${SPOTIFY_API_BASE}/me/player/repeat?state=${mode}`
    const response = await spotifyApiRequest(endpoint, { method: "PUT" }, "spotify_repeat", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      const label = mode === "track" ? "Repeat track on." : mode === "context" ? "Repeat playlist on." : "Repeat off."
      return { ok: true, action, message: label, skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify repeat change failed.")
  }

  if (action === "queue") {
    const query = String(options?.query || "").trim()
    if (!query) throw spotifyError("spotify.invalid_request", "Provide a track name to queue.", { status: 400 })
    const uri = await searchSpotifyUri(query, options?.type ?? "track", scope)
    if (!uri) throw spotifyError("spotify.not_found", `No Spotify results found for "${query}".`, { status: 404 })
    const endpoint = `${SPOTIFY_API_BASE}/me/player/queue?uri=${encodeURIComponent(uri)}`
    const response = await spotifyApiRequest(endpoint, { method: "POST" }, "spotify_queue", scope)
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: `Added "${query}" to your queue.`, skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify queue failed.")
  }

  if (action === "like" || action === "unlike") {
    const nowPlaying = await getSpotifyNowPlaying(scope)
    const trackId = nowPlaying.trackId
    if (!trackId) throw spotifyError("spotify.not_found", "No track is currently playing to like.", { status: 404 })
    const method = action === "like" ? "PUT" : "DELETE"
    const endpoint = `${SPOTIFY_API_BASE}/me/tracks?ids=${trackId}`
    const response = await spotifyApiRequest(endpoint, { method }, "spotify_like", scope)
    if (response.status === 200 || response.status === 204 || response.ok) {
      const label = action === "like" ? `Liked "${nowPlaying.trackName}".` : `Removed "${nowPlaying.trackName}" from liked songs.`
      return { ok: true, action, message: label, skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify like/unlike failed.")
  }

  if (action === "list_devices") {
    const devices = await getSpotifyDevices(scope)
    if (devices.length === 0) return { ok: true, action, message: "No active Spotify devices found.", data: [] }
    const list = devices.map((d) => `${d.name} (${d.type})${d.is_active ? " — active" : ""}`).join(", ")
    return { ok: true, action, message: `Available devices: ${list}.`, data: devices }
  }

  if (action === "transfer") {
    const devices = await getSpotifyDevices(scope)
    const targetName = String(options?.deviceName || options?.deviceId || "").trim().toLowerCase()
    const match = targetName
      ? devices.find((d) => d.name.toLowerCase().includes(targetName) || d.id === targetName)
      : devices.find((d) => !d.is_active) || devices[0]
    if (!match) {
      const names = devices.map((d) => d.name).join(", ") || "none found"
      throw spotifyError("spotify.not_found", `Device not found. Available: ${names}.`, { status: 404 })
    }
    const response = await spotifyApiRequest(
      `${SPOTIFY_API_BASE}/me/player`,
      { method: "PUT", body: JSON.stringify({ device_ids: [match.id], play: true }) },
      "spotify_transfer",
      scope,
    )
    if (response.status === 204 || response.status === 202 || response.ok) {
      return { ok: true, action, message: `Transferred playback to ${match.name}.`, skipNowPlayingRefresh: true }
    }
    await throwPlaybackError(response, "Spotify device transfer failed.")
  }

  if (action === "play_recommended") {
    const nowPlaying = await getSpotifyNowPlaying(scope)
    const seedTrack = nowPlaying.trackId
    const query = String(options?.query || "").trim()
    let seedTrackId = seedTrack
    if (!seedTrackId && query) {
      const uri = await searchSpotifyUri(query, "track", scope)
      seedTrackId = uri.replace("spotify:track:", "")
    }
    // No seed track and no query — can't recommend, fall back to liked songs
    if (!seedTrackId) {
      const likedUri = await pickLikedTrackUri(scope)
      if (likedUri) {
        await sendPlayerCommand("play", { uris: [likedUri] }, scope)
        void primeContinuationQueueFromTrackUri(likedUri, scope)
        return { ok: true, action, message: "Playing a song from your liked tracks.", skipNowPlayingRefresh: true }
      }
      throw spotifyError("spotify.not_found", "No liked songs found and nothing is playing to base recommendations on.", { status: 404 })
    }
    const recoParams = new URLSearchParams({ limit: "1", seed_tracks: seedTrackId })
    const recoRes = await spotifyApiRequest(`${SPOTIFY_API_BASE}/recommendations?${recoParams}`, { method: "GET" }, "spotify_recommendations", scope)
    await assertSpotifyOk(recoRes, "Spotify recommendations failed.")
    const recoPayload = await recoRes.json().catch(() => null) as { tracks?: Array<{ uri?: string; name?: string; artists?: Array<{ name?: string }> }> } | null
    const recoTrack = recoPayload?.tracks?.[0]
    const recoUri = String(recoTrack?.uri || "").trim()
    if (!recoUri) throw spotifyError("spotify.not_found", "Couldn't find a recommendation right now.", { status: 404 })
    await sendPlayerCommand("play", { uris: [recoUri] }, scope)
    void primeContinuationQueueFromTrackUri(recoUri, scope)
    const trackName = String(recoTrack?.name || "").trim()
    const artistName = String(recoTrack?.artists?.[0]?.name || "").trim()
    return {
      ok: true,
      action,
      message: trackName ? `Playing "${trackName}"${artistName ? ` by ${artistName}` : ""}.` : "Playing a recommended track.",
      skipNowPlayingRefresh: true,
    }
  }

  if (action === "play_smart") {
    // If a favorite playlist URI was pre-resolved, play it. Otherwise fall back to liked songs.
    const favUri = String(options?.playlistUri || "").trim()
    if (favUri) {
      await sendPlayerCommand("play", { context_uri: favUri }, scope)
      const label = String(options?.playlistName || "your favorite playlist").trim()
      return { ok: true, action, message: `Playing ${label}.`, skipNowPlayingRefresh: true }
    }
    // No favorite saved — fall back to a random liked song
    const likedUri = await pickLikedTrackUri(scope)
    if (!likedUri) {
      throw spotifyError("spotify.not_found", "No liked songs found. Save a favorite playlist first or add songs to your Liked Songs.", { status: 404 })
    }
    await sendPlayerCommand("play", { uris: [likedUri] }, scope)
    void primeContinuationQueueFromTrackUri(likedUri, scope)
    return { ok: true, action, message: "Playing a liked song.", skipNowPlayingRefresh: true }
  }

  if (action === "save_playlist") {
    // The caller (route.ts) writes the skill file and passes back the confirmed name.
    // Here we just confirm the save was requested (route handles file I/O via skill-prefs).
    const label = String(options?.playlistName || options?.playlistUri || "").trim()
    if (!label) {
      throw spotifyError("spotify.invalid_request", "No playlist is currently playing to save as favorite.", { status: 400 })
    }
    return {
      ok: true,
      action,
      message: `"${label}" saved as your favorite Spotify playlist. The play button will use it next time.`,
      skipNowPlayingRefresh: true,
    }
  }

  if (action === "add_to_playlist") {
    await ensureSpotifyScopeAny(scope, ["playlist-modify-private", "playlist-modify-public"], "playlist updates")
    const nowPlaying = await getSpotifyNowPlaying(scope)
    const trackId = String(nowPlaying.trackId || "").trim()
    if (!trackId) {
      throw spotifyError("spotify.not_found", "No track is currently playing to add.", { status: 404 })
    }

    let playlistUri = String(options?.playlistUri || "").trim()
    let playlistName = String(options?.playlistName || "").trim()
    const playlistQuery = String(options?.query || "").trim()
    if (!playlistUri && playlistQuery) {
      const resolved = await findSpotifyPlaylistByQuery(playlistQuery, scope)
      if (!resolved.match) {
        const suffix = resolved.suggestions.length > 0
          ? ` Did you mean: ${resolved.suggestions.join(", ")}?`
          : ""
        throw spotifyError("spotify.not_found", `No exact playlist match for "${playlistQuery}".${suffix}`.trim(), { status: 404 })
      }
      playlistUri = resolved.match.uri
      playlistName = resolved.match.name
    }
    if (!playlistUri) {
      throw spotifyError("spotify.not_found", "No playlist selected. Tell me which playlist to use first.", { status: 404 })
    }

    const playlistId = playlistUri.replace("spotify:playlist:", "").trim()
    if (!playlistId) {
      throw spotifyError("spotify.invalid_request", "Invalid playlist URI.", { status: 400 })
    }
    const endpoint = `${SPOTIFY_API_BASE}/playlists/${playlistId}/tracks`
    const trackUri = `spotify:track:${trackId}`
    const response = await spotifyApiRequest(
      endpoint,
      { method: "POST", body: JSON.stringify({ uris: [trackUri] }) },
      "spotify_add_to_playlist",
      scope,
    )
    if (response.status === 201 || response.status === 200 || response.status === 204 || response.ok) {
      const trackLabel = nowPlaying.trackName || "Current track"
      const playlistLabel = playlistName || "your playlist"
      return {
        ok: true,
        action,
        message: `Added "${trackLabel}" to ${playlistLabel}.`,
        skipNowPlayingRefresh: true,
      }
    }
    await throwPlaybackError(response, "Failed to add the track to playlist.")
  }

  if (action === "open") {
    return {
      ok: true,
      action,
      message: "Opening Spotify desktop app.",
      fallbackRecommended: true,
    }
  }

  if (action === "now_playing") {
    const nowPlaying = await getSpotifyNowPlaying(scope)
    return {
      ok: true,
      action,
      message: summarizeNowPlaying(nowPlaying),
      nowPlaying,
      fallbackRecommended: !nowPlaying.playing,
    }
  }

  if (action === "pause" || action === "next" || action === "previous") {
    // Fire and return — don't wait for a now-playing fetch, saves ~300ms.
    // UI applies optimistic state immediately; the polling interval will sync truth.
    await sendPlayerCommand(action, null, scope)
    return {
      ok: true,
      action,
      message: action === "pause"
        ? "Paused Spotify playback."
        : action === "next"
          ? "Skipped to the next track."
          : "Went back to the previous track.",
      skipNowPlayingRefresh: true,
    }
  }

  if (action === "play_liked") {
    const uri = await pickLikedTrackUri(scope)
    if (!uri) {
      throw spotifyError("spotify.not_found", "No tracks found in your Spotify liked songs.", { status: 404 })
    }
    // Fire play and return without waiting for now-playing confirmation (~300ms saved).
    // UI will pick up the new track on its next poll cycle (8s when playing).
    await sendPlayerCommand("play", { uris: [uri] }, scope)
    void primeContinuationQueueFromTrackUri(uri, scope)
    return {
      ok: true,
      action,
      message: "Playing a liked song.",
      skipNowPlayingRefresh: true,
    }
  }

  const query = String(options?.query || "").trim()
  if (!query) {
    // Resume playback — fire and return, same as pause/next/previous for consistency.
    // No need to wait for now_playing confirmation.
    await sendPlayerCommand("play", {}, scope)
    return {
      ok: true,
      action: "play",
      message: "Resumed Spotify playback.",
      skipNowPlayingRefresh: true,
    }
  }

  const searchType = options?.type ?? "track"
  const strictTrackArtist = searchType === "track" ? parseTrackAndArtistQuery(query) : null
  let uri = ""
  if (searchType === "track") {
    if (strictTrackArtist) {
      const strictQueries = buildStrictTrackArtistQueries(strictTrackArtist.track, strictTrackArtist.artist)
      for (const strictQuery of strictQueries) {
        uri = await searchSpotifyUri(strictQuery, "track", scope)
        if (uri) break
      }
    }
  }
  if (!uri) {
    uri = await searchSpotifyUri(query, searchType, scope)
  }
  if (!uri) {
    throw spotifyError("spotify.not_found", `No Spotify results found for "${query}".`, { status: 404 })
  }
  // Albums and playlists use context_uri; tracks use uris array
  const playBody = (searchType === "album" || searchType === "playlist" || searchType === "artist")
    ? { context_uri: uri }
    : { uris: [uri] }
  await sendPlayerCommand("play", playBody, scope)
  if (searchType !== "album" && searchType !== "playlist" && searchType !== "artist") {
    void primeContinuationQueueFromTrackUri(uri, scope)
  }
  let nowPlaying = await getSpotifyNowPlaying(scope)
  if (strictTrackArtist) {
    const verification = await waitForStrictTrackArtistVerification(strictTrackArtist, scope)
    nowPlaying = verification.nowPlaying
    if (!verification.matched) {
      throw spotifyError(
        "spotify.not_found",
        `Could not verify exact match for "${strictTrackArtist.track}" by "${strictTrackArtist.artist}".`,
        { status: 404 },
      )
    }
  }
  return {
    ok: true,
    action: "play",
    message: summarizeNowPlaying(nowPlaying),
    nowPlaying,
  }
}
