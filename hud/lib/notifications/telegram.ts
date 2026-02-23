import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/server-store"

export interface TelegramSendInput {
  text: string
  chatIds?: string[]
  parseMode?: "Markdown" | "MarkdownV2" | "HTML"
  disableNotification?: boolean
}

interface TelegramSendResult {
  chatId: string
  ok: boolean
  status: number
  body?: unknown
  error?: string
}

const TELEGRAM_SEND_TIMEOUT_MS = Math.max(
  2_000,
  Math.min(30_000, Number.parseInt(process.env.NOVA_TELEGRAM_SEND_TIMEOUT_MS || "10000", 10) || 10_000),
)
const TELEGRAM_MAX_RETRIES = Math.max(
  0,
  Math.min(4, Number.parseInt(process.env.NOVA_TELEGRAM_SEND_MAX_RETRIES || "2", 10) || 2),
)
const TELEGRAM_RETRY_BASE_MS = Math.max(
  250,
  Math.min(5_000, Number.parseInt(process.env.NOVA_TELEGRAM_SEND_RETRY_BASE_MS || "700", 10) || 700),
)

function extractTelegramError(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const maybe = body as { description?: unknown }
  if (typeof maybe.description === "string" && maybe.description.trim().length > 0) {
    return maybe.description
  }
  return undefined
}

function normalizeChatIds(ids?: string[]): string[] {
  const seen = new Set<string>()
  const deduped = (values: string[]): string[] => {
    const output: string[] = []
    for (const value of values) {
      const normalized = value.trim()
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      output.push(normalized)
    }
    return output
  }

  if (ids && ids.length > 0) {
    return deduped(ids)
  }

  const envIds = process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? ""
  return deduped(envIds.split(","))
}

function getTelegramToken(configToken?: string): string {
  const token = configToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error("Telegram bot token is missing. Re-save Telegram integration in Settings.")
  }
  return token
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function sanitizeTelegramHtml(value: string): string {
  const tokens: string[] = []
  const reserve = (raw: string): string => {
    const token = `__TELEGRAM_TAG_${tokens.length}__`
    tokens.push(raw)
    return token
  }

  let working = value
    .replace(/<\/?(b|i|u|s|code|pre)\s*>/gi, (match) => reserve(match.toLowerCase().replace(/\s+/g, "")))
    .replace(/<a\s+href=(["'])(https?:\/\/[^"']+)\1\s*>/gi, (_, __, href: string) => reserve(`<a href="${escapeHtml(href)}">`))
    .replace(/<\/a\s*>/gi, () => reserve("</a>"))

  working = escapeHtml(working)

  for (let index = 0; index < tokens.length; index += 1) {
    const escapedToken = escapeHtml(`__TELEGRAM_TAG_${index}__`)
    working = working.replace(escapedToken, tokens[index])
  }

  return working
}

function isRetryableStatus(status: number): boolean {
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
  const exponential = TELEGRAM_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(30_000, Math.max(TELEGRAM_RETRY_BASE_MS, Math.floor(exponential)))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendTelegramMessage(input: TelegramSendInput, scope?: IntegrationsStoreScope): Promise<TelegramSendResult[]> {
  const config = await loadIntegrationsConfig(scope)
  if (!config.telegram.connected) {
    throw new Error("Telegram integration is disabled")
  }

  const token = getTelegramToken(config.telegram.botToken || undefined)
  const chatIds = input.chatIds?.length
    ? normalizeChatIds(input.chatIds)
    : config.telegram.chatIds.length > 0
      ? normalizeChatIds(config.telegram.chatIds)
      : normalizeChatIds(undefined)

  const trimmedText = input.text.trim()
  if (!trimmedText) {
    throw new Error("Notification text is required")
  }

  if (chatIds.length === 0) {
    throw new Error("No Telegram chat IDs configured. Set TELEGRAM_CHAT_IDS or pass chatIds in the request.")
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`
  const maxAttempts = TELEGRAM_MAX_RETRIES + 1

  const results = await Promise.all(
    chatIds.map(async (chatId): Promise<TelegramSendResult> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS)
        const parsedMode = input.parseMode === "HTML" ? "HTML" : input.parseMode
        const safeText = parsedMode === "HTML" ? sanitizeTelegramHtml(trimmedText) : trimmedText
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: safeText,
              parse_mode: parsedMode,
              disable_notification: input.disableNotification,
            }),
            cache: "no-store",
            signal: controller.signal,
          })
          clearTimeout(timeout)

          const body = await res.json().catch(() => undefined)
          const messageError = extractTelegramError(body) || `Telegram API returned ${res.status}`
          if (res.ok) {
            return {
              chatId,
              ok: true,
              status: res.status,
              body,
            }
          }

          const retryAfterMs = parseRetryAfterMs(res.headers)
          const shouldRetry = attempt < maxAttempts && isRetryableStatus(res.status)
          if (shouldRetry) {
            await sleep(computeRetryDelayMs(attempt, retryAfterMs))
            continue
          }

          return {
            chatId,
            ok: false,
            status: res.status,
            body,
            error: messageError,
          }
        } catch (error) {
          clearTimeout(timeout)
          const message = error instanceof Error ? error.message : "Unknown Telegram send error"
          if (attempt < maxAttempts) {
            await sleep(computeRetryDelayMs(attempt))
            continue
          }
          return {
            chatId,
            ok: false,
            status: 0,
            error: message,
          }
        }
      }

      return {
        chatId,
        ok: false,
        status: 0,
        error: "Unknown Telegram send error",
      }
    }),
  )

  return results
}
