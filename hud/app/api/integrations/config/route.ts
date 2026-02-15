import { NextResponse } from "next/server"

import {
  loadIntegrationsConfig,
  updateIntegrationsConfig,
  type IntegrationsConfig,
  type ClaudeIntegrationConfig,
  type DiscordIntegrationConfig,
  type GrokIntegrationConfig,
  type GeminiIntegrationConfig,
  type GmailIntegrationConfig,
  type LlmProvider,
  type OpenAIIntegrationConfig,
  type TelegramIntegrationConfig,
} from "@/lib/integrations/server-store"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`
}

function toClientAgents(config: IntegrationsConfig) {
  const output: Record<string, { connected: boolean; endpoint: string; apiKeyConfigured: boolean; apiKeyMasked: string }> = {}
  for (const [id, agent] of Object.entries(config.agents || {})) {
    const key = String(id || "").trim()
    if (!key) continue
    output[key] = {
      connected: Boolean(agent.connected),
      endpoint: String(agent.endpoint || "").trim(),
      apiKeyConfigured: String(agent.apiKey || "").trim().length > 0,
      apiKeyMasked: maskSecret(String(agent.apiKey || "")),
    }
  }
  return output
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

  const nextBotToken =
    typeof telegram.botToken === "string"
      ? (telegram.botToken.trim().length > 0 ? telegram.botToken.trim() : current.botToken)
      : current.botToken

  return {
    connected: (typeof telegram.connected === "boolean" ? telegram.connected : current.connected) && nextBotToken.trim().length > 0,
    botToken: nextBotToken,
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
  const nextApiKey =
    typeof openai.apiKey === "string"
      ? (openai.apiKey.trim().length > 0 ? openai.apiKey.trim() : current.apiKey)
      : current.apiKey

  return {
    connected: (typeof openai.connected === "boolean" ? openai.connected : current.connected) && nextApiKey.trim().length > 0,
    apiKey: nextApiKey,
    baseUrl: typeof openai.baseUrl === "string" && openai.baseUrl.trim().length > 0 ? openai.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof openai.defaultModel === "string" && openai.defaultModel.trim().length > 0
      ? openai.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeClaudeInput(raw: unknown, current: ClaudeIntegrationConfig): ClaudeIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const claude = raw as Partial<ClaudeIntegrationConfig>
  const nextApiKey =
    typeof claude.apiKey === "string"
      ? (claude.apiKey.trim().length > 0 ? claude.apiKey.trim() : current.apiKey)
      : current.apiKey

  return {
    connected: (typeof claude.connected === "boolean" ? claude.connected : current.connected) && nextApiKey.trim().length > 0,
    apiKey: nextApiKey,
    baseUrl: typeof claude.baseUrl === "string" && claude.baseUrl.trim().length > 0 ? claude.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof claude.defaultModel === "string" && claude.defaultModel.trim().length > 0
      ? claude.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeGrokInput(raw: unknown, current: GrokIntegrationConfig): GrokIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const grok = raw as Partial<GrokIntegrationConfig>
  const nextApiKey =
    typeof grok.apiKey === "string"
      ? (grok.apiKey.trim().length > 0 ? grok.apiKey.trim() : current.apiKey)
      : current.apiKey

  return {
    connected: (typeof grok.connected === "boolean" ? grok.connected : current.connected) && nextApiKey.trim().length > 0,
    apiKey: nextApiKey,
    baseUrl: typeof grok.baseUrl === "string" && grok.baseUrl.trim().length > 0 ? grok.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof grok.defaultModel === "string" && grok.defaultModel.trim().length > 0
      ? grok.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeGeminiInput(raw: unknown, current: GeminiIntegrationConfig): GeminiIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const gemini = raw as Partial<GeminiIntegrationConfig>
  const nextApiKey =
    typeof gemini.apiKey === "string"
      ? (gemini.apiKey.trim().length > 0 ? gemini.apiKey.trim() : current.apiKey)
      : current.apiKey

  return {
    connected: (typeof gemini.connected === "boolean" ? gemini.connected : current.connected) && nextApiKey.trim().length > 0,
    apiKey: nextApiKey,
    baseUrl: typeof gemini.baseUrl === "string" && gemini.baseUrl.trim().length > 0 ? gemini.baseUrl.trim() : current.baseUrl,
    defaultModel: typeof gemini.defaultModel === "string" && gemini.defaultModel.trim().length > 0
      ? gemini.defaultModel.trim()
      : current.defaultModel,
  }
}

function normalizeGmailInput(raw: unknown, current: GmailIntegrationConfig): GmailIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const gmail = raw as Partial<GmailIntegrationConfig> & { scopes?: string[] | string }
  const nextClientSecret =
    typeof gmail.oauthClientSecret === "string"
      ? (gmail.oauthClientSecret.trim().length > 0 ? gmail.oauthClientSecret.trim() : current.oauthClientSecret)
      : current.oauthClientSecret
  const scopes = typeof gmail.scopes === "string"
    ? gmail.scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : Array.isArray(gmail.scopes)
      ? gmail.scopes.map((scope) => String(scope).trim()).filter(Boolean)
      : current.scopes
  const activeAccountId =
    typeof gmail.activeAccountId === "string" ? gmail.activeAccountId.trim().toLowerCase() : current.activeAccountId
  const accounts = Array.isArray(gmail.accounts)
    ? gmail.accounts
        .map((account) => ({
          id: String(account?.id || "").trim().toLowerCase(),
          email: String(account?.email || "").trim(),
          scopes: Array.isArray(account?.scopes) ? account.scopes.map((scope) => String(scope).trim()).filter(Boolean) : [],
          enabled: typeof account?.enabled === "boolean" ? account.enabled : true,
          accessTokenEnc: String(account?.accessTokenEnc || "").trim(),
          refreshTokenEnc: String(account?.refreshTokenEnc || "").trim(),
          tokenExpiry: Number(account?.tokenExpiry || 0),
          connectedAt: String(account?.connectedAt || "").trim() || new Date().toISOString(),
        }))
        .filter((account) => account.id && account.email)
    : current.accounts

  return {
    ...current,
    connected:
      (typeof gmail.connected === "boolean" ? gmail.connected : current.connected) &&
      nextClientSecret.trim().length > 0 &&
      (typeof gmail.oauthClientId === "string" ? gmail.oauthClientId.trim().length > 0 : current.oauthClientId.trim().length > 0),
    email: typeof gmail.email === "string" ? gmail.email.trim() : current.email,
    scopes,
    accounts,
    activeAccountId,
    oauthClientId: typeof gmail.oauthClientId === "string" ? gmail.oauthClientId.trim() : current.oauthClientId,
    oauthClientSecret: nextClientSecret,
    redirectUri: typeof gmail.redirectUri === "string" && gmail.redirectUri.trim().length > 0 ? gmail.redirectUri.trim() : current.redirectUri,
  }
}

function normalizeActiveLlmProvider(raw: unknown, current: LlmProvider): LlmProvider {
  if (raw === "openai" || raw === "claude" || raw === "grok" || raw === "gemini") return raw
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
    grok: {
      ...config.grok,
      apiKey: "",
      apiKeyConfigured: config.grok.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.grok.apiKey),
    },
    gemini: {
      ...config.gemini,
      apiKey: "",
      apiKeyConfigured: config.gemini.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.gemini.apiKey),
    },
    gmail: {
      connected: config.gmail.connected,
      email: config.gmail.email,
      scopes: config.gmail.scopes,
      accounts: config.gmail.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        scopes: account.scopes,
        enabled: account.enabled,
        connectedAt: account.connectedAt,
        active: account.id === config.gmail.activeAccountId,
      })),
      activeAccountId: config.gmail.activeAccountId,
      oauthClientId: config.gmail.oauthClientId,
      oauthClientSecret: "",
      oauthClientSecretConfigured: config.gmail.oauthClientSecret.trim().length > 0,
      oauthClientSecretMasked: maskSecret(config.gmail.oauthClientSecret),
      redirectUri: config.gmail.redirectUri,
      tokenConfigured:
        config.gmail.accounts.some((account) => account.refreshTokenEnc.trim().length > 0 || account.accessTokenEnc.trim().length > 0) ||
        config.gmail.refreshTokenEnc.trim().length > 0 ||
        config.gmail.accessTokenEnc.trim().length > 0,
    },
    agents: toClientAgents(config),
  }
}

export async function GET(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  const config = await loadIntegrationsConfig()
  return NextResponse.json({ config: toClientConfig(config) })
}

export async function PATCH(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const body = (await req.json()) as Partial<IntegrationsConfig> & {
      telegram?: Partial<TelegramIntegrationConfig> & { chatIds?: string[] | string }
      discord?: Partial<DiscordIntegrationConfig> & { webhookUrls?: string[] | string }
      openai?: Partial<OpenAIIntegrationConfig>
      claude?: Partial<ClaudeIntegrationConfig>
      grok?: Partial<GrokIntegrationConfig>
      gemini?: Partial<GeminiIntegrationConfig>
      gmail?: Partial<GmailIntegrationConfig> & { scopes?: string[] | string }
      activeLlmProvider?: LlmProvider
    }
    const current = await loadIntegrationsConfig()
    const telegram = normalizeTelegramInput(body.telegram, current.telegram)
    const discord = normalizeDiscordInput(body.discord, current.discord)
    const openai = normalizeOpenAIInput(body.openai, current.openai)
    const claude = normalizeClaudeInput(body.claude, current.claude)
    const grok = normalizeGrokInput(body.grok, current.grok)
    const gemini = normalizeGeminiInput(body.gemini, current.gemini)
    const gmail = normalizeGmailInput(body.gmail, current.gmail)
    const activeLlmProvider = normalizeActiveLlmProvider(body.activeLlmProvider, current.activeLlmProvider)
    const next = await updateIntegrationsConfig({
      telegram,
      discord,
      openai,
      claude,
      grok,
      gemini,
      gmail,
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
