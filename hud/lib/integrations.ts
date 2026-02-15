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
  openai: OpenAIIntegrationSettings
  claude: ClaudeIntegrationSettings
  grok: GrokIntegrationSettings
  gemini: GeminiIntegrationSettings
  gmail: GmailIntegrationSettings
  activeLlmProvider: LlmProvider
  updatedAt: string
}

const STORAGE_KEY = "nova_integrations_settings"
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

export function loadIntegrationsSettings(): IntegrationsSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
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
