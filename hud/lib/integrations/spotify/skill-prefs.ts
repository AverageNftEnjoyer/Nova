import fs from "fs"
import path from "path"

// The HUD process runs with cwd = C:\Nova\hud, but the .agent directory lives at the repo root.
// Resolve upward from cwd: if cwd ends with "hud", go up one level. Otherwise trust cwd.
function resolveNovaRoot(): string {
  const envRoot = String(process.env.NOVA_ROOT || "").trim()
  if (envRoot) return envRoot
  const cwd = process.cwd()
  // When started via nova.js the HUD cwd is <root>/hud; normalise to repo root.
  if (path.basename(cwd).toLowerCase() === "hud") return path.dirname(cwd)
  return cwd
}

const NOVA_ROOT = resolveNovaRoot()
const USER_CONTEXT_ROOT = path.join(NOVA_ROOT, ".agent", "user-context")
const SKILL_FILE = "SKILL.md"
const SECTION_HEADER = "## User Preference Overrides"
const FAVORITE_PLAYLIST_URI_KEY = "favorite_playlist_uri"
const FAVORITE_PLAYLIST_NAME_KEY = "favorite_playlist_name"

function normalizeUserId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function spotifySkillPath(userId: string): string {
  const id = normalizeUserId(userId)
  return path.join(USER_CONTEXT_ROOT, id, "skills", "spotify", SKILL_FILE)
}

function readSkillFile(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8")
  } catch {}
  return ""
}

function ensureSkillFile(filePath: string): string {
  let content = readSkillFile(filePath)
  if (!content) {
    const baselinePath = path.join(NOVA_ROOT, "skills", "spotify", SKILL_FILE)
    try {
      if (fs.existsSync(baselinePath)) content = fs.readFileSync(baselinePath, "utf8")
    } catch {}
    if (!content) {
      content = [
        "---",
        "name: spotify",
        "description: Controls Spotify playback, stores user playlist and music preferences.",
        "---",
        "",
        "# Spotify Skill",
        "",
        SECTION_HEADER,
        "- Applies only to this user context.",
        "",
      ].join("\n")
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content.replace(/\r\n/g, "\n").trim() + "\n", "utf8")
    } catch {}
  }
  return content
}

export interface SpotifySkillPrefs {
  favoritePlaylistUri: string
  favoritePlaylistName: string
}

export function readSpotifySkillPrefs(userId: string): SpotifySkillPrefs {
  const filePath = spotifySkillPath(userId)
  const content = readSkillFile(filePath)
  if (!content) return { favoritePlaylistUri: "", favoritePlaylistName: "" }

  const lines = content.split("\n")
  let favoritePlaylistUri = ""
  let favoritePlaylistName = ""

  for (const line of lines) {
    const trimmed = line.trim()
    const uriMatch = trimmed.match(/^-?\s*favorite_playlist_uri\s*:\s*(.+)$/i)
    if (uriMatch?.[1]) { favoritePlaylistUri = uriMatch[1].trim().replace(/^['"]|['"]$/g, ""); continue }
    const nameMatch = trimmed.match(/^-?\s*favorite_playlist_name\s*:\s*(.+)$/i)
    if (nameMatch?.[1]) { favoritePlaylistName = nameMatch[1].trim().replace(/^['"]|['"]$/g, ""); continue }
  }

  return { favoritePlaylistUri, favoritePlaylistName }
}

export function writeSpotifyFavoritePlaylist(
  userId: string,
  playlistUri: string,
  playlistName: string,
): { ok: boolean; message: string } {
  const filePath = spotifySkillPath(userId)
  const content = ensureSkillFile(filePath)
  const lines = content.replace(/\r\n/g, "\n").split("\n")

  // Find or create the User Preference Overrides section
  let sectionStart = lines.findIndex(
    (l) => l.trim().toLowerCase() === SECTION_HEADER.toLowerCase(),
  )
  if (sectionStart < 0) {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("")
    sectionStart = lines.length
    lines.push(SECTION_HEADER, "- Applies only to this user context.", "")
  }

  // Find end of section (next ## or EOF)
  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? "")) { sectionEnd = i; break }
  }

  // Build new section lines, replacing or inserting the two keys
  const sectionLines: string[] = []
  let uriSet = false
  let nameSet = false
  for (let i = sectionStart; i < sectionEnd; i++) {
    const l = lines[i] ?? ""
    if (/^-?\s*favorite_playlist_uri\s*:/i.test(l.trim())) {
      sectionLines.push(`- ${FAVORITE_PLAYLIST_URI_KEY}: ${playlistUri}`)
      uriSet = true
    } else if (/^-?\s*favorite_playlist_name\s*:/i.test(l.trim())) {
      sectionLines.push(`- ${FAVORITE_PLAYLIST_NAME_KEY}: ${playlistName}`)
      nameSet = true
    } else {
      sectionLines.push(l)
    }
  }
  if (!uriSet) sectionLines.push(`- ${FAVORITE_PLAYLIST_URI_KEY}: ${playlistUri}`)
  if (!nameSet) sectionLines.push(`- ${FAVORITE_PLAYLIST_NAME_KEY}: ${playlistName}`)

  const rebuilt = [
    ...lines.slice(0, sectionStart),
    ...sectionLines,
    ...lines.slice(sectionEnd),
  ].join("\n").replace(/\r\n/g, "\n").trim() + "\n"

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, rebuilt, "utf8")
    const label = playlistName || playlistUri
    return { ok: true, message: `"${label}" saved as your favorite Spotify playlist.` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to write Spotify skill."
    return { ok: false, message: msg }
  }
}
