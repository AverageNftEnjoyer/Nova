import "server-only"

import { decryptSecret, decryptSecretWithMeta, encryptSecret } from "@/lib/security/encryption"
import { getRuntimeTimezone } from "@/lib/shared/timezone"
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface TelegramIntegrationConfig {
  connected: boolean
  botToken: string
  chatIds: string[]
}

export interface DiscordIntegrationConfig {
  connected: boolean
  webhookUrls: string[]
}

export interface BraveIntegrationConfig {
  connected: boolean
  apiKey: string
}

export type CoinbaseConnectionMode = "api_key_pair" | "oauth"
export type CoinbaseSyncStatus = "never" | "success" | "error"
export type CoinbaseSyncErrorCode =
  | "none"
  | "expired_token"
  | "permission_denied"
  | "rate_limited"
  | "coinbase_outage"
  | "network"
  | "unknown"
export type CoinbaseReportCadence = "daily" | "weekly"

export interface CoinbaseIntegrationConfig {
  connected: boolean
  apiKey: string
  apiSecret: string
  connectionMode: CoinbaseConnectionMode
  requiredScopes: string[]
  lastSyncAt: string
  lastSyncStatus: CoinbaseSyncStatus
  lastSyncErrorCode: CoinbaseSyncErrorCode
  lastSyncErrorMessage: string
  lastFreshnessMs: number
  reportTimezone: string
  reportCurrency: string
  reportCadence: CoinbaseReportCadence
}

export interface OpenAIIntegrationConfig {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface ClaudeIntegrationConfig {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface GrokIntegrationConfig {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface GeminiIntegrationConfig {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface SpotifyIntegrationConfig {
  connected: boolean
  spotifyUserId: string
  displayName: string
  scopes: string[]
  oauthClientId: string
  redirectUri: string
  accessTokenEnc: string
  refreshTokenEnc: string
  tokenExpiry: number
}

export interface GmailIntegrationConfig {
  connected: boolean
  email: string
  scopes: string[]
  accounts: Array<{
    id: string
    email: string
    scopes: string[]
    enabled: boolean
    accessTokenEnc: string
    refreshTokenEnc: string
    tokenExpiry: number
    connectedAt: string
  }>
  activeAccountId: string
  oauthClientId: string
  oauthClientSecret: string
  redirectUri: string
  accessTokenEnc: string
  refreshTokenEnc: string
  tokenExpiry: number
}

export interface GmailCalendarIntegrationConfig {
  connected: boolean
  email: string
  scopes: string[]
  permissions: {
    allowCreate: boolean
    allowEdit: boolean
    allowDelete: boolean
  }
  accounts: Array<{
    id: string
    email: string
    scopes: string[]
    enabled: boolean
    accessTokenEnc: string
    refreshTokenEnc: string
    tokenExpiry: number
    connectedAt: string
  }>
  activeAccountId: string
  redirectUri: string
  accessTokenEnc: string
  refreshTokenEnc: string
  tokenExpiry: number
}

export type LlmProvider = "openai" | "claude" | "grok" | "gemini"

export interface AgentIntegrationConfig {
  connected: boolean
  apiKey: string
  endpoint: string
}

export interface IntegrationsConfig {
  telegram: TelegramIntegrationConfig
  discord: DiscordIntegrationConfig
  brave: BraveIntegrationConfig
  coinbase: CoinbaseIntegrationConfig
  openai: OpenAIIntegrationConfig
  claude: ClaudeIntegrationConfig
  grok: GrokIntegrationConfig
  gemini: GeminiIntegrationConfig
  spotify: SpotifyIntegrationConfig
  gmail: GmailIntegrationConfig
  gcalendar: GmailCalendarIntegrationConfig
  activeLlmProvider: LlmProvider
  agents: Record<string, AgentIntegrationConfig>
  updatedAt: string
}

const INTEGRATIONS_TABLE = "integration_configs"

export type IntegrationsStoreScope =
  | {
      userId?: string | null
      accessToken?: string | null
      client?: SupabaseClient | null
      user?: { id?: string | null } | null
      allowServiceRole?: boolean
      serviceRoleReason?: "scheduler" | "gmail-oauth-callback" | "gmail-calendar-oauth-callback" | "spotify-oauth-callback"
    }
  | null
  | undefined

const DEFAULT_CONFIG: IntegrationsConfig = {
  telegram: {
    connected: true,
    botToken: "",
    chatIds: [],
  },
  discord: {
    connected: false,
    webhookUrls: [],
  },
  brave: {
    connected: false,
    apiKey: "",
  },
  coinbase: {
    connected: false,
    apiKey: "",
    apiSecret: "",
    connectionMode: "api_key_pair",
    requiredScopes: ["portfolio:view", "accounts:read", "transactions:read"],
    lastSyncAt: "",
    lastSyncStatus: "never",
    lastSyncErrorCode: "none",
    lastSyncErrorMessage: "",
    lastFreshnessMs: 0,
    reportTimezone: getRuntimeTimezone(),
    reportCurrency: "USD",
    reportCadence: "daily",
  },
  openai: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
  },
  claude: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
  },
  grok: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4-0709",
  },
  gemini: {
    connected: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-pro",
  },
  spotify: {
    connected: false,
    spotifyUserId: "",
    displayName: "",
    scopes: [],
    oauthClientId: "",
    redirectUri: "http://localhost:3000/api/integrations/spotify/callback",
    accessTokenEnc: "",
    refreshTokenEnc: "",
    tokenExpiry: 0,
  },
  gmail: {
    connected: false,
    email: "",
    scopes: [],
    accounts: [],
    activeAccountId: "",
    oauthClientId: "",
    oauthClientSecret: "",
    redirectUri: "http://localhost:3000/api/integrations/gmail/callback",
    accessTokenEnc: "",
    refreshTokenEnc: "",
    tokenExpiry: 0,
  },
  gcalendar: {
    connected: false,
    email: "",
    scopes: [],
    permissions: {
      allowCreate: true,
      allowEdit: true,
      allowDelete: false,
    },
    accounts: [],
    activeAccountId: "",
    redirectUri: "http://localhost:3000/api/integrations/gmail-calendar/callback",
    accessTokenEnc: "",
    refreshTokenEnc: "",
    tokenExpiry: 0,
  },
  activeLlmProvider: "openai",
  agents: {},
  updatedAt: new Date().toISOString(),
}

function unwrapStoredSecret(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""
  const decrypted = decryptSecret(raw)
  if (decrypted) return decrypted
  // If this looks like our encrypted envelope but cannot be decrypted
  // (for example key rotation/mismatch), never pass ciphertext through as a secret.
  const parts = raw.split(".")
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0], "base64")
      const tag = Buffer.from(parts[1], "base64")
      const enc = Buffer.from(parts[2], "base64")
      const looksEncryptedEnvelope = iv.length === 12 && tag.length === 16 && enc.length > 0
      if (looksEncryptedEnvelope) return ""
    } catch {
      // fall through to legacy plaintext handling
    }
  }
  return raw
}

