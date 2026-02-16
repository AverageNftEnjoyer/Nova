import "server-only"

import { type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/server-store"

export interface DiscordSendInput {
  text: string
  webhookUrls?: string[]
  username?: string
  avatarUrl?: string
}

interface DiscordSendResult {
  webhookUrl: string
  ok: boolean
  status: number
  body?: unknown
  error?: string
}

function normalizeWebhookUrls(urls?: string[]): string[] {
  if (urls && urls.length > 0) {
    return urls.map((url) => url.trim()).filter(Boolean)
  }

  const envUrls = process.env.DISCORD_WEBHOOK_URLS ?? process.env.DISCORD_WEBHOOK_URL ?? ""
  return envUrls
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
}

export async function sendDiscordMessage(input: DiscordSendInput, scope?: IntegrationsStoreScope): Promise<DiscordSendResult[]> {
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
      ? config.discord.webhookUrls
      : normalizeWebhookUrls(undefined)

  if (webhookUrls.length === 0) {
    throw new Error("No Discord webhook URLs configured. Set DISCORD_WEBHOOK_URLS or configure Discord webhooks.")
  }

  const results = await Promise.all(
    webhookUrls.map(async (webhookUrl): Promise<DiscordSendResult> => {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: input.text,
            username: input.username,
            avatar_url: input.avatarUrl,
          }),
          cache: "no-store",
        })

        const body = await res.text().catch(() => "")
        return {
          webhookUrl,
          ok: res.ok,
          status: res.status,
          body,
          error: res.ok ? undefined : `Discord webhook returned ${res.status}`,
        }
      } catch (error) {
        return {
          webhookUrl,
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "Unknown Discord send error",
        }
      }
    }),
  )

  return results
}
