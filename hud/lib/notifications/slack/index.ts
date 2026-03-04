import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/store/server-store"

export interface SlackSendInput {
  text: string
  username?: string
  iconEmoji?: string
  iconUrl?: string
  channel?: string
}

export interface SlackSendResult {
  webhookId: string
  ok: boolean
  status: number
  body?: unknown
  error?: string
  attempts?: number
  retryable?: boolean
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    console.warn(`[slack] Invalid env var ${name}="${raw}", using fallback ${fallback}`)
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

const SLACK_SEND_TIMEOUT_MS = readIntEnv("NOVA_SLACK_SEND_TIMEOUT_MS", 10_000, 2_000, 45_000)
const SLACK_MAX_RETRIES = readIntEnv("NOVA_SLACK_SEND_MAX_RETRIES", 2, 0, 4)
const SLACK_RETRY_BASE_MS = readIntEnv("NOVA_SLACK_SEND_RETRY_BASE_MS", 700, 250, 8_000)
const SLACK_RETRY_JITTER_MS = readIntEnv("NOVA_SLACK_SEND_RETRY_JITTER_MS", 250, 0, 4_000)
const SLACK_RETRY_FEATURE_FLAG = (() => {
  const value = String(process.env.NOVA_SLACK_RETRY_ENABLED || "1").trim().toLowerCase()
  return value !== "0" && value !== "false" && value !== "off"
})()
const SLACK_SEND_KILL_SWITCH = (() => {
  const value = String(process.env.NOVA_SLACK_SEND_DISABLED || "0").trim().toLowerCase()
  return value === "1" || value === "true" || value === "on"
})()

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host) return true
  if (host === "localhost") return true
  if (host.endsWith(".local")) return true

  // IPv6 detection (bracketed or raw)
  const ipv6Raw = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : null
  if (ipv6Raw !== null) {
    if (ipv6Raw === "::1" || ipv6Raw === "::") return true
    if (ipv6Raw.startsWith("fe80:") || ipv6Raw.startsWith("fe80%")) return true
    if (ipv6Raw.startsWith("fc") || ipv6Raw.startsWith("fd")) return true
    if (ipv6Raw.startsWith("::ffff:")) return true
    return true // block all IPv6 addresses; Slack webhooks only use DNS hostnames
  }

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

export function isValidSlackWebhookUrl(value: string): boolean {
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
  if (host !== "hooks.slack.com") return false
  if (!/^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(parsed.pathname)) return false
  if (parsed.username || parsed.password) return false
  return true
}

export function redactSlackWebhookUrl(value: string): string {
  const raw = String(value || "").trim()
  if (!raw) return "slack:webhook:unknown"
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return "slack:webhook:invalid"
  }
  const parts = parsed.pathname.split("/").filter(Boolean)
  const lastSegment = parts.length >= 3 ? parts[parts.length - 1] : ""
  if (!lastSegment || lastSegment.length <= 6) return "slack:webhook:redacted"
  const prefix = lastSegment.slice(0, 3)
  const suffix = lastSegment.slice(-3)
  return `slack:webhook:${prefix}***${suffix}`
}

function isRetryableSlackStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
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
    if (delta > 0) return Math.min(30_000, delta)
  }
  return null
}

function computeRetryDelayMs(attempt: number, retryAfterMs?: number | null): number {
  if (Number.isFinite(retryAfterMs) && retryAfterMs && retryAfterMs > 0) {
    return Math.min(30_000, Math.max(250, Math.floor(retryAfterMs)))
  }
  const exponential = SLACK_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = SLACK_RETRY_JITTER_MS > 0 ? Math.floor(Math.random() * (SLACK_RETRY_JITTER_MS + 1)) : 0
  return Math.min(30_000, Math.max(SLACK_RETRY_BASE_MS, Math.floor(exponential + jitter)))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendToWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<SlackSendResult> {
  const webhookId = redactSlackWebhookUrl(webhookUrl)
  const maxAttempts = SLACK_RETRY_FEATURE_FLAG ? SLACK_MAX_RETRIES + 1 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SLACK_SEND_TIMEOUT_MS)
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

      const retryable = isRetryableSlackStatus(res.status)
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
        error: `Slack webhook returned ${res.status}`,
        attempts: attempt,
        retryable,
      }
    } catch (error) {
      clearTimeout(timeout)
      const message = error instanceof Error ? error.message : "Unknown Slack send error"
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
    error: "Unknown Slack send error",
    attempts: maxAttempts,
    retryable: true,
  }
}

export async function sendSlackMessage(input: SlackSendInput, scope?: IntegrationsStoreScope): Promise<SlackSendResult[]> {
  if (SLACK_SEND_KILL_SWITCH) {
    throw new Error("Slack dispatch is temporarily disabled by operator policy.")
  }
  const config = await loadIntegrationsConfig(scope)
  if (!config.slack.connected) {
    throw new Error("Slack integration is disabled")
  }

  if (!input.text.trim()) {
    throw new Error("Notification text is required")
  }

  const webhookUrl = config.slack.webhookUrl.trim()

  if (!webhookUrl) {
    throw new Error("No Slack webhook URL configured. Configure Slack webhook in Integrations.")
  }
  if (!isValidSlackWebhookUrl(webhookUrl)) {
    throw new Error(`Invalid Slack webhook URL: ${redactSlackWebhookUrl(webhookUrl)}`)
  }

  const payload: Record<string, unknown> = {
    text: input.text,
  }
  if (input.username) {
    const sanitized = input.username.replace(/[\x00-\x1f]/g, "").slice(0, 80)
    if (sanitized) payload.username = sanitized
  }
  if (input.iconEmoji) payload.icon_emoji = input.iconEmoji
  if (input.iconUrl) {
    try {
      const iconParsed = new URL(input.iconUrl)
      if (iconParsed.protocol === "https:") payload.icon_url = input.iconUrl
    } catch { /* discard invalid icon URLs */ }
  }
  if (input.channel) {
    const ch = input.channel.replace(/[\x00-\x1f]/g, "").slice(0, 80)
    if (/^[#@C][A-Za-z0-9_\-./]{0,79}$/.test(ch)) payload.channel = ch
  }

  const result = await sendToWebhook(webhookUrl, payload)
  return [result]
}
