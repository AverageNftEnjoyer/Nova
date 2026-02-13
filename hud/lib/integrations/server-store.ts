import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface TelegramIntegrationConfig {
  connected: boolean
  botToken: string
  chatIds: string[]
}

export interface DiscordIntegrationConfig {
  connected: boolean
  webhookUrls: string[]
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

export type LlmProvider = "openai" | "claude" | "grok"

export interface AgentIntegrationConfig {
  connected: boolean
  apiKey: string
  endpoint: string
}

export interface IntegrationsConfig {
  telegram: TelegramIntegrationConfig
  discord: DiscordIntegrationConfig
  openai: OpenAIIntegrationConfig
  claude: ClaudeIntegrationConfig
  grok: GrokIntegrationConfig
  activeLlmProvider: LlmProvider
  agents: Record<string, AgentIntegrationConfig>
  updatedAt: string
}

const DATA_DIR = path.join(process.cwd(), "data")
const DATA_FILE = path.join(DATA_DIR, "integrations-config.json")

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
  activeLlmProvider: "openai",
  agents: {},
  updatedAt: new Date().toISOString(),
}

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(DATA_FILE, "utf8")
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8")
  }
}

function normalizeConfig(raw: Partial<IntegrationsConfig> | null | undefined): IntegrationsConfig {
  return {
    telegram: {
      connected: raw?.telegram?.connected ?? DEFAULT_CONFIG.telegram.connected,
      botToken: raw?.telegram?.botToken?.trim() ?? "",
      chatIds: Array.isArray(raw?.telegram?.chatIds)
        ? raw!.telegram!.chatIds.map((id) => String(id).trim()).filter(Boolean)
        : [],
    },
    discord: {
      connected: raw?.discord?.connected ?? DEFAULT_CONFIG.discord.connected,
      webhookUrls: Array.isArray(raw?.discord?.webhookUrls)
        ? raw.discord.webhookUrls.map((url) => String(url).trim()).filter(Boolean)
        : [],
    },
    openai: {
      connected: raw?.openai?.connected ?? DEFAULT_CONFIG.openai.connected,
      apiKey: raw?.openai?.apiKey?.trim() ?? "",
      baseUrl: raw?.openai?.baseUrl?.trim() || DEFAULT_CONFIG.openai.baseUrl,
      defaultModel: raw?.openai?.defaultModel?.trim() || DEFAULT_CONFIG.openai.defaultModel,
    },
    claude: {
      connected: raw?.claude?.connected ?? DEFAULT_CONFIG.claude.connected,
      apiKey: raw?.claude?.apiKey?.trim() ?? "",
      baseUrl: raw?.claude?.baseUrl?.trim() || DEFAULT_CONFIG.claude.baseUrl,
      defaultModel: raw?.claude?.defaultModel?.trim() || DEFAULT_CONFIG.claude.defaultModel,
    },
    grok: {
      connected: raw?.grok?.connected ?? DEFAULT_CONFIG.grok.connected,
      apiKey: raw?.grok?.apiKey?.trim() ?? "",
      baseUrl: raw?.grok?.baseUrl?.trim() || DEFAULT_CONFIG.grok.baseUrl,
      defaultModel: raw?.grok?.defaultModel?.trim() || DEFAULT_CONFIG.grok.defaultModel,
    },
    activeLlmProvider:
      raw?.activeLlmProvider === "claude" || raw?.activeLlmProvider === "openai" || raw?.activeLlmProvider === "grok"
        ? raw.activeLlmProvider
        : DEFAULT_CONFIG.activeLlmProvider,
    agents: raw?.agents && typeof raw.agents === "object" ? raw.agents : {},
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  }
}

export async function loadIntegrationsConfig(): Promise<IntegrationsConfig> {
  await ensureDataFile()

  try {
    const raw = await readFile(DATA_FILE, "utf8")
    const parsed = JSON.parse(raw) as Partial<IntegrationsConfig>
    return normalizeConfig(parsed)
  } catch {
    return DEFAULT_CONFIG
  }
}

export async function saveIntegrationsConfig(config: IntegrationsConfig): Promise<void> {
  await ensureDataFile()
  const normalized = normalizeConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  })
  await writeFile(DATA_FILE, JSON.stringify(normalized, null, 2), "utf8")
}

export async function updateIntegrationsConfig(partial: Partial<IntegrationsConfig>): Promise<IntegrationsConfig> {
  const current = await loadIntegrationsConfig()
  const next = normalizeConfig({
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
    claude: {
      ...current.claude,
      ...(partial.claude || {}),
    },
    grok: {
      ...current.grok,
      ...(partial.grok || {}),
    },
    activeLlmProvider:
      partial.activeLlmProvider === "claude" || partial.activeLlmProvider === "openai" || partial.activeLlmProvider === "grok"
        ? partial.activeLlmProvider
        : current.activeLlmProvider,
    agents: {
      ...current.agents,
      ...(partial.agents || {}),
    },
    updatedAt: new Date().toISOString(),
  })
  await saveIntegrationsConfig(next)
  return next
}