function wrapStoredSecret(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return ""
  const decrypted = decryptSecretWithMeta(raw)
  if (decrypted.value) {
    // Opportunistically re-encrypt old-key envelopes with the current primary key.
    if (decrypted.keyIndex > 0) return encryptSecret(decrypted.value)
    return raw
  }
  // Preserve already-encrypted envelopes even if decrypt fails in this process.
  // This avoids nesting ciphertext inside new ciphertext.
  const parts = raw.split(".")
  if (parts.length === 3) {
    try {
      const iv = Buffer.from(parts[0], "base64")
      const tag = Buffer.from(parts[1], "base64")
      const enc = Buffer.from(parts[2], "base64")
      if (iv.length === 12 && tag.length === 16 && enc.length > 0) return raw
    } catch {
      // not an envelope, continue to encrypt
    }
  }
  return encryptSecret(raw)
}

function normalizeConfig(raw: Partial<IntegrationsConfig> | null | undefined): IntegrationsConfig {
  const rawAgents = raw?.agents && typeof raw.agents === "object"
    ? raw.agents
    : {}
  const normalizedAgents = Object.entries(rawAgents).reduce<Record<string, AgentIntegrationConfig>>((acc, [key, value]) => {
    if (!value || typeof value !== "object") return acc
    const id = String(key || "").trim()
    if (!id) return acc
    const agent = value as Partial<AgentIntegrationConfig>
    acc[id] = {
      connected: Boolean(agent.connected),
      apiKey: unwrapStoredSecret(agent.apiKey),
      endpoint: typeof agent.endpoint === "string" ? agent.endpoint.trim() : "",
    }
    return acc
  }, {})

  const rawGmailAccounts = Array.isArray(raw?.gmail?.accounts)
    ? raw!.gmail!.accounts
    : []
  const normalizedGmailAccounts = rawGmailAccounts
    .map((account) => {
      if (!account || typeof account !== "object") return null
      const id = String((account as { id?: string }).id || "").trim()
      const email = String((account as { email?: string }).email || "").trim()
      if (!id || !email) return null
      const scopes = Array.isArray((account as { scopes?: string[] }).scopes)
        ? (account as { scopes: string[] }).scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : []
      const connectedAt = String((account as { connectedAt?: string }).connectedAt || "").trim() || new Date().toISOString()
      return {
        id,
        email,
        scopes,
        enabled: typeof (account as { enabled?: boolean }).enabled === "boolean" ? Boolean((account as { enabled?: boolean }).enabled) : true,
        accessTokenEnc: wrapStoredSecret((account as { accessTokenEnc?: string }).accessTokenEnc),
        refreshTokenEnc: wrapStoredSecret((account as { refreshTokenEnc?: string }).refreshTokenEnc),
        tokenExpiry: Number((account as { tokenExpiry?: number }).tokenExpiry || 0),
        connectedAt,
      }
    })
    .filter((account): account is NonNullable<typeof account> => Boolean(account))

  const legacyEmail = raw?.gmail?.email?.trim() ?? ""
  const legacyRefresh = wrapStoredSecret(raw?.gmail?.refreshTokenEnc)
  const legacyAccess = wrapStoredSecret(raw?.gmail?.accessTokenEnc)
  const hasLegacyTokens = legacyRefresh.length > 0 || legacyAccess.length > 0
  const hasLegacyAccount = legacyEmail.length > 0 || hasLegacyTokens
  if (normalizedGmailAccounts.length === 0 && hasLegacyAccount) {
    normalizedGmailAccounts.push({
      id: legacyEmail.toLowerCase() || "gmail-primary",
      email: legacyEmail || "primary@gmail.local",
      scopes: Array.isArray(raw?.gmail?.scopes)
        ? raw!.gmail!.scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : [],
      enabled: true,
      accessTokenEnc: legacyAccess,
      refreshTokenEnc: legacyRefresh,
      tokenExpiry: typeof raw?.gmail?.tokenExpiry === "number" ? raw.gmail.tokenExpiry : 0,
      connectedAt: new Date().toISOString(),
    })
  }

  const enabledAccounts = normalizedGmailAccounts.filter((account) => account.enabled)
  const activeAccountId = String(raw?.gmail?.activeAccountId || "").trim()
  const selectedAccount =
    enabledAccounts.find((account) => account.id === activeAccountId) ||
    enabledAccounts[0] ||
    normalizedGmailAccounts.find((account) => account.id === activeAccountId) ||
    normalizedGmailAccounts[0]

  const normalizedTelegramBotToken = unwrapStoredSecret(raw?.telegram?.botToken)

  return {
    telegram: {
      connected: (raw?.telegram?.connected ?? DEFAULT_CONFIG.telegram.connected) && normalizedTelegramBotToken.trim().length > 0,
      botToken: normalizedTelegramBotToken,
      chatIds: Array.isArray(raw?.telegram?.chatIds)
        ? raw!.telegram!.chatIds.map((id) => String(id).trim()).filter(Boolean)
        : [],
    },
    discord: {
      connected: raw?.discord?.connected ?? DEFAULT_CONFIG.discord.connected,
      webhookUrls: Array.isArray(raw?.discord?.webhookUrls)
        ? raw.discord.webhookUrls.map((url) => unwrapStoredSecret(url)).map((url) => String(url).trim()).filter(Boolean)
        : [],
    },
    brave: {
      connected: raw?.brave?.connected ?? DEFAULT_CONFIG.brave.connected,
      apiKey: unwrapStoredSecret(raw?.brave?.apiKey),
    },
    coinbase: {
      connected: raw?.coinbase?.connected ?? DEFAULT_CONFIG.coinbase.connected,
      apiKey: unwrapStoredSecret(raw?.coinbase?.apiKey),
      apiSecret: unwrapStoredSecret(raw?.coinbase?.apiSecret),
      connectionMode: raw?.coinbase?.connectionMode === "oauth" ? "oauth" : "api_key_pair",
      requiredScopes: Array.isArray(raw?.coinbase?.requiredScopes)
        ? raw!.coinbase!.requiredScopes.map((scope) => String(scope).trim().toLowerCase()).filter(Boolean)
        : DEFAULT_CONFIG.coinbase.requiredScopes,
      lastSyncAt: typeof raw?.coinbase?.lastSyncAt === "string" ? raw.coinbase.lastSyncAt : "",
      lastSyncStatus:
        raw?.coinbase?.lastSyncStatus === "success" || raw?.coinbase?.lastSyncStatus === "error"
          ? raw.coinbase.lastSyncStatus
          : "never",
      lastSyncErrorCode:
        raw?.coinbase?.lastSyncErrorCode === "expired_token" ||
        raw?.coinbase?.lastSyncErrorCode === "permission_denied" ||
        raw?.coinbase?.lastSyncErrorCode === "rate_limited" ||
        raw?.coinbase?.lastSyncErrorCode === "coinbase_outage" ||
        raw?.coinbase?.lastSyncErrorCode === "network" ||
        raw?.coinbase?.lastSyncErrorCode === "unknown"
          ? raw.coinbase.lastSyncErrorCode
          : "none",
      lastSyncErrorMessage: typeof raw?.coinbase?.lastSyncErrorMessage === "string" ? raw.coinbase.lastSyncErrorMessage : "",
      lastFreshnessMs: typeof raw?.coinbase?.lastFreshnessMs === "number" ? raw.coinbase.lastFreshnessMs : 0,
      reportTimezone:
        typeof raw?.coinbase?.reportTimezone === "string" && raw.coinbase.reportTimezone.trim().length > 0
          ? raw.coinbase.reportTimezone.trim()
          : DEFAULT_CONFIG.coinbase.reportTimezone,
      reportCurrency:
        typeof raw?.coinbase?.reportCurrency === "string" && raw.coinbase.reportCurrency.trim().length > 0
          ? raw.coinbase.reportCurrency.trim().toUpperCase()
          : DEFAULT_CONFIG.coinbase.reportCurrency,
      reportCadence:
        raw?.coinbase?.reportCadence === "weekly" || raw?.coinbase?.reportCadence === "daily"
          ? raw.coinbase.reportCadence
          : DEFAULT_CONFIG.coinbase.reportCadence,
    },
    openai: {
      connected: raw?.openai?.connected ?? DEFAULT_CONFIG.openai.connected,
      apiKey: unwrapStoredSecret(raw?.openai?.apiKey),
      baseUrl: raw?.openai?.baseUrl?.trim() || DEFAULT_CONFIG.openai.baseUrl,
      defaultModel: raw?.openai?.defaultModel?.trim() || DEFAULT_CONFIG.openai.defaultModel,
    },
    claude: {
      connected: raw?.claude?.connected ?? DEFAULT_CONFIG.claude.connected,
      apiKey: unwrapStoredSecret(raw?.claude?.apiKey),
      baseUrl: raw?.claude?.baseUrl?.trim() || DEFAULT_CONFIG.claude.baseUrl,
      defaultModel: raw?.claude?.defaultModel?.trim() || DEFAULT_CONFIG.claude.defaultModel,
    },
    grok: {
      connected: raw?.grok?.connected ?? DEFAULT_CONFIG.grok.connected,
      apiKey: unwrapStoredSecret(raw?.grok?.apiKey),
      baseUrl: raw?.grok?.baseUrl?.trim() || DEFAULT_CONFIG.grok.baseUrl,
      defaultModel: raw?.grok?.defaultModel?.trim() || DEFAULT_CONFIG.grok.defaultModel,
    },
    gemini: {
      connected: raw?.gemini?.connected ?? DEFAULT_CONFIG.gemini.connected,
      apiKey: unwrapStoredSecret(raw?.gemini?.apiKey),
      baseUrl: raw?.gemini?.baseUrl?.trim() || DEFAULT_CONFIG.gemini.baseUrl,
      defaultModel: raw?.gemini?.defaultModel?.trim() || DEFAULT_CONFIG.gemini.defaultModel,
    },
    spotify: {
      connected:
        (raw?.spotify?.connected ?? DEFAULT_CONFIG.spotify.connected) &&
        String(raw?.spotify?.oauthClientId || "").trim().length > 0 &&
        (
          wrapStoredSecret(raw?.spotify?.refreshTokenEnc).length > 0 ||
          wrapStoredSecret(raw?.spotify?.accessTokenEnc).length > 0
        ),
      spotifyUserId: String(raw?.spotify?.spotifyUserId || "").trim(),
      displayName: String(raw?.spotify?.displayName || "").trim(),
      scopes: Array.isArray(raw?.spotify?.scopes)
        ? raw!.spotify!.scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : [],
      oauthClientId: String(raw?.spotify?.oauthClientId || "").trim(),
      redirectUri: String(raw?.spotify?.redirectUri || "").trim() || DEFAULT_CONFIG.spotify.redirectUri,
      accessTokenEnc: wrapStoredSecret(raw?.spotify?.accessTokenEnc),
      refreshTokenEnc: wrapStoredSecret(raw?.spotify?.refreshTokenEnc),
      tokenExpiry: typeof raw?.spotify?.tokenExpiry === "number" ? raw.spotify.tokenExpiry : 0,
    },
    gmail: {
      connected: (raw?.gmail?.connected ?? DEFAULT_CONFIG.gmail.connected) && enabledAccounts.length > 0,
      email: selectedAccount?.email || legacyEmail,
      scopes: selectedAccount?.scopes || (
        Array.isArray(raw?.gmail?.scopes)
          ? raw!.gmail!.scopes.map((scope) => String(scope).trim()).filter(Boolean)
          : []
      ),
      accounts: normalizedGmailAccounts,
      activeAccountId: selectedAccount?.id || "",
      oauthClientId: raw?.gmail?.oauthClientId?.trim() ?? "",
      oauthClientSecret: unwrapStoredSecret(raw?.gmail?.oauthClientSecret),
      redirectUri: raw?.gmail?.redirectUri?.trim() || DEFAULT_CONFIG.gmail.redirectUri,
      accessTokenEnc: selectedAccount?.accessTokenEnc || legacyAccess,
      refreshTokenEnc: selectedAccount?.refreshTokenEnc || legacyRefresh,
      tokenExpiry: selectedAccount?.tokenExpiry || (typeof raw?.gmail?.tokenExpiry === "number" ? raw.gmail.tokenExpiry : 0),
    },
    gcalendar: (() => {
      const rawGcalAccounts = Array.isArray(raw?.gcalendar?.accounts) ? raw!.gcalendar!.accounts : []
      const gcalAccounts = rawGcalAccounts
        .map((account) => {
          if (!account || typeof account !== "object") return null
          const id = String((account as { id?: string }).id || "").trim()
          const email = String((account as { email?: string }).email || "").trim()
          if (!id || !email) return null
          return {
            id,
            email,
            scopes: Array.isArray((account as { scopes?: string[] }).scopes)
              ? (account as { scopes: string[] }).scopes.map((s) => String(s).trim()).filter(Boolean)
              : [],
            enabled: typeof (account as { enabled?: boolean }).enabled === "boolean" ? Boolean((account as { enabled?: boolean }).enabled) : true,
            accessTokenEnc: wrapStoredSecret((account as { accessTokenEnc?: string }).accessTokenEnc),
            refreshTokenEnc: wrapStoredSecret((account as { refreshTokenEnc?: string }).refreshTokenEnc),
            tokenExpiry: Number((account as { tokenExpiry?: number }).tokenExpiry || 0),
            connectedAt: String((account as { connectedAt?: string }).connectedAt || "").trim() || new Date().toISOString(),
          }
        })
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
      const gcalEnabledAccounts = gcalAccounts.filter((a) => a.enabled)
      const gcalActiveId = String(raw?.gcalendar?.activeAccountId || "").trim()
      const gcalSelected =
        gcalEnabledAccounts.find((a) => a.id === gcalActiveId) ||
        gcalEnabledAccounts[0] ||
        gcalAccounts.find((a) => a.id === gcalActiveId) ||
        gcalAccounts[0]
      return {
        connected: (raw?.gcalendar?.connected ?? false) && gcalEnabledAccounts.length > 0,
        email: gcalSelected?.email || "",
        scopes: gcalSelected?.scopes || [],
        permissions: {
          allowCreate: typeof raw?.gcalendar?.permissions?.allowCreate === "boolean"
            ? raw.gcalendar.permissions.allowCreate
            : DEFAULT_CONFIG.gcalendar.permissions.allowCreate,
          allowEdit: typeof raw?.gcalendar?.permissions?.allowEdit === "boolean"
            ? raw.gcalendar.permissions.allowEdit
            : DEFAULT_CONFIG.gcalendar.permissions.allowEdit,
          allowDelete: typeof raw?.gcalendar?.permissions?.allowDelete === "boolean"
            ? raw.gcalendar.permissions.allowDelete
            : DEFAULT_CONFIG.gcalendar.permissions.allowDelete,
        },
        accounts: gcalAccounts,
        activeAccountId: gcalSelected?.id || "",
        redirectUri: raw?.gcalendar?.redirectUri?.trim() || DEFAULT_CONFIG.gcalendar.redirectUri,
        accessTokenEnc: gcalSelected?.accessTokenEnc || wrapStoredSecret(raw?.gcalendar?.accessTokenEnc),
        refreshTokenEnc: gcalSelected?.refreshTokenEnc || wrapStoredSecret(raw?.gcalendar?.refreshTokenEnc),
        tokenExpiry: gcalSelected?.tokenExpiry || (typeof raw?.gcalendar?.tokenExpiry === "number" ? raw.gcalendar.tokenExpiry : 0),
      }
    })(),
    activeLlmProvider:
      raw?.activeLlmProvider === "claude" || raw?.activeLlmProvider === "openai" || raw?.activeLlmProvider === "grok" || raw?.activeLlmProvider === "gemini"
        ? raw.activeLlmProvider
        : DEFAULT_CONFIG.activeLlmProvider,
    agents: normalizedAgents,
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  }
}

