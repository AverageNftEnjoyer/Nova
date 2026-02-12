export interface TelegramIntegrationSettings {
  connected: boolean
  botToken: string
  chatIds: string
}

export interface DiscordIntegrationSettings {
  connected: boolean
  webhookUrls: string
}

export interface IntegrationsSettings {
  telegram: TelegramIntegrationSettings
  discord: DiscordIntegrationSettings
  updatedAt: string
}

const STORAGE_KEY = "nova_integrations_settings"
export const INTEGRATIONS_UPDATED_EVENT = "nova:integrations-updated"

const DEFAULT_SETTINGS: IntegrationsSettings = {
  telegram: {
    connected: true,
    botToken: "",
    chatIds: "",
  },
  discord: {
    connected: false,
    webhookUrls: "",
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
      },
      discord: {
        ...DEFAULT_SETTINGS.discord,
        ...(parsed.discord || {}),
      },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveIntegrationsSettings(settings: IntegrationsSettings): void {
  if (typeof window === "undefined") return

  const updated = {
    ...settings,
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
