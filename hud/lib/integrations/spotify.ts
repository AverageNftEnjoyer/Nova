import "server-only"

export {
  buildSpotifyOAuthUrl,
  controlSpotifyPlayback,
  disconnectSpotify,
  exchangeCodeForSpotifyTokens,
  getSpotifyCurrentContext,
  getSpotifyNowPlaying,
  parseSpotifyOAuthState,
  probeSpotifyConnection,
} from "@/lib/integrations/spotify/service"

export type {
  SpotifyErrorCode,
  SpotifyNowPlaying,
  SpotifyPlaybackResult,
  SpotifyScope,
} from "@/lib/integrations/spotify/types"
