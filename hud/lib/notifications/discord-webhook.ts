import "server-only"

const ALLOWED_DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
])

const WEBHOOK_PATH_REGEX = /^\/api\/webhooks\/[^/]+\/[^/\s]+(?:\/.*)?$/i

function isPrivateOrLocalHost(hostname: string): boolean {
  const lower = String(hostname || "").trim().toLowerCase()
  if (!lower) return true
  if (lower === "localhost") return true
  if (lower.endsWith(".local")) return true
  if (lower.endsWith(".internal")) return true
  if (lower.endsWith(".localhost")) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) {
    const parts = lower.split(".").map((v) => Number(v))
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) return true
    if (parts[0] === 10) return true
    if (parts[0] === 127) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
  }
  return false
}

export function isValidDiscordWebhookUrl(value: string): boolean {
  const raw = String(value || "").trim()
  if (!raw) return false
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:") return false
  const host = String(parsed.hostname || "").trim().toLowerCase()
  if (!ALLOWED_DISCORD_HOSTS.has(host)) return false
  if (isPrivateOrLocalHost(host)) return false
  if (!WEBHOOK_PATH_REGEX.test(String(parsed.pathname || ""))) return false
  return true
}

export function parseDiscordWebhookUrls(input: string[] | string | undefined): { ok: true; urls: string[] } | { ok: false; error: string } {
  const values = Array.isArray(input)
    ? input.map((v) => String(v || ""))
    : String(input || "")
      .split(",")
      .map((v) => String(v || ""))
  const cleaned = values.map((v) => v.trim()).filter(Boolean)
  const deduped = [...new Set(cleaned)]
  for (const url of deduped) {
    if (!isValidDiscordWebhookUrl(url)) {
      return { ok: false, error: "Discord webhook URL is invalid. Use an HTTPS Discord webhook URL (discord.com/api/webhooks/...)."}
    }
  }
  return { ok: true, urls: deduped }
}

export function redactDiscordWebhookUrl(url: string): string {
  const raw = String(url || "").trim()
  if (!raw) return ""
  try {
    const parsed = new URL(raw)
    const path = String(parsed.pathname || "")
    const parts = path.split("/").filter(Boolean)
    const id = parts.length >= 3 ? parts[2] : ""
    const token = parts.length >= 4 ? parts[3] : ""
    const idMasked = id ? `${id.slice(0, 4)}...${id.slice(-4)}` : "unknown"
    const tokenMasked = token ? `${token.slice(0, 4)}...${token.slice(-4)}` : "unknown"
    return `${parsed.hostname}/api/webhooks/${idMasked}/${tokenMasked}`
  } catch {
    return raw.length <= 12 ? "***" : `${raw.slice(0, 6)}...${raw.slice(-4)}`
  }
}

