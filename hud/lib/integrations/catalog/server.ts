import "server-only"

import { type IntegrationsConfig, type IntegrationsStoreScope, loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { type IntegrationCatalogItem } from "@/lib/integrations/catalog"

function titleCase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return "Integration"
  return trimmed
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function buildIntegrationCatalog(config: IntegrationsConfig): IntegrationCatalogItem[] {
  const items: IntegrationCatalogItem[] = [
    {
      id: "telegram",
      label: "Telegram",
      kind: "channel",
      connected: config.telegram.connected && config.telegram.botToken.trim().length > 0,
      source: "core",
      capabilities: ["output"],
      updatedAt: config.updatedAt,
    },
    {
      id: "discord",
      label: "Discord",
      kind: "channel",
      connected: config.discord.connected && config.discord.webhookUrls.length > 0,
      source: "core",
      capabilities: ["output"],
      updatedAt: config.updatedAt,
    },
    {
      id: "webhook",
      label: "Webhook",
      kind: "channel",
      connected: true,
      source: "core",
      capabilities: ["output"],
      updatedAt: config.updatedAt,
    },
    {
      id: "gmail",
      label: "Gmail",
      kind: "channel",
      connected: config.gmail.connected && (config.gmail.refreshTokenEnc.trim().length > 0 || config.gmail.accessTokenEnc.trim().length > 0),
      source: "core",
      capabilities: ["fetch", "output"],
      updatedAt: config.updatedAt,
    },
    {
      id: "brave",
      label: "Brave",
      kind: "api",
      connected: config.brave.connected && config.brave.apiKey.trim().length > 0,
      source: "core",
      capabilities: ["fetch"],
      updatedAt: config.updatedAt,
    },
    {
      id: "coinbase",
      label: "Coinbase",
      kind: "api",
      connected: config.coinbase.connected && config.coinbase.apiKey.trim().length > 0 && config.coinbase.apiSecret.trim().length > 0,
      source: "core",
      capabilities: ["fetch"],
      updatedAt: config.updatedAt,
    },
    {
      id: "spotify",
      label: "Spotify",
      kind: "api",
      connected: config.spotify.connected && (config.spotify.refreshTokenEnc.trim().length > 0 || config.spotify.accessTokenEnc.trim().length > 0),
      source: "core",
      capabilities: ["fetch"],
      updatedAt: config.updatedAt,
    },
    {
      id: "openai",
      label: "OpenAI",
      kind: "llm",
      connected: config.openai.connected && config.openai.apiKey.trim().length > 0,
      source: "core",
      capabilities: ["ai"],
      updatedAt: config.updatedAt,
    },
    {
      id: "claude",
      label: "Claude",
      kind: "llm",
      connected: config.claude.connected && config.claude.apiKey.trim().length > 0,
      source: "core",
      capabilities: ["ai"],
      updatedAt: config.updatedAt,
    },
    {
      id: "grok",
      label: "Grok",
      kind: "llm",
      connected: config.grok.connected && config.grok.apiKey.trim().length > 0,
      source: "core",
      capabilities: ["ai"],
      updatedAt: config.updatedAt,
    },
    {
      id: "gemini",
      label: "Gemini",
      kind: "llm",
      connected: config.gemini.connected && config.gemini.apiKey.trim().length > 0,
      source: "core",
      capabilities: ["ai"],
      updatedAt: config.updatedAt,
    },
  ]

  for (const [idRaw, agent] of Object.entries(config.agents || {})) {
    const id = idRaw.trim()
    if (!id) continue
    const endpoint = String(agent.endpoint || "").trim()
    items.push({
      id,
      label: titleCase(id),
      kind: "api",
      connected: Boolean(agent.connected) && endpoint.length > 0,
      endpoint: endpoint || undefined,
      source: "agent",
      capabilities: ["fetch"],
      updatedAt: config.updatedAt,
    })
  }

  return items
}

export async function loadIntegrationCatalog(scope?: IntegrationsStoreScope): Promise<IntegrationCatalogItem[]> {
  const config = await loadIntegrationsConfig(scope)
  return buildIntegrationCatalog(config)
}
