import "server-only"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"

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

function extractTelegramError(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const maybe = body as { description?: unknown }
  if (typeof maybe.description === "string" && maybe.description.trim().length > 0) {
    return maybe.description
  }
  return undefined
}

function normalizeChatIds(ids?: string[]): string[] {
  if (ids && ids.length > 0) {
    return ids.map((id) => id.trim()).filter(Boolean)
  }

  const envIds = process.env.TELEGRAM_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? ""
  return envIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

function getTelegramToken(configToken?: string): string {
  const token = configToken || process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN")
  }
  return token
}

export async function sendTelegramMessage(input: TelegramSendInput): Promise<TelegramSendResult[]> {
  const config = await loadIntegrationsConfig()
  if (!config.telegram.connected) {
    throw new Error("Telegram integration is disabled")
  }

  const token = getTelegramToken(config.telegram.botToken || undefined)
  const chatIds = input.chatIds?.length
    ? normalizeChatIds(input.chatIds)
    : config.telegram.chatIds.length > 0
      ? config.telegram.chatIds
      : normalizeChatIds(undefined)

  if (!input.text.trim()) {
    throw new Error("Notification text is required")
  }

  if (chatIds.length === 0) {
    throw new Error("No Telegram chat IDs configured. Set TELEGRAM_CHAT_IDS or pass chatIds in the request.")
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`

  const results = await Promise.all(
    chatIds.map(async (chatId): Promise<TelegramSendResult> => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: input.text,
            parse_mode: input.parseMode,
            disable_notification: input.disableNotification,
          }),
          cache: "no-store",
        })

        const body = await res.json().catch(() => undefined)
        return {
          chatId,
          ok: res.ok,
          status: res.status,
          body,
          error: res.ok ? undefined : extractTelegramError(body) || `Telegram API returned ${res.status}`,
        }
      } catch (error) {
        return {
          chatId,
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "Unknown Telegram send error",
        }
      }
    }),
  )

  return results
}
