import "server-only"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { encryptSecret } from "../security/encryption"
import type { IntegrationsConfig } from "./server-store"
import { buildRuntimeSafeGmailSnapshot } from "./gmail/runtime-safe"

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96) || "anonymous"
}

function looksEncryptedEnvelope(raw: string): boolean {
  const parts = raw.split(".")
  if (parts.length !== 3) return false
  try {
    const iv = Buffer.from(parts[0], "base64")
    const tag = Buffer.from(parts[1], "base64")
    const enc = Buffer.from(parts[2], "base64")
    return iv.length === 12 && tag.length === 16 && enc.length > 0
  } catch {
    return false
  }
}

function wrapSecret(value: unknown): string {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (looksEncryptedEnvelope(raw)) return raw
  return encryptSecret(raw)
}

function resolveUserRuntimeConfigPath(workspaceRoot: string, userId: string): string {
  const scopedUserId = sanitizeUserContextId(userId)
  return path.join(path.resolve(workspaceRoot), ".agent", "user-context", scopedUserId, "integrations-config.json")
}

export async function syncAgentRuntimeIntegrationsSnapshot(
  workspaceRoot: string,
  userId: string,
  config: IntegrationsConfig,
): Promise<string> {
  const filePath = resolveUserRuntimeConfigPath(workspaceRoot, userId)
  await mkdir(path.dirname(filePath), { recursive: true })

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
    gmail: buildRuntimeSafeGmailSnapshot(config.gmail),
    updatedAt: new Date().toISOString(),
    source: "user-scoped-runtime-sync",
  }

  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
  return filePath
}
