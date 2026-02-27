import { NextResponse } from "next/server"

import {
  loadIntegrationsConfig,
  updateIntegrationsConfig,
  type IntegrationsConfig,
  type BraveIntegrationConfig,
  type CoinbaseIntegrationConfig,
  type ClaudeIntegrationConfig,
  type DiscordIntegrationConfig,
  type GrokIntegrationConfig,
  type GeminiIntegrationConfig,
  type SpotifyIntegrationConfig,
  type GmailIntegrationConfig,
  type GmailCalendarIntegrationConfig,
  type LlmProvider,
  type OpenAIIntegrationConfig,
  type TelegramIntegrationConfig,
} from "@/lib/integrations/server-store"
import { syncAgentRuntimeIntegrationsSnapshot } from "@/lib/integrations/agent-runtime-sync"
import { createCoinbaseStore } from "@/lib/coinbase/reporting"
import { isValidDiscordWebhookUrl, redactWebhookTarget } from "@/lib/notifications/discord"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const DISCORD_MAX_WEBHOOKS = Math.max(
  1,
  Math.min(200, Number.parseInt(process.env.NOVA_DISCORD_MAX_TARGETS || "50", 10) || 50),
)

type CoinbaseCredentialMode = "pem_private_key" | "secret_string" | "unknown"

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`
}

function looksLikeEncryptedEnvelope(value: string): boolean {
  const parts = value.trim().split(".")
  if (parts.length !== 3) return false
  return parts.every((part) => /^[A-Za-z0-9+/=_-]+$/.test(part))
}

function detectCoinbaseCredentialMode(secret: string): CoinbaseCredentialMode {
  const trimmed = secret.trim()
  if (!trimmed) return "unknown"
  if (/-----BEGIN (?:EC )?PRIVATE KEY-----/.test(trimmed)) return "pem_private_key"
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && !trimmed.includes("\n") && trimmed.length >= 40) return "secret_string"
  return "unknown"
}

function isLikelyCoinbaseApiKey(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^organizations\/[^/\s]+\/apiKeys\/[^/\s]+$/i.test(trimmed)) return true
  if (/^[0-9a-fA-F-]{36,}$/.test(trimmed)) return true
  return false
}

function validateCoinbaseApiKeyPair(config: CoinbaseIntegrationConfig): { ok: true; credentialMode: CoinbaseCredentialMode } | { ok: false; message: string } {
  const apiKey = config.apiKey.trim()
  const apiSecret = config.apiSecret.trim()
  if (!apiKey || !apiSecret) {
    return { ok: false, message: "Coinbase API key pair requires both API Key ID and API Secret private key." }
  }
  if (!isLikelyCoinbaseApiKey(apiKey)) {
    return { ok: false, message: "Coinbase API Key ID format is invalid. Expected organizations/.../apiKeys/... or a key id/uuid value." }
  }
  if (looksLikeEncryptedEnvelope(apiSecret)) {
    return { ok: false, message: "Coinbase API Secret appears encrypted/ciphertext. Paste the raw Coinbase private key value instead." }
  }
  const credentialMode = detectCoinbaseCredentialMode(apiSecret)
  if (credentialMode === "unknown") {
    return {
      ok: false,
      message:
        "Coinbase API Secret format is invalid. Provide the full PEM private key (-----BEGIN ... PRIVATE KEY-----) or the Coinbase secret string.",
    }
  }
  if (credentialMode === "pem_private_key" && !/-----END (?:EC )?PRIVATE KEY-----/.test(apiSecret)) {
    return { ok: false, message: "Coinbase PEM private key is incomplete. Missing END PRIVATE KEY footer." }
  }
  return { ok: true, credentialMode }
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
  webhookUrls = Array.from(new Set(webhookUrls.map((url) => url.trim()).filter(Boolean)))

  const invalid = webhookUrls.find((url) => !isValidDiscordWebhookUrl(url))
  if (invalid) {
    throw new Error(`Invalid Discord webhook URL: ${redactWebhookTarget(invalid)}`)
  }
  if (webhookUrls.length > DISCORD_MAX_WEBHOOKS) {
    throw new Error(`Discord webhook count exceeds cap (${DISCORD_MAX_WEBHOOKS}).`)
  }

  const requestedConnected = typeof discord.connected === "boolean" ? discord.connected : current.connected
  if (requestedConnected && webhookUrls.length === 0) {
    throw new Error("Discord cannot be enabled without at least one valid webhook URL.")
  }
  const connected = requestedConnected && webhookUrls.length > 0

  return {
    connected,
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

function normalizeBraveInput(raw: unknown, current: BraveIntegrationConfig): BraveIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const brave = raw as Partial<BraveIntegrationConfig>
  const nextApiKey =
    typeof brave.apiKey === "string"
      ? (brave.apiKey.trim().length > 0 ? brave.apiKey.trim() : current.apiKey)
      : current.apiKey

  return {
    connected: (typeof brave.connected === "boolean" ? brave.connected : current.connected) && nextApiKey.trim().length > 0,
    apiKey: nextApiKey,
  }
}

function normalizeCoinbaseInput(raw: unknown, current: CoinbaseIntegrationConfig): CoinbaseIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const coinbase = raw as Partial<CoinbaseIntegrationConfig>
  const nextApiKey =
    typeof coinbase.apiKey === "string"
      ? (coinbase.apiKey.trim().length > 0 ? coinbase.apiKey.trim() : current.apiKey)
      : current.apiKey
  const nextApiSecret =
    typeof coinbase.apiSecret === "string"
      ? (coinbase.apiSecret.trim().length > 0 ? coinbase.apiSecret.trim() : current.apiSecret)
      : current.apiSecret
  const nextConnectionMode =
    coinbase.connectionMode === "oauth" || coinbase.connectionMode === "api_key_pair"
      ? coinbase.connectionMode
      : current.connectionMode
  const nextRequiredScopes = Array.isArray(coinbase.requiredScopes)
    ? coinbase.requiredScopes.map((scope) => String(scope).trim().toLowerCase()).filter(Boolean)
    : typeof (coinbase as { requiredScopes?: string }).requiredScopes === "string"
      ? String((coinbase as { requiredScopes?: string }).requiredScopes || "")
          .split(/[,\s]+/)
          .map((scope) => scope.trim().toLowerCase())
          .filter(Boolean)
      : current.requiredScopes
  const nextSyncStatus =
    coinbase.lastSyncStatus === "success" || coinbase.lastSyncStatus === "error" ? coinbase.lastSyncStatus : current.lastSyncStatus
  const nextSyncErrorCode =
    coinbase.lastSyncErrorCode === "expired_token" ||
    coinbase.lastSyncErrorCode === "permission_denied" ||
    coinbase.lastSyncErrorCode === "rate_limited" ||
    coinbase.lastSyncErrorCode === "coinbase_outage" ||
    coinbase.lastSyncErrorCode === "network" ||
    coinbase.lastSyncErrorCode === "unknown" ||
    coinbase.lastSyncErrorCode === "none"
      ? coinbase.lastSyncErrorCode
      : current.lastSyncErrorCode
  const explicitDisconnect = typeof coinbase.connected === "boolean" && coinbase.connected === false

  return {
    ...current,
    connected:
      (typeof coinbase.connected === "boolean" ? coinbase.connected : current.connected) &&
      nextApiKey.trim().length > 0 &&
      nextApiSecret.trim().length > 0,
    apiKey: explicitDisconnect ? "" : nextApiKey,
    apiSecret: explicitDisconnect ? "" : nextApiSecret,
    connectionMode: nextConnectionMode,
    requiredScopes: nextRequiredScopes.length > 0 ? nextRequiredScopes : current.requiredScopes,
    lastSyncAt: typeof coinbase.lastSyncAt === "string" ? coinbase.lastSyncAt.trim() : current.lastSyncAt,
    lastSyncStatus: nextSyncStatus,
    lastSyncErrorCode: nextSyncErrorCode,
    lastSyncErrorMessage:
      typeof coinbase.lastSyncErrorMessage === "string" ? coinbase.lastSyncErrorMessage.trim() : current.lastSyncErrorMessage,
    lastFreshnessMs:
      typeof coinbase.lastFreshnessMs === "number" && Number.isFinite(coinbase.lastFreshnessMs)
        ? Math.max(0, Math.floor(coinbase.lastFreshnessMs))
        : current.lastFreshnessMs,
    reportTimezone:
      typeof coinbase.reportTimezone === "string" && coinbase.reportTimezone.trim().length > 0
        ? coinbase.reportTimezone.trim()
        : current.reportTimezone,
    reportCurrency:
      typeof coinbase.reportCurrency === "string" && coinbase.reportCurrency.trim().length > 0
        ? coinbase.reportCurrency.trim().toUpperCase()
        : current.reportCurrency,
    reportCadence:
      coinbase.reportCadence === "weekly" || coinbase.reportCadence === "daily"
        ? coinbase.reportCadence
        : current.reportCadence,
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

function normalizeSpotifyInput(raw: unknown, current: SpotifyIntegrationConfig): SpotifyIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const spotify = raw as Partial<SpotifyIntegrationConfig> & { scopes?: string[] | string }
  const scopes = typeof spotify.scopes === "string"
    ? spotify.scopes.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : Array.isArray(spotify.scopes)
      ? spotify.scopes.map((scope) => String(scope).trim()).filter(Boolean)
      : current.scopes
  const nextOauthClientId =
    typeof spotify.oauthClientId === "string"
      ? spotify.oauthClientId.trim()
      : current.oauthClientId
  const nextAccess =
    typeof spotify.accessTokenEnc === "string"
      ? (spotify.accessTokenEnc.trim().length > 0 ? spotify.accessTokenEnc.trim() : current.accessTokenEnc)
      : current.accessTokenEnc
  const nextRefresh =
    typeof spotify.refreshTokenEnc === "string"
      ? (spotify.refreshTokenEnc.trim().length > 0 ? spotify.refreshTokenEnc.trim() : current.refreshTokenEnc)
      : current.refreshTokenEnc
  return {
    ...current,
    connected:
      (typeof spotify.connected === "boolean" ? spotify.connected : current.connected) &&
      nextOauthClientId.length > 0 &&
      (nextAccess.length > 0 || nextRefresh.length > 0),
    spotifyUserId: typeof spotify.spotifyUserId === "string" ? spotify.spotifyUserId.trim() : current.spotifyUserId,
    displayName: typeof spotify.displayName === "string" ? spotify.displayName.trim() : current.displayName,
    scopes,
    oauthClientId: nextOauthClientId,
    redirectUri: typeof spotify.redirectUri === "string" && spotify.redirectUri.trim().length > 0 ? spotify.redirectUri.trim() : current.redirectUri,
    accessTokenEnc: nextAccess,
    refreshTokenEnc: nextRefresh,
    tokenExpiry: typeof spotify.tokenExpiry === "number" ? spotify.tokenExpiry : current.tokenExpiry,
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

function normalizeGmailCalendarInput(raw: unknown, current: GmailCalendarIntegrationConfig): GmailCalendarIntegrationConfig {
  if (!raw || typeof raw !== "object") return current
  const gcalendar = raw as Partial<GmailCalendarIntegrationConfig>
  const scopes = Array.isArray(gcalendar.scopes)
    ? gcalendar.scopes.map((scope) => String(scope).trim()).filter(Boolean)
    : current.scopes
  const activeAccountId =
    typeof gcalendar.activeAccountId === "string" ? gcalendar.activeAccountId.trim().toLowerCase() : current.activeAccountId
  const accounts = Array.isArray(gcalendar.accounts)
    ? gcalendar.accounts
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
    connected: typeof gcalendar.connected === "boolean" ? gcalendar.connected : current.connected,
    email: typeof gcalendar.email === "string" ? gcalendar.email.trim() : current.email,
    scopes,
    accounts,
    activeAccountId,
    redirectUri:
      typeof gcalendar.redirectUri === "string" && gcalendar.redirectUri.trim().length > 0
        ? gcalendar.redirectUri.trim()
        : current.redirectUri,
    permissions: {
      ...current.permissions,
      ...(gcalendar.permissions || {}),
      allowCreate:
        typeof gcalendar.permissions?.allowCreate === "boolean"
          ? gcalendar.permissions.allowCreate
          : current.permissions.allowCreate,
      allowEdit:
        typeof gcalendar.permissions?.allowEdit === "boolean"
          ? gcalendar.permissions.allowEdit
          : current.permissions.allowEdit,
      allowDelete:
        typeof gcalendar.permissions?.allowDelete === "boolean"
          ? gcalendar.permissions.allowDelete
          : current.permissions.allowDelete,
    },
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
    discord: {
      ...config.discord,
      webhookUrls: [],
      webhookUrlsConfigured: config.discord.webhookUrls.length > 0,
      webhookUrlsMasked: config.discord.webhookUrls.map((url) => redactWebhookTarget(url)),
    },
    openai: {
      ...config.openai,
      apiKey: "",
      apiKeyConfigured: config.openai.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.openai.apiKey),
    },
    brave: {
      ...config.brave,
      apiKey: "",
      apiKeyConfigured: config.brave.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.brave.apiKey),
    },
    coinbase: {
      ...config.coinbase,
      apiKey: "",
      apiSecret: "",
      apiKeyConfigured: config.coinbase.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.coinbase.apiKey),
      apiSecretConfigured: config.coinbase.apiSecret.trim().length > 0,
      apiSecretMasked: maskSecret(config.coinbase.apiSecret),
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
    spotify: {
      connected: config.spotify.connected,
      spotifyUserId: config.spotify.spotifyUserId,
      displayName: config.spotify.displayName,
      scopes: config.spotify.scopes,
      oauthClientId: config.spotify.oauthClientId,
      redirectUri: config.spotify.redirectUri,
      tokenConfigured:
        config.spotify.refreshTokenEnc.trim().length > 0 ||
        config.spotify.accessTokenEnc.trim().length > 0,
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
    gcalendar: {
      connected: config.gcalendar.connected,
      email: config.gcalendar.email,
      scopes: config.gcalendar.scopes,
      permissions: {
        allowCreate: Boolean(config.gcalendar.permissions?.allowCreate),
        allowEdit: Boolean(config.gcalendar.permissions?.allowEdit),
        allowDelete: Boolean(config.gcalendar.permissions?.allowDelete),
      },
      accounts: config.gcalendar.accounts.map((account) => ({
        id: account.id,
        email: account.email,
        scopes: account.scopes,
        enabled: account.enabled,
        connectedAt: account.connectedAt,
        active: account.id === config.gcalendar.activeAccountId,
      })),
      activeAccountId: config.gcalendar.activeAccountId,
      redirectUri: config.gcalendar.redirectUri,
      tokenConfigured:
        config.gcalendar.accounts.some((account) => account.refreshTokenEnc.trim().length > 0 || account.accessTokenEnc.trim().length > 0) ||
        config.gcalendar.refreshTokenEnc.trim().length > 0 ||
        config.gcalendar.accessTokenEnc.trim().length > 0,
    },
    agents: toClientAgents(config),
  }
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const config = await loadIntegrationsConfig(verified)
  try {
    await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), verified.user.id, config)
  } catch (error) {
    console.warn("[integrations/config][GET] Failed to sync agent runtime snapshot:", error)
  }
  return NextResponse.json({ config: toClientConfig(config) })
}

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = (await req.json()) as Partial<IntegrationsConfig> & {
      telegram?: Partial<TelegramIntegrationConfig> & { chatIds?: string[] | string }
      discord?: Partial<DiscordIntegrationConfig> & { webhookUrls?: string[] | string }
      brave?: Partial<BraveIntegrationConfig>
      coinbase?: Partial<CoinbaseIntegrationConfig>
      openai?: Partial<OpenAIIntegrationConfig>
      claude?: Partial<ClaudeIntegrationConfig>
      grok?: Partial<GrokIntegrationConfig>
      gemini?: Partial<GeminiIntegrationConfig>
      spotify?: Partial<SpotifyIntegrationConfig> & { scopes?: string[] | string }
      gmail?: Partial<GmailIntegrationConfig> & { scopes?: string[] | string }
      gcalendar?: Partial<GmailCalendarIntegrationConfig>
      activeLlmProvider?: LlmProvider
    }
    const current = await loadIntegrationsConfig(verified)
    const wasCoinbaseConnected = Boolean(current.coinbase.connected)
    const hasTelegramPatch = Object.prototype.hasOwnProperty.call(body, "telegram")
    const hasDiscordPatch = Object.prototype.hasOwnProperty.call(body, "discord")
    const hasBravePatch = Object.prototype.hasOwnProperty.call(body, "brave")
    const hasCoinbasePatch = Object.prototype.hasOwnProperty.call(body, "coinbase")
    const hasOpenAIPatch = Object.prototype.hasOwnProperty.call(body, "openai")
    const hasClaudePatch = Object.prototype.hasOwnProperty.call(body, "claude")
    const hasGrokPatch = Object.prototype.hasOwnProperty.call(body, "grok")
    const hasGeminiPatch = Object.prototype.hasOwnProperty.call(body, "gemini")
    const hasSpotifyPatch = Object.prototype.hasOwnProperty.call(body, "spotify")
    const hasGmailPatch = Object.prototype.hasOwnProperty.call(body, "gmail")
    const hasGcalendarPatch = Object.prototype.hasOwnProperty.call(body, "gcalendar")
    const hasActiveProviderPatch = Object.prototype.hasOwnProperty.call(body, "activeLlmProvider")
    const hasAgentsPatch = Object.prototype.hasOwnProperty.call(body, "agents")
    const telegram = hasTelegramPatch ? normalizeTelegramInput(body.telegram, current.telegram) : current.telegram
    const discord = hasDiscordPatch ? normalizeDiscordInput(body.discord, current.discord) : current.discord
    const brave = hasBravePatch ? normalizeBraveInput(body.brave, current.brave) : current.brave
    const coinbase = hasCoinbasePatch ? normalizeCoinbaseInput(body.coinbase, current.coinbase) : current.coinbase
    const shouldValidateCoinbaseApiPair =
      hasCoinbasePatch &&
      coinbase.connectionMode === "api_key_pair" &&
      (coinbase.connected || typeof body.coinbase?.apiKey === "string" || typeof body.coinbase?.apiSecret === "string")
    let coinbaseCredentialMode: CoinbaseCredentialMode = detectCoinbaseCredentialMode(coinbase.apiSecret)
    if (shouldValidateCoinbaseApiPair) {
      const validation = validateCoinbaseApiKeyPair(coinbase)
      if (!validation.ok) {
        return NextResponse.json({ error: validation.message }, { status: 400 })
      }
      coinbaseCredentialMode = validation.credentialMode
    }
    const openai = hasOpenAIPatch ? normalizeOpenAIInput(body.openai, current.openai) : current.openai
    const claude = hasClaudePatch ? normalizeClaudeInput(body.claude, current.claude) : current.claude
    const grok = hasGrokPatch ? normalizeGrokInput(body.grok, current.grok) : current.grok
    const gemini = hasGeminiPatch ? normalizeGeminiInput(body.gemini, current.gemini) : current.gemini
    const spotify = hasSpotifyPatch ? normalizeSpotifyInput(body.spotify, current.spotify) : current.spotify
    const gmail = hasGmailPatch ? normalizeGmailInput(body.gmail, current.gmail) : current.gmail
    const gcalendar = hasGcalendarPatch ? normalizeGmailCalendarInput(body.gcalendar, current.gcalendar) : current.gcalendar
    const activeLlmProvider = hasActiveProviderPatch
      ? normalizeActiveLlmProvider(body.activeLlmProvider, current.activeLlmProvider)
      : current.activeLlmProvider
    const next = await updateIntegrationsConfig({
      telegram,
      discord,
      brave,
      coinbase,
      openai,
      claude,
      grok,
      gemini,
      spotify,
      gmail,
      gcalendar,
      activeLlmProvider,
      agents: hasAgentsPatch ? (body.agents ?? current.agents) : current.agents,
    }, verified)
    if (wasCoinbaseConnected && !next.coinbase.connected) {
      const userContextId = String(verified.user.id || "").trim().toLowerCase()
      if (userContextId) {
        const store = await createCoinbaseStore(userContextId)
        try {
          const purged = store.purgeUserData(userContextId)
          store.appendAuditLog({
            userContextId,
            eventType: "coinbase.disconnect.secure_delete",
            status: "ok",
            details: purged,
          })
        } finally {
          store.close()
        }
      }
    }
    try {
      await syncAgentRuntimeIntegrationsSnapshot(resolveWorkspaceRoot(), verified.user.id, next)
    } catch (error) {
      console.warn("[integrations/config][PATCH] Failed to sync agent runtime snapshot:", error)
    }
    return NextResponse.json({
      config: toClientConfig(next),
      diagnostics: {
        coinbase: {
          credentialMode: coinbaseCredentialMode,
        },
      },
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (/Invalid Discord webhook URL/i.test(error.message) ||
        /Discord cannot be enabled/i.test(error.message) ||
        /Discord webhook count exceeds cap/i.test(error.message))
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update integrations config" },
      { status: 500 },
    )
  }
}
