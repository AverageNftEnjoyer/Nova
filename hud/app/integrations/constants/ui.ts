// OAuth callback defaults
const GMAIL_CALLBACK_PATH = "/api/integrations/gmail/callback"
const SPOTIFY_CALLBACK_PATH = "/api/integrations/spotify/callback"
const YOUTUBE_CALLBACK_PATH = "/api/integrations/youtube/callback"
const defaultOrigin =
  typeof window !== "undefined" && typeof window.location?.origin === "string" && window.location.origin
    ? window.location.origin
    : "http://localhost:3000"
export const GMAIL_DEFAULT_REDIRECT_URI = `${defaultOrigin}${GMAIL_CALLBACK_PATH}`
export const SPOTIFY_DEFAULT_REDIRECT_URI = `${defaultOrigin}${SPOTIFY_CALLBACK_PATH}`
export const YOUTUBE_DEFAULT_REDIRECT_URI =
  `${defaultOrigin}${YOUTUBE_CALLBACK_PATH}`