function normalizeStoreScope(scope?: IntegrationsStoreScope): { userId: string; client: SupabaseClient } | null {
  const userIdRaw =
    (typeof scope?.userId === "string" ? scope.userId : "") ||
    (typeof scope?.user?.id === "string" ? scope.user.id : "")
  const userId = String(userIdRaw || "").trim()
  if (!userId) return null
  if (scope?.client) return { userId, client: scope.client }
  const accessToken = String(scope?.accessToken || "").trim()
  if (accessToken) return { userId, client: createSupabaseServerClient(accessToken) }
  if (scope?.allowServiceRole) {
    const reason = String(scope.serviceRoleReason || "").trim()
    if (
      reason !== "scheduler" &&
      reason !== "gmail-oauth-callback" &&
      reason !== "gmail-calendar-oauth-callback" &&
      reason !== "spotify-oauth-callback"
    ) {
      throw new Error("Service-role integrations access requires an approved internal reason.")
    }
    return { userId, client: createSupabaseAdminClient() }
  }
  throw new Error("Missing scoped Supabase auth client/token for integrations access.")
}

function assertScopedIntegrationsAccess(
  normalizedScope: { userId: string; client: SupabaseClient } | null,
): asserts normalizedScope is { userId: string; client: SupabaseClient } {
  if (normalizedScope) return
  throw new Error("Scoped user context is required for integrations config access.")
}

