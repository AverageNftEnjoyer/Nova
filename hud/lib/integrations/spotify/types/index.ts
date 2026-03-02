import type { IntegrationsStoreScope } from "../../store/server-store"

export type SpotifyErrorCode =
  | "spotify.invalid_request"
  | "spotify.invalid_state"
  | "spotify.unauthorized"
  | "spotify.forbidden"
  | "spotify.not_found"
  | "spotify.not_connected"
  | "spotify.device_unavailable"
  | "spotify.rate_limited"
  | "spotify.token_missing"
  | "spotify.timeout"
  | "spotify.cancelled"
  | "spotify.network"
  | "spotify.transient"
  | "spotify.internal"

export type SpotifyScope = IntegrationsStoreScope

export interface SpotifyClientConfig {
  clientId: string
  redirectUri: string
  appUrl: string
}

export interface SpotifyOAuthStatePayload {
  ts: number
  nonce: string
  userId: string
  returnTo: string
  codeVerifier: string
}

export interface SpotifyTokenRefreshResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: string[]
}

export interface SpotifyNowPlaying {
  connected: boolean
  playing: boolean
  progressMs: number
  durationMs: number
  trackId: string
  trackName: string
  artistName: string
  albumName: string
  albumArtUrl: string
  deviceId: string
  deviceName: string
}

export type SpotifyPlaybackAction =
  | "open" | "play" | "pause" | "next" | "previous"
  | "now_playing" | "play_liked" | "play_smart" | "seek" | "restart"
  | "volume" | "shuffle" | "repeat"
  | "queue" | "like" | "unlike"
  | "list_devices" | "transfer"
  | "play_recommended" | "save_playlist" | "set_favorite_playlist" | "clear_favorite_playlist" | "add_to_playlist"

export type SpotifySearchType = "track" | "artist" | "album" | "playlist" | "genre"
export type SpotifyRepeatMode = "off" | "track" | "context"

export interface SpotifyPlaybackResult {
  ok: boolean
  action: SpotifyPlaybackAction
  message: string
  nowPlaying?: SpotifyNowPlaying
  fallbackRecommended?: boolean
  /** When true the UI should not fire a follow-up now-playing fetch; polling will sync state. */
  skipNowPlayingRefresh?: boolean
  data?: unknown
}

export const DEFAULT_SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
]

export const SPOTIFY_AUTH_BASE = "https://accounts.spotify.com/authorize"
export const SPOTIFY_TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token"
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1"
