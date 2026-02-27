import { buildSpotifyOAuthUrl as buildOAuthUrl, parseSpotifyOAuthState as parseOAuthState } from "./auth"
import { assertSpotifyOk, readSpotifyErrorMessage, spotifyFetchWithRetry } from "./client"
import { spotifyError } from "./errors"
import { disconnectSpotify, exchangeCodeForSpotifyTokens, getSpotifyClientConfig, getValidSpotifyAccessToken } from "./tokens"
import {
  SPOTIFY_API_BASE,
  type SpotifyNowPlaying,
  type SpotifyPlaybackAction,
  type SpotifyPlaybackResult,
  type SpotifyRepeatMode,
  type SpotifyScope,
  type SpotifySearchType,
} from "./types"

type PlaybackAction = SpotifyPlaybackAction

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
  if (response.status === 404) {
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
  if (action === "play" && response.status === 404) {
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
  const uri = await searchSpotifyUri(query, searchType, scope)
  if (!uri) {
    throw spotifyError("spotify.not_found", `No Spotify results found for "${query}".`, { status: 404 })
  }
  // Albums and playlists use context_uri; tracks use uris array
  const playBody = (searchType === "album" || searchType === "playlist" || searchType === "artist")
    ? { context_uri: uri }
    : { uris: [uri] }
  await sendPlayerCommand("play", playBody, scope)
  const nowPlaying = await getSpotifyNowPlaying(scope)
  return {
    ok: true,
    action: "play",
    message: summarizeNowPlaying(nowPlaying),
    nowPlaying,
  }
}
