import { NextResponse } from "next/server"

import {
  loadIntegrationsConfig,
  updateIntegrationsConfig,
  type IntegrationsConfig,
  type ClaudeIntegrationConfig,
  type DiscordIntegrationConfig,
  type LlmProvider,
  type OpenAIIntegrationConfig,
  type TelegramIntegrationConfig,
} from "@/lib/integrations/server-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`
}

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

function normalizeOpenAIInput(raw: unknown, current: OpenAIIntegrationConfig): OpenAIIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const openai = raw as Partial<OpenAIIntegrationConfig>

  return {
    connected: typeof openai.connected === "boolean" ? openai.connected : current.connected,
    apiKey:
      typeof openai.apiKey === "string"
        ? (openai.apiKey.trim().length > 0 ? openai.apiKey.trim() : current.apiKey)
        : current.apiKey,
    baseUrl: typeof openai.baseUrl === "string" && openai.baseUrl.trim().length > 0 ? openai.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof openai.defaultModel === "string" && openai.defaultModel.trim().length > 0
      ? openai.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeClaudeInput(raw: unknown, current: ClaudeIntegrationConfig): ClaudeIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const claude = raw as Partial<ClaudeIntegrationConfig>

  return {
    connected: typeof claude.connected === "boolean" ? claude.connected : current.connected,
    apiKey:
      typeof claude.apiKey === "string"
        ? (claude.apiKey.trim().length > 0 ? claude.apiKey.trim() : current.apiKey)
        : current.apiKey,
    baseUrl: typeof claude.baseUrl === "string" && claude.baseUrl.trim().length > 0 ? claude.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof claude.defaultModel === "string" && claude.defaultModel.trim().length > 0
      ? claude.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeActiveLlmProvider(raw: unknown, current: LlmProvider): LlmProvider {
  if (raw === "openai" || raw === "claude") return raw
  return current
}

function toClientConfig(config: IntegrationsConfig) {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: "",
      botTokenConfigured: config.telegram.botToken.trim().length > 0,
      botTokenMasked: maskSecret(config.telegram.botToken),
    },
    openai: {
      ...config.openai,
      apiKey: "",
      apiKeyConfigured: config.openai.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.openai.apiKey),
    },
    claude: {
      ...config.claude,
      apiKey: "",
      apiKeyConfigured: config.claude.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.claude.apiKey),
    },
  }
}

export async function GET() {
  const config = await loadIntegrationsConfig()
  return NextResponse.json({ config: toClientConfig(config) })
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as Partial<IntegrationsConfig> & {
      telegram?: Partial<TelegramIntegrationConfig> & { chatIds?: string[] | string }
      discord?: Partial<DiscordIntegrationConfig> & { webhookUrls?: string[] | string }
      openai?: Partial<OpenAIIntegrationConfig>
      claude?: Partial<ClaudeIntegrationConfig>
      activeLlmProvider?: LlmProvider
    }
    const current = await loadIntegrationsConfig()
    const telegram = normalizeTelegramInput(body.telegram, current.telegram)
    const discord = normalizeDiscordInput(body.discord, current.discord)
    const openai = normalizeOpenAIInput(body.openai, current.openai)
    const claude = normalizeClaudeInput(body.claude, current.claude)
    const activeLlmProvider = normalizeActiveLlmProvider(body.activeLlmProvider, current.activeLlmProvider)
    const next = await updateIntegrationsConfig({
      telegram,
      discord,
      openai,
      claude,
      activeLlmProvider,
      agents: body.agents ?? current.agents,
    })
    return NextResponse.json({ config: toClientConfig(next) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update integrations config" },
      { status: 500 },
    )
  }
}
