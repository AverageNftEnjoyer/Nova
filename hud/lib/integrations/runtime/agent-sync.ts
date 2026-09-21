import "server-only"

import { nowIso, tx } from "../../../../src/db/index.js"
import { encryptSecret, isSecretCiphertext } from "../../security/encryption"
import type { IntegrationsConfig } from "../store/server-store"
import { buildRuntimeSafeGmailSnapshot } from "../gmail/runtime-safe"
import { buildRuntimeSafePhantomSnapshot } from "../phantom/runtime-safe"
import { buildRuntimeSafePolymarketSnapshot } from "../polymarket/runtime-safe"
import { buildRuntimeSafeSpotifySnapshot } from "../spotify/runtime-safe"

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

/** Ciphertext for the runtime snapshot: already-encrypted values (any format) pass through, plaintext is encrypted. */
function wrapSecret(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (isSecretCiphertext(raw)) return raw
  return encryptSecret(raw)
}

function resolveUserRuntimeConfigPath(_workspaceRoot: string, userId: string): string {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) {
    throw new Error("syncAgentRuntimeIntegrationsSnapshot requires userContextId.")
  }
  return `sqlite:integration_state/${scopedUserId}/runtime/snapshot`
}

export async function syncAgentRuntimeIntegrationsSnapshot(
  workspaceRoot: string,
  userId: string,
  config: IntegrationsConfig,
): Promise<string> {
  const filePath = resolveUserRuntimeConfigPath(workspaceRoot, userId)

  const payload = {
    activeLlmProvider: config.activeLlmProvider,
    coinbase: {
      connected: Boolean(config.coinbase.connected),
      apiKey: wrapSecret(config.coinbase.apiKey),
      apiSecret: wrapSecret(config.coinbase.apiSecret),
      connectionMode: config.coinbase.connectionMode === "oauth" ? "oauth" : "api_key_pair",
      requiredScopes: Array.isArray(config.coinbase.requiredScopes)
        ? config.coinbase.requiredScopes.map((scope) => String(scope).trim().toLowerCase()).filter(Boolean)
        : [],
      lastSyncAt: String(config.coinbase.lastSyncAt || "").trim(),
      lastSyncStatus:
        config.coinbase.lastSyncStatus === "success" || config.coinbase.lastSyncStatus === "error"
          ? config.coinbase.lastSyncStatus
          : "never",
      lastSyncErrorCode:
        config.coinbase.lastSyncErrorCode === "expired_token" ||
        config.coinbase.lastSyncErrorCode === "permission_denied" ||
        config.coinbase.lastSyncErrorCode === "rate_limited" ||
        config.coinbase.lastSyncErrorCode === "coinbase_outage" ||
        config.coinbase.lastSyncErrorCode === "network" ||
        config.coinbase.lastSyncErrorCode === "unknown"
          ? config.coinbase.lastSyncErrorCode
          : "none",
      lastSyncErrorMessage: String(config.coinbase.lastSyncErrorMessage || "").trim(),
      lastFreshnessMs:
        typeof config.coinbase.lastFreshnessMs === "number" && Number.isFinite(config.coinbase.lastFreshnessMs)
          ? Math.max(0, Math.floor(config.coinbase.lastFreshnessMs))
          : 0,
      reportTimezone: String(config.coinbase.reportTimezone || "").trim(),
      reportCurrency: String(config.coinbase.reportCurrency || "").trim().toUpperCase(),
      reportCadence: config.coinbase.reportCadence === "weekly" ? "weekly" : "daily",
    },
    phantom: buildRuntimeSafePhantomSnapshot(config.phantom),
    polymarket: buildRuntimeSafePolymarketSnapshot(config.polymarket),
    openai: {
      connected: Boolean(config.openai.connected),
      apiKey: wrapSecret(config.openai.apiKey),
      baseUrl: String(config.openai.baseUrl || "").trim(),
      defaultModel: String(config.openai.defaultModel || "").trim(),
    },
    claude: {
      connected: Boolean(config.claude.connected),
      apiKey: wrapSecret(config.claude.apiKey),
      baseUrl: String(config.claude.baseUrl || "").trim(),
      defaultModel: String(config.claude.defaultModel || "").trim(),
    },
    grok: {
      connected: Boolean(config.grok.connected),
      apiKey: wrapSecret(config.grok.apiKey),
      baseUrl: String(config.grok.baseUrl || "").trim(),
      defaultModel: String(config.grok.defaultModel || "").trim(),
    },
    gemini: {
      connected: Boolean(config.gemini.connected),
      apiKey: wrapSecret(config.gemini.apiKey),
      baseUrl: String(config.gemini.baseUrl || "").trim(),
      defaultModel: String(config.gemini.defaultModel || "").trim(),
    },
    spotify: buildRuntimeSafeSpotifySnapshot(config.spotify),
    youtube: {
      connected: Boolean(config.youtube.connected),
      channelId: String(config.youtube.channelId || "").trim(),
      channelTitle: String(config.youtube.channelTitle || "").trim(),
      scopes: Array.isArray(config.youtube.scopes)
        ? config.youtube.scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : [],
      redirectUri: String(config.youtube.redirectUri || "").trim(),
      accessToken: wrapSecret(config.youtube.accessTokenEnc),
      refreshToken: wrapSecret(config.youtube.refreshTokenEnc),
      tokenExpiry:
        typeof config.youtube.tokenExpiry === "number" && Number.isFinite(config.youtube.tokenExpiry)
          ? Math.max(0, Math.floor(config.youtube.tokenExpiry))
          : 0,
    },
    news: {
      connected: Boolean(config.news.connected),
      apiKey: wrapSecret(config.news.apiKey),
      defaultTopics: Array.isArray(config.news.defaultTopics)
        ? config.news.defaultTopics.map((topic) => String(topic).trim().toLowerCase()).filter(Boolean)
        : [],
      preferredSources: Array.isArray(config.news.preferredSources)
        ? config.news.preferredSources.map((source) => String(source).trim()).filter(Boolean)
        : [],
      language: String(config.news.language || "").trim().toLowerCase(),
      country: String(config.news.country || "").trim().toLowerCase(),
    },
    gmail: buildRuntimeSafeGmailSnapshot(config.gmail),
    updatedAt: new Date().toISOString(),
    source: "user-scoped-runtime-sync",
  }

  const scopedUserId = sanitizeUserContextId(userId)
  tx((db) => {
    db.prepare(
      `INSERT INTO integration_state (user_id, integration, key, value_json, expires_at, updated_at)
       VALUES (?, 'runtime', 'snapshot', ?, NULL, ?)
       ON CONFLICT(user_id, integration, key) DO UPDATE SET
         value_json = excluded.value_json, expires_at = NULL, updated_at = excluded.updated_at`,
    ).run(scopedUserId, JSON.stringify(payload), nowIso())
  })
  return filePath
}