function toEncryptedStoreConfig(config: IntegrationsConfig): IntegrationsConfig {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: wrapStoredSecret(config.telegram.botToken),
    },
    discord: {
      ...config.discord,
      webhookUrls: config.discord.webhookUrls.map((url) => wrapStoredSecret(url)).filter(Boolean),
    },
    openai: {
      ...config.openai,
      apiKey: wrapStoredSecret(config.openai.apiKey),
    },
    brave: {
      ...config.brave,
      apiKey: wrapStoredSecret(config.brave.apiKey),
    },
    coinbase: {
      ...config.coinbase,
      apiKey: wrapStoredSecret(config.coinbase.apiKey),
      apiSecret: wrapStoredSecret(config.coinbase.apiSecret),
    },
    claude: {
      ...config.claude,
      apiKey: wrapStoredSecret(config.claude.apiKey),
    },
    grok: {
      ...config.grok,
      apiKey: wrapStoredSecret(config.grok.apiKey),
    },
    gemini: {
      ...config.gemini,
      apiKey: wrapStoredSecret(config.gemini.apiKey),
    },
    spotify: {
      ...config.spotify,
      accessTokenEnc: wrapStoredSecret(config.spotify.accessTokenEnc),
      refreshTokenEnc: wrapStoredSecret(config.spotify.refreshTokenEnc),
    },
    gmail: {
      ...config.gmail,
      accounts: config.gmail.accounts.map((account) => ({
        ...account,
        accessTokenEnc: wrapStoredSecret(account.accessTokenEnc),
        refreshTokenEnc: wrapStoredSecret(account.refreshTokenEnc),
      })),
      oauthClientSecret: wrapStoredSecret(config.gmail.oauthClientSecret),
    },
    gcalendar: {
      ...config.gcalendar,
      accounts: config.gcalendar.accounts.map((account) => ({
        ...account,
        accessTokenEnc: wrapStoredSecret(account.accessTokenEnc),
        refreshTokenEnc: wrapStoredSecret(account.refreshTokenEnc),
      })),
      accessTokenEnc: wrapStoredSecret(config.gcalendar.accessTokenEnc),
      refreshTokenEnc: wrapStoredSecret(config.gcalendar.refreshTokenEnc),
    },
    agents: Object.fromEntries(
      Object.entries(config.agents).map(([id, agent]) => [
        id,
        {
          ...agent,
          apiKey: wrapStoredSecret(agent.apiKey),
        },
      ]),
    ),
  }
}

