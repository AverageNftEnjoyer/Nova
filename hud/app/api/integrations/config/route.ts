import { NextResponse } from "next/server"

import {
  loadIntegrationsConfig,
  updateIntegrationsConfig,
  type IntegrationsConfig,
  type DiscordIntegrationConfig,
  type TelegramIntegrationConfig,
} from "@/lib/integrations/server-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeTelegramInput(raw: unknown, current: TelegramIntegrationConfig): TelegramIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const telegram = raw as Partial<TelegramIntegrationConfig> & { chatIds?: string[] | string }

  let chatIds = current.chatIds
  if (typeof telegram.chatIds === "string") {
    chatIds = telegram.chatIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  } else if (Array.isArray(telegram.chatIds)) {
    chatIds = telegram.chatIds.map((id) => String(id).trim()).filter(Boolean)
  }

  return {
    connected: typeof telegram.connected === "boolean" ? telegram.connected : current.connected,
    botToken: typeof telegram.botToken === "string" ? telegram.botToken.trim() : current.botToken,
    chatIds,
  }
}

function normalizeDiscordInput(raw: unknown, current: DiscordIntegrationConfig): DiscordIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const discord = raw as Partial<DiscordIntegrationConfig> & { webhookUrls?: string[] | string }

  let webhookUrls = current.webhookUrls
  if (typeof discord.webhookUrls === "string") {
    webhookUrls = discord.webhookUrls
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean)
  } else if (Array.isArray(discord.webhookUrls)) {
    webhookUrls = discord.webhookUrls.map((url) => String(url).trim()).filter(Boolean)
  }

  return {
    connected: typeof discord.connected === "boolean" ? discord.connected : current.connected,
    webhookUrls,
  }
}

export async function GET() {
  const config = await loadIntegrationsConfig()
  return NextResponse.json({ config })
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Partial<IntegrationsConfig> & {
      telegram?: Partial<TelegramIntegrationConfig> & { chatIds?: string[] | string }
      discord?: Partial<DiscordIntegrationConfig> & { webhookUrls?: string[] | string }
    }
    const current = await loadIntegrationsConfig()
    const telegram = normalizeTelegramInput(body.telegram, current.telegram)
    const discord = normalizeDiscordInput(body.discord, current.discord)
    const next = await updateIntegrationsConfig({
      telegram,
      discord,
      agents: body.agents ?? current.agents,
    })
    return NextResponse.json({ config: next })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update integrations config" },
      { status: 500 },
    )
  }
}
