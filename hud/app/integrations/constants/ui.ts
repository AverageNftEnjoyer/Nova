// Floating lines configuration
export const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
export const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
export const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
export const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
export const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
export const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

// Gmail defaults
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

// Utility functions
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
