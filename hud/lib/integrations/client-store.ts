export interface TelegramIntegrationSettings {
  connected: boolean
  botToken: string
  chatIds: string
  botTokenConfigured?: boolean
  botTokenMasked?: string
}

export interface DiscordIntegrationSettings {
  connected: boolean
  webhookUrls: string
}

export interface BraveIntegrationSettings {
  connected: boolean
  apiKey: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
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

export interface CoinbaseIntegrationSettings {
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
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
  apiSecretConfigured?: boolean
  apiSecretMasked?: string
}

export interface OpenAIIntegrationSettings {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
}

export interface ClaudeIntegrationSettings {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
}

export interface GrokIntegrationSettings {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
}

export interface GeminiIntegrationSettings {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
  apiKeyConfigured?: boolean
  apiKeyMasked?: string
}

export interface GmailIntegrationSettings {
  connected: boolean
  email: string
  scopes: string
  accounts: Array<{
    id: string
    email: string
    scopes: string[]
    connectedAt?: string
    active?: boolean
    enabled?: boolean
  }>
  activeAccountId: string
  oauthClientId: string
  oauthClientSecret: string
  redirectUri: string
  oauthClientSecretConfigured?: boolean
  oauthClientSecretMasked?: string
  tokenConfigured?: boolean
}

export type LlmProvider = "openai" | "claude" | "grok" | "gemini"

export interface IntegrationsSettings {
  telegram: TelegramIntegrationSettings
  discord: DiscordIntegrationSettings
  brave: BraveIntegrationSettings
  coinbase: CoinbaseIntegrationSettings
  openai: OpenAIIntegrationSettings
  claude: ClaudeIntegrationSettings
  grok: GrokIntegrationSettings
  gemini: GeminiIntegrationSettings
  gmail: GmailIntegrationSettings
  activeLlmProvider: LlmProvider
  updatedAt: string
}

const STORAGE_KEY_PREFIX = "nova_integrations_settings"
export const INTEGRATIONS_UPDATED_EVENT = "nova:integrations-updated"

const DEFAULT_SETTINGS: IntegrationsSettings = {
  telegram: {
    connected: false,
    botToken: "",
    chatIds: "",
    botTokenConfigured: false,
    botTokenMasked: "",
  },
  discord: {
    connected: false,
    webhookUrls: "",
  },
  brave: {
    connected: false,
    apiKey: "",
    apiKeyConfigured: false,
    apiKeyMasked: "",
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
    reportTimezone: "America/New_York",
    reportCurrency: "USD",
    reportCadence: "daily",
    apiKeyConfigured: false,
    apiKeyMasked: "",
    apiSecretConfigured: false,
    apiSecretMasked: "",
  },
  openai: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  claude: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  grok: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4-0709",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  gemini: {
    connected: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-pro",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  gmail: {
    connected: false,
    email: "",
    scopes: "",
    accounts: [],
    activeAccountId: "",
    oauthClientId: "",
    oauthClientSecret: "",
    redirectUri: "http://localhost:3000/api/integrations/gmail/callback",
    oauthClientSecretConfigured: false,
    oauthClientSecretMasked: "",
    tokenConfigured: false,
  },
  activeLlmProvider: "openai",
  updatedAt: new Date().toISOString(),
}

function getStorageKey(): string {
  const userId = getActiveUserId()
  if (!userId) return ""
  return `${STORAGE_KEY_PREFIX}:${userId}`
}

