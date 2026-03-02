import "server-only"

export {
  buildSpotifyOAuthUrl,
  controlSpotifyPlayback,
  disconnectSpotify,
  exchangeCodeForSpotifyTokens,
  findSpotifyPlaylistByQuery,
  getSpotifyCurrentContext,
  getSpotifyNowPlaying,
  parseSpotifyOAuthState,
  probeSpotifyConnection,
} from "@/lib/integrations/spotify/service/index"

export type {
  SpotifyErrorCode,
  SpotifyNowPlaying,
  SpotifyPlaybackResult,
  SpotifyScope,
} from "@/lib/integrations/spotify/types/index"