function mergeIntegrationsConfig(current: IntegrationsConfig, partial: Partial<IntegrationsConfig>): IntegrationsConfig {
  return normalizeConfig({
    ...current,
    ...partial,
    telegram: {
      ...current.telegram,
      ...(partial.telegram || {}),
    },
    discord: {
      ...current.discord,
      ...(partial.discord || {}),
    },
    openai: {
      ...current.openai,
      ...(partial.openai || {}),
    },
    brave: {
      ...current.brave,
      ...(partial.brave || {}),
    },
    coinbase: {
      ...current.coinbase,
      ...(partial.coinbase || {}),
    },
    claude: {
      ...current.claude,
      ...(partial.claude || {}),
    },
    grok: {
      ...current.grok,
      ...(partial.grok || {}),
    },
    gemini: {
      ...current.gemini,
      ...(partial.gemini || {}),
    },
    spotify: {
      ...current.spotify,
      ...(partial.spotify || {}),
      scopes: Array.isArray(partial.spotify?.scopes)
        ? partial.spotify.scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : current.spotify.scopes,
      tokenExpiry: typeof partial.spotify?.tokenExpiry === "number" ? partial.spotify.tokenExpiry : current.spotify.tokenExpiry,
    },
    gmail: {
      ...current.gmail,
      ...(partial.gmail || {}),
      accounts: Array.isArray(partial.gmail?.accounts)
        ? partial.gmail.accounts
            .map((account) => ({
              id: String(account?.id || "").trim(),
              email: String(account?.email || "").trim(),
              scopes: Array.isArray(account?.scopes) ? account.scopes.map((scope) => String(scope).trim()).filter(Boolean) : [],
              enabled: typeof account?.enabled === "boolean" ? account.enabled : true,
              accessTokenEnc: String(account?.accessTokenEnc || "").trim(),
              refreshTokenEnc: String(account?.refreshTokenEnc || "").trim(),
              tokenExpiry: Number(account?.tokenExpiry || 0),
              connectedAt: String(account?.connectedAt || "").trim() || new Date().toISOString(),
            }))
            .filter((account) => account.id && account.email)
        : current.gmail.accounts,
      scopes: Array.isArray(partial.gmail?.scopes)
        ? partial.gmail.scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : current.gmail.scopes,
      tokenExpiry: typeof partial.gmail?.tokenExpiry === "number" ? partial.gmail.tokenExpiry : current.gmail.tokenExpiry,
    },
    gcalendar: {
      ...current.gcalendar,
      ...(partial.gcalendar || {}),
      permissions: {
        ...current.gcalendar.permissions,
        ...(partial.gcalendar?.permissions || {}),
        allowCreate: typeof partial.gcalendar?.permissions?.allowCreate === "boolean"
          ? partial.gcalendar.permissions.allowCreate
          : current.gcalendar.permissions.allowCreate,
        allowEdit: typeof partial.gcalendar?.permissions?.allowEdit === "boolean"
          ? partial.gcalendar.permissions.allowEdit
          : current.gcalendar.permissions.allowEdit,
        allowDelete: typeof partial.gcalendar?.permissions?.allowDelete === "boolean"
          ? partial.gcalendar.permissions.allowDelete
          : current.gcalendar.permissions.allowDelete,
      },
      accounts: Array.isArray(partial.gcalendar?.accounts)
        ? partial.gcalendar.accounts
            .map((account) => ({
              id: String(account?.id || "").trim(),
              email: String(account?.email || "").trim(),
              scopes: Array.isArray(account?.scopes) ? account.scopes.map((s) => String(s).trim()).filter(Boolean) : [],
              enabled: typeof account?.enabled === "boolean" ? account.enabled : true,
              accessTokenEnc: String(account?.accessTokenEnc || "").trim(),
              refreshTokenEnc: String(account?.refreshTokenEnc || "").trim(),
              tokenExpiry: Number(account?.tokenExpiry || 0),
              connectedAt: String(account?.connectedAt || "").trim() || new Date().toISOString(),
            }))
            .filter((account) => account.id && account.email)
        : current.gcalendar.accounts,
      scopes: Array.isArray(partial.gcalendar?.scopes)
        ? partial.gcalendar.scopes.map((s) => String(s).trim()).filter(Boolean)
        : current.gcalendar.scopes,
      tokenExpiry: typeof partial.gcalendar?.tokenExpiry === "number" ? partial.gcalendar.tokenExpiry : current.gcalendar.tokenExpiry,
    },
    activeLlmProvider:
      partial.activeLlmProvider === "claude" || partial.activeLlmProvider === "openai" || partial.activeLlmProvider === "grok" || partial.activeLlmProvider === "gemini"
        ? partial.activeLlmProvider
        : current.activeLlmProvider,
    agents: {
      ...current.agents,
      ...(partial.agents || {}),
    },
    updatedAt: new Date().toISOString(),
  })
}

