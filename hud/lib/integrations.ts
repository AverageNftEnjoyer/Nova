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

export interface IntegrationsSettings {
  telegram: TelegramIntegrationSettings
  discord: DiscordIntegrationSettings
  openai: OpenAIIntegrationSettings
  updatedAt: string
}

const STORAGE_KEY = "nova_integrations_settings"
export const INTEGRATIONS_UPDATED_EVENT = "nova:integrations-updated"

const DEFAULT_SETTINGS: IntegrationsSettings = {
  telegram: {
    connected: true,
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
