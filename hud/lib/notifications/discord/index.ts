import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/store/server-store"

export interface DiscordSendInput {
  text: string
  webhookUrls?: string[]
  username?: string
  avatarUrl?: string
}

interface DiscordSendResult {
  webhookId: string
  ok: boolean
  status: number
  body?: unknown
  error?: string
  attempts?: number
  retryable?: boolean
}

const DISCORD_SEND_TIMEOUT_MS = Math.max(
  2_000,
  Math.min(45_000, Number.parseInt(process.env.NOVA_DISCORD_SEND_TIMEOUT_MS || "10000", 10) || 10_000),
)
const DISCORD_MAX_RETRIES = Math.max(
  0,
  Math.min(4, Number.parseInt(process.env.NOVA_DISCORD_SEND_MAX_RETRIES || "2", 10) || 2),
)
const DISCORD_RETRY_BASE_MS = Math.max(
  250,
  Math.min(8_000, Number.parseInt(process.env.NOVA_DISCORD_SEND_RETRY_BASE_MS || "700", 10) || 700),
)
const DISCORD_RETRY_JITTER_MS = Math.max(
  0,
  Math.min(4_000, Number.parseInt(process.env.NOVA_DISCORD_SEND_RETRY_JITTER_MS || "250", 10) || 250),
)
const DISCORD_MAX_TARGETS = Math.max(
  1,
  Math.min(200, Number.parseInt(process.env.NOVA_DISCORD_MAX_TARGETS || "50", 10) || 50),
)
const DISCORD_SEND_CONCURRENCY = Math.max(
  1,
  Math.min(20, Number.parseInt(process.env.NOVA_DISCORD_SEND_CONCURRENCY || "5", 10) || 5),
)
const DISCORD_RETRY_FEATURE_FLAG = (() => {
  const value = String(process.env.NOVA_DISCORD_RETRY_ENABLED || "1").trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
})()
const DISCORD_SEND_KILL_SWITCH = (() => {
  const value = String(process.env.NOVA_DISCORD_SEND_DISABLED || "0").trim().toLowerCase()
  return value === "1" || value === "true" || value === "on"
})()

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === "localhost") return true
  if (host.endsWith(".local")) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map((part) => Number(part))
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
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
  if (isPrivateOrLocalHost(parsed.hostname)) return false
  const host = parsed.hostname.toLowerCase()
  if (host !== "discord.com" && host !== "discordapp.com" && host !== "ptb.discord.com" && host !== "canary.discord.com") {
    return false
  }
  if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(parsed.pathname)) return false
  if (parsed.username || parsed.password) return false
  return true
}

export function redactWebhookTarget(value: string): string {
  const raw = String(value || "").trim()
  if (!raw) return "discord:webhook:unknown"
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return "discord:webhook:invalid"
  }
  const parts = parsed.pathname.split("/").filter(Boolean)
  const id = parts.length >= 3 ? parts[2] : ""
  if (!id) return "discord:webhook:redacted"
  const prefix = id.slice(0, 3)
  const suffix = id.slice(-3)
  return `discord:webhook:${prefix}***${suffix}`
}

function normalizeWebhookUrls(urls?: string[]): string[] {
  const seen = new Set<string>()
  const dedupe = (items: string[]): string[] => {
    const output: string[] = []
    for (const item of items) {
      const normalized = String(item || "").trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      output.push(normalized)
    }
    return output
  }

  if (urls && urls.length > 0) {
    return dedupe(urls)
  }

  const envUrls = process.env.DISCORD_WEBHOOK_URLS ?? process.env.DISCORD_WEBHOOK_URL ?? ""
  return dedupe(envUrls.split(","))
}

export function isRetryableDiscordStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = String(headers.get("retry-after") || "").trim()
  if (!raw) return null
  const numericSeconds = Number(raw)
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.floor(numericSeconds * 1000)
  }
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now()
    if (delta > 0) return delta
  }
  return null
}