export async function loadIntegrationsConfig(scope?: IntegrationsStoreScope): Promise<IntegrationsConfig> {
  const normalizedScope = normalizeStoreScope(scope)
  assertScopedIntegrationsAccess(normalizedScope)
  const { userId, client } = normalizedScope
  const { data, error } = await client
    .from(INTEGRATIONS_TABLE)
    .select("config")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load integrations config: ${error.message}`)
  const raw = (data?.config && typeof data.config === "object" ? (data.config as Partial<IntegrationsConfig>) : null) || null
  if (!raw) return normalizeConfig(DEFAULT_CONFIG)
  return normalizeConfig(raw)
}

export async function saveIntegrationsConfig(config: IntegrationsConfig, scope?: IntegrationsStoreScope): Promise<void> {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  })
  const toStore = toEncryptedStoreConfig(normalized)

  const normalizedScope = normalizeStoreScope(scope)
  assertScopedIntegrationsAccess(normalizedScope)
  const { userId, client } = normalizedScope
  const { error } = await client
    .from(INTEGRATIONS_TABLE)
    .upsert(
      {
        user_id: userId,
        config: toStore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
  if (error) throw new Error(`Failed to save integrations config: ${error.message}`)
}

// Serializes concurrent updateIntegrationsConfig calls per-user to prevent
// read→merge→write races where two concurrent callers both load stale state
// and the last writer silently overwrites the other's changes.
const _configUpdateLocks = new Map<string, Promise<void>>()

export async function updateIntegrationsConfig(partial: Partial<IntegrationsConfig>, scope?: IntegrationsStoreScope): Promise<IntegrationsConfig> {
  const normalizedScope = normalizeStoreScope(scope)
  assertScopedIntegrationsAccess(normalizedScope)
  const { userId } = normalizedScope

  let result!: IntegrationsConfig
  const prev = _configUpdateLocks.get(userId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const current = await loadIntegrationsConfig(scope)
    const merged = mergeIntegrationsConfig(current, partial)
    await saveIntegrationsConfig(merged, scope)
    result = merged
  })
  _configUpdateLocks.set(userId, next)
  await next
  // Evict the settled promise so the Map doesn't grow unboundedly.
  if (_configUpdateLocks.get(userId) === next) _configUpdateLocks.delete(userId)
  return result
}
