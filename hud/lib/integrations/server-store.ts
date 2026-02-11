import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface TelegramIntegrationConfig {
  connected: boolean
  botToken: string
  chatIds: string[]
}

export interface AgentIntegrationConfig {
  connected: boolean
  apiKey: string
  endpoint: string
}

export interface IntegrationsConfig {
  telegram: TelegramIntegrationConfig
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
    agents: {
      ...current.agents,
      ...(partial.agents || {}),
    },
    updatedAt: new Date().toISOString(),
  })
  await saveIntegrationsConfig(next)
  return next
}
