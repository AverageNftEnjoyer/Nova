import "server-only"

import { collectSecretValues } from "../../../../src/integrations/secret-fields/index.js"
import { maskSecret } from "@/lib/security/encryption"
import { redactWebhookTarget } from "@/lib/notifications/discord"
import { redactSlackWebhookUrl } from "@/lib/notifications/slack"
import type { IntegrationsConfig } from "./server-store"

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

function buildClientConfig(config: IntegrationsConfig) {
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
    slack: {
      ...config.slack,
      webhookUrl: "",
      webhookUrlConfigured: config.slack.webhookUrl.trim().length > 0,
      webhookUrlMasked: redactSlackWebhookUrl(config.slack.webhookUrl),
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
    news: {
      connected: config.news.connected,
      apiKey: "",
      defaultTopics: config.news.defaultTopics,
      preferredSources: config.news.preferredSources,
      language: config.news.language,
      country: config.news.country,
      apiKeyConfigured: config.news.apiKey.trim().length > 0,
      apiKeyMasked: maskSecret(config.news.apiKey),
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
    phantom: {
      ...config.phantom,
    },
    polymarket: {
      ...config.polymarket,
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
    youtube: {
      connected: config.youtube.connected,
      channelId: config.youtube.channelId,
      channelTitle: config.youtube.channelTitle,
      scopes: config.youtube.scopes,
      permissions: {
        allowFeed: Boolean(config.youtube.permissions?.allowFeed),
        allowSearch: Boolean(config.youtube.permissions?.allowSearch),
        allowVideoDetails: Boolean(config.youtube.permissions?.allowVideoDetails),
      },
      redirectUri: config.youtube.redirectUri,
      tokenConfigured:
        config.youtube.refreshTokenEnc.trim().length > 0 ||
        config.youtube.accessTokenEnc.trim().length > 0,
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

/**
 * Defense in depth: the browser payload must never contain a registered secret (plaintext or ciphertext), not even
 * inside an unrelated field. Fails closed instead of sending it.
 */
function assertNoSecretsInClientPayload(payload: unknown, config: IntegrationsConfig): void {
  const serialized = JSON.stringify(payload)
  for (const { path, value } of collectSecretValues(config)) {
    if (value.length < 8) continue
    if (serialized.includes(value) || serialized.includes(JSON.stringify(value).slice(1, -1))) {
      throw new Error(`Refusing to send integrations config to the browser: secret field "${path}" was not masked.`)
    }
  }
}

/** The only shape of IntegrationsConfig that may leave the server: secrets are replaced by configured flags + masks. */
export function toClientIntegrationsConfig(config: IntegrationsConfig) {
  const payload = buildClientConfig(config)
  assertNoSecretsInClientPayload(payload, config)
  return payload
}
