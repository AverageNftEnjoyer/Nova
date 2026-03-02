import type { SpotifyIntegrationConfig } from "../../store/server-store"

export interface RuntimeSafeSpotifySnapshot {
  connected: boolean
  spotifyUserId: string
  displayName: string
  scopes: string[]
}

export function buildRuntimeSafeSpotifySnapshot(spotify: SpotifyIntegrationConfig): RuntimeSafeSpotifySnapshot {
  return {
    connected: Boolean(spotify.connected),
    spotifyUserId: String(spotify.spotifyUserId || "").trim(),
    displayName: String(spotify.displayName || "").trim(),
    scopes: Array.isArray(spotify.scopes)
      ? spotify.scopes.map((scope) => String(scope).trim()).filter(Boolean)
      : [],
  }
}