function computeRetryDelayMs(attempt: number, retryAfterMs?: number | null): number {
  if (Number.isFinite(retryAfterMs) && retryAfterMs && retryAfterMs > 0) {
    return Math.min(30_000, Math.max(250, Math.floor(retryAfterMs)))
  }
  const exponential = DISCORD_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = DISCORD_RETRY_JITTER_MS > 0 ? Math.floor(Math.random() * (DISCORD_RETRY_JITTER_MS + 1)) : 0
  return Math.min(30_000, Math.max(DISCORD_RETRY_BASE_MS, Math.floor(exponential + jitter)))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type DeliverySummaryStatus = "none" | "all_failed" | "partial" | "all_succeeded"

export function computeDeliverySummary(results: DiscordSendResult[]): { status: DeliverySummaryStatus; okCount: number; failCount: number } {
  const okCount = results.filter((result) => result.ok).length
  const failCount = results.length - okCount
  if (results.length === 0) return { status: "none", okCount: 0, failCount: 0 }
  if (okCount === 0) return { status: "all_failed", okCount, failCount }
  if (failCount === 0) return { status: "all_succeeded", okCount, failCount }
  return { status: "partial", okCount, failCount }
}

async function sendToWebhook(webhookUrl: string, payload: { content: string; username?: string; avatar_url?: string }): Promise<DiscordSendResult> {
  const webhookId = redactWebhookTarget(webhookUrl)
  const maxAttempts = DISCORD_RETRY_FEATURE_FLAG ? DISCORD_MAX_RETRIES + 1 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DISCORD_SEND_TIMEOUT_MS)
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const body = await res.text().catch(() => "")
      if (res.ok) {
        return {
          webhookId,
          ok: true,
          status: res.status,
          body,
          attempts: attempt,
          retryable: false,
        }
      }

      const retryable = isRetryableDiscordStatus(res.status)
      const shouldRetry = retryable && attempt < maxAttempts
      if (shouldRetry) {
        await sleep(computeRetryDelayMs(attempt, parseRetryAfterMs(res.headers)))
        continue
      }

      return {
        webhookId,
        ok: false,
        status: res.status,
        body,
        error: `Discord webhook returned ${res.status}`,
        attempts: attempt,
        retryable,
      }
    } catch (error) {
      clearTimeout(timeout)
      const message = error instanceof Error ? error.message : "Unknown Discord send error"
      if (attempt < maxAttempts) {
        await sleep(computeRetryDelayMs(attempt))
        continue
      }
      return {
        webhookId,
        ok: false,
        status: 0,
        error: message,
        attempts: attempt,
        retryable: true,
      }
    }
  }

  return {
    webhookId,
    ok: false,
    status: 0,
    error: "Unknown Discord send error",
    attempts: maxAttempts,
    retryable: true,
  }
}

export async function sendDiscordMessage(input: DiscordSendInput, scope?: IntegrationsStoreScope): Promise<DiscordSendResult[]> {
  if (DISCORD_SEND_KILL_SWITCH) {
    throw new Error("Discord dispatch is temporarily disabled by operator policy.")
  }
  const config = await loadIntegrationsConfig(scope)
  if (!config.discord.connected) {
    throw new Error("Discord integration is disabled")
  }

  if (!input.text.trim()) {
    throw new Error("Notification text is required")
  }

  const webhookUrls = input.webhookUrls?.length
    ? normalizeWebhookUrls(input.webhookUrls)
    : config.discord.webhookUrls.length > 0
      ? normalizeWebhookUrls(config.discord.webhookUrls)
      : normalizeWebhookUrls(undefined)

  if (webhookUrls.length === 0) {
    throw new Error("No Discord webhook URLs configured. Set DISCORD_WEBHOOK_URLS or configure Discord webhooks.")
  }
  if (webhookUrls.length > DISCORD_MAX_TARGETS) {
    throw new Error(`Discord target count exceeds cap (${DISCORD_MAX_TARGETS}). Reduce configured targets.`)
  }
  const invalidWebhook = webhookUrls.find((url) => !isValidDiscordWebhookUrl(url))
  if (invalidWebhook) {
    throw new Error(`Invalid Discord webhook URL: ${redactWebhookTarget(invalidWebhook)}`)
  }

  const payload = {
    content: input.text,
    username: input.username,
    avatar_url: input.avatarUrl,
  }
  const queue = [...webhookUrls]
  const results: DiscordSendResult[] = []
  const workerCount = Math.min(DISCORD_SEND_CONCURRENCY, queue.length)
  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (queue.length > 0) {
        const nextWebhook = queue.shift()
        if (!nextWebhook) break
        const outcome = await sendToWebhook(nextWebhook, payload)
        results.push(outcome)
      }
    }),
  )

  return results
}
