import { kvDelete, kvGet, kvSet } from "../../../../../src/db/index.js"

const NAMESPACE = "skill-preferences"
const KEY = "spotify"

function normalizeUserId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export interface SpotifySkillPrefs {
  favoritePlaylistUri: string
  favoritePlaylistName: string
}

export function readSpotifySkillPrefs(userId: string): SpotifySkillPrefs {
  const uid = normalizeUserId(userId)
  if (!uid) return { favoritePlaylistUri: "", favoritePlaylistName: "" }
  const stored = kvGet(uid, NAMESPACE, KEY) as Partial<SpotifySkillPrefs> | null
  return {
    favoritePlaylistUri: String(stored?.favoritePlaylistUri || ""),
    favoritePlaylistName: String(stored?.favoritePlaylistName || ""),
  }
}

export function writeSpotifyFavoritePlaylist(
  userId: string,
  playlistUri: string,
  playlistName: string,
): { ok: boolean; message: string } {
  const uid = normalizeUserId(userId)
  if (!uid) return { ok: false, message: "Invalid user context." }
  kvSet(uid, NAMESPACE, KEY, {
    favoritePlaylistUri: String(playlistUri || "").trim(),
    favoritePlaylistName: String(playlistName || "").trim(),
    updatedAt: Date.now(),
  })
  const label = String(playlistName || playlistUri || "").trim()
  return { ok: true, message: `"${label}" saved as your favorite Spotify playlist.` }
}

export function clearSpotifyFavoritePlaylist(userId: string): { ok: boolean; message: string } {
  const uid = normalizeUserId(userId)
  if (!uid) return { ok: false, message: "Invalid user context." }
  kvDelete(uid, NAMESPACE, KEY)
  return { ok: true, message: "Favorite Spotify playlist cleared." }
}
