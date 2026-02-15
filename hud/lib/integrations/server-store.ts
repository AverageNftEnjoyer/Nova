import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { decryptSecret, encryptSecret } from "@/lib/security/encryption"

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

export interface GeminiIntegrationConfig {
  connected: boolean
  apiKey: string
  baseUrl: string
  defaultModel: string
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

export type LlmProvider = "openai" | "claude" | "grok" | "gemini"

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
  gemini: GeminiIntegrationConfig
  gmail: GmailIntegrationConfig
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
  gemini: {
    connected: false,
    apiKey: "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-pro",
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
  if (decryptSecret(raw)) return raw
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
        ? raw.discord.webhookUrls.map((url) => String(url).trim()).filter(Boolean)
        : [],
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
    activeLlmProvider:
      raw?.activeLlmProvider === "claude" || raw?.activeLlmProvider === "openai" || raw?.activeLlmProvider === "grok" || raw?.activeLlmProvider === "gemini"
        ? raw.activeLlmProvider
        : DEFAULT_CONFIG.activeLlmProvider,
    agents: normalizedAgents,
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
  const toStore: IntegrationsConfig = {
    ...normalized,
    telegram: {
      ...normalized.telegram,
      botToken: wrapStoredSecret(normalized.telegram.botToken),
    },
    openai: {
      ...normalized.openai,
      apiKey: wrapStoredSecret(normalized.openai.apiKey),
    },
    claude: {
      ...normalized.claude,
      apiKey: wrapStoredSecret(normalized.claude.apiKey),
    },
    grok: {
      ...normalized.grok,
      apiKey: wrapStoredSecret(normalized.grok.apiKey),
    },
    gemini: {
      ...normalized.gemini,
      apiKey: wrapStoredSecret(normalized.gemini.apiKey),
    },
    gmail: {
      ...normalized.gmail,
      accounts: normalized.gmail.accounts.map((account) => ({
        ...account,
        accessTokenEnc: wrapStoredSecret(account.accessTokenEnc),
        refreshTokenEnc: wrapStoredSecret(account.refreshTokenEnc),
      })),
      oauthClientSecret: wrapStoredSecret(normalized.gmail.oauthClientSecret),
    },
    agents: Object.fromEntries(
      Object.entries(normalized.agents).map(([id, agent]) => [
        id,
        {
          ...agent,
          apiKey: wrapStoredSecret(agent.apiKey),
        },
      ]),
    ),
  }
  await writeFile(DATA_FILE, JSON.stringify(toStore, null, 2), "utf8")
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
    gemini: {
      ...current.gemini,
      ...(partial.gemini || {}),
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
  await saveIntegrationsConfig(next)
  return next
}