export function loadIntegrationsSettings(): IntegrationsSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS

  try {
    const key = getStorageKey()
    if (!key) return DEFAULT_SETTINGS
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<IntegrationsSettings>
    return {
      telegram: {
        ...DEFAULT_SETTINGS.telegram,
        ...(parsed.telegram || {}),
        botToken: "",
      },
      discord: {
        ...DEFAULT_SETTINGS.discord,
        ...(parsed.discord || {}),
      },
      brave: {
        ...DEFAULT_SETTINGS.brave,
        ...(parsed.brave || {}),
        apiKey: "",
      },
      coinbase: {
        ...DEFAULT_SETTINGS.coinbase,
        ...(parsed.coinbase || {}),
        apiKey: "",
        apiSecret: "",
        connectionMode: parsed.coinbase?.connectionMode === "oauth" ? "oauth" : "api_key_pair",
        requiredScopes: Array.isArray(parsed.coinbase?.requiredScopes)
          ? parsed.coinbase.requiredScopes.map((scope) => String(scope).trim()).filter(Boolean)
          : DEFAULT_SETTINGS.coinbase.requiredScopes,
        lastSyncAt: typeof parsed.coinbase?.lastSyncAt === "string" ? parsed.coinbase.lastSyncAt : "",
        lastSyncStatus:
          parsed.coinbase?.lastSyncStatus === "success" || parsed.coinbase?.lastSyncStatus === "error"
            ? parsed.coinbase.lastSyncStatus
            : "never",
        lastSyncErrorCode:
          parsed.coinbase?.lastSyncErrorCode === "expired_token" ||
          parsed.coinbase?.lastSyncErrorCode === "permission_denied" ||
          parsed.coinbase?.lastSyncErrorCode === "rate_limited" ||
          parsed.coinbase?.lastSyncErrorCode === "coinbase_outage" ||
          parsed.coinbase?.lastSyncErrorCode === "network" ||
          parsed.coinbase?.lastSyncErrorCode === "unknown"
            ? parsed.coinbase.lastSyncErrorCode
            : "none",
        lastSyncErrorMessage:
          typeof parsed.coinbase?.lastSyncErrorMessage === "string" ? parsed.coinbase.lastSyncErrorMessage : "",
        lastFreshnessMs: typeof parsed.coinbase?.lastFreshnessMs === "number" ? parsed.coinbase.lastFreshnessMs : 0,
        reportTimezone:
          typeof parsed.coinbase?.reportTimezone === "string" && parsed.coinbase.reportTimezone.trim().length > 0
            ? parsed.coinbase.reportTimezone.trim()
            : DEFAULT_SETTINGS.coinbase.reportTimezone,
        reportCurrency:
          typeof parsed.coinbase?.reportCurrency === "string" && parsed.coinbase.reportCurrency.trim().length > 0
            ? parsed.coinbase.reportCurrency.trim().toUpperCase()
            : DEFAULT_SETTINGS.coinbase.reportCurrency,
        reportCadence:
          parsed.coinbase?.reportCadence === "weekly" || parsed.coinbase?.reportCadence === "daily"
            ? parsed.coinbase.reportCadence
            : DEFAULT_SETTINGS.coinbase.reportCadence,
      },
      openai: {
        ...DEFAULT_SETTINGS.openai,
        ...(parsed.openai || {}),
        apiKey: "",
      },
      claude: {
        ...DEFAULT_SETTINGS.claude,
        ...(parsed.claude || {}),
        apiKey: "",
      },
      grok: {
        ...DEFAULT_SETTINGS.grok,
        ...(parsed.grok || {}),
        apiKey: "",
      },
      gemini: {
        ...DEFAULT_SETTINGS.gemini,
        ...(parsed.gemini || {}),
        apiKey: "",
      },
      gmail: {
        ...DEFAULT_SETTINGS.gmail,
        ...(parsed.gmail || {}),
        accounts: Array.isArray(parsed.gmail?.accounts)
          ? parsed.gmail.accounts
              .map((account) => ({
                id: String(account?.id || "").trim(),
                email: String(account?.email || "").trim(),
                scopes: Array.isArray(account?.scopes) ? account.scopes.map((scope) => String(scope).trim()).filter(Boolean) : [],
                connectedAt: typeof account?.connectedAt === "string" ? account.connectedAt : "",
                active: Boolean(account?.active),
                enabled: typeof account?.enabled === "boolean" ? account.enabled : true,
              }))
              .filter((account) => account.id && account.email)
          : [],
        activeAccountId: typeof parsed.gmail?.activeAccountId === "string" ? parsed.gmail.activeAccountId : "",
        oauthClientSecret: "",
      },
      activeLlmProvider:
        parsed.activeLlmProvider === "claude" || parsed.activeLlmProvider === "openai" || parsed.activeLlmProvider === "grok" || parsed.activeLlmProvider === "gemini"
          ? parsed.activeLlmProvider
          : DEFAULT_SETTINGS.activeLlmProvider,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveIntegrationsSettings(settings: IntegrationsSettings): void {
  if (typeof window === "undefined") return
  const key = getStorageKey()
  if (!key) return

  // Never persist raw secrets in browser storage.
  const sanitized: IntegrationsSettings = {
    ...settings,
    telegram: {
      ...settings.telegram,
      botToken: "",
    },
    discord: {
      ...settings.discord,
    },
    brave: {
      ...settings.brave,
      apiKey: "",
    },
    coinbase: {
      ...settings.coinbase,
      apiKey: "",
      apiSecret: "",
    },
    openai: {
      ...settings.openai,
      apiKey: "",
    },
    claude: {
      ...settings.claude,
      apiKey: "",
    },
    grok: {
      ...settings.grok,
      apiKey: "",
    },
    gemini: {
      ...settings.gemini,
      apiKey: "",
    },
    gmail: {
      ...settings.gmail,
      oauthClientSecret: "",
    },
  }

  const updated = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  }

  localStorage.setItem(key, JSON.stringify(updated))
  window.dispatchEvent(
    new CustomEvent(INTEGRATIONS_UPDATED_EVENT, {
      detail: updated,
    }),
  )
}

export function updateTelegramIntegrationSettings(partial: Partial<TelegramIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    telegram: {
      ...current.telegram,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateDiscordIntegrationSettings(partial: Partial<DiscordIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    discord: {
      ...current.discord,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateBraveIntegrationSettings(partial: Partial<BraveIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    brave: {
      ...current.brave,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateCoinbaseIntegrationSettings(partial: Partial<CoinbaseIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    coinbase: {
      ...current.coinbase,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateOpenAIIntegrationSettings(partial: Partial<OpenAIIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    openai: {
      ...current.openai,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateClaudeIntegrationSettings(partial: Partial<ClaudeIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    claude: {
      ...current.claude,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateActiveLlmProvider(provider: LlmProvider): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    activeLlmProvider: provider,
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateGrokIntegrationSettings(partial: Partial<GrokIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    grok: {
      ...current.grok,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateGeminiIntegrationSettings(partial: Partial<GeminiIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    gemini: {
      ...current.gemini,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}

export function updateGmailIntegrationSettings(partial: Partial<GmailIntegrationSettings>): IntegrationsSettings {
  const current = loadIntegrationsSettings()
  const updated: IntegrationsSettings = {
    ...current,
    gmail: {
      ...current.gmail,
      ...partial,
    },
    updatedAt: new Date().toISOString(),
  }
  saveIntegrationsSettings(updated)
  return updated
}
import { getActiveUserId } from "@/lib/auth/active-user"
