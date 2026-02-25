/**
 * Configuration Utilities
 *
 * Functions for normalizing workflow configuration and parsing headers.
 */

import type { WorkflowStep, WorkflowStepType, AiDetailLevel } from "../types"

/**
 * Normalize a workflow step, ensuring required fields are present.
 */
export function normalizeWorkflowStep(raw: WorkflowStep, index: number): WorkflowStep {
  const type = String(raw.type || "output").toLowerCase()
  const stepType: WorkflowStepType | "switch" | "loop" =
    type === "trigger" || type === "fetch" || type === "coinbase" || type === "ai" || type === "transform" || type === "condition" || type === "output" || type === "switch" || type === "loop"
      ? (type as WorkflowStepType | "switch" | "loop")
      : "output"
  const normalized: WorkflowStep = {
    ...raw,
    id: typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : `step-${index + 1}-${Math.random().toString(36).slice(2, 7)}`,
    type: stepType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : stepType,
  }
  if (stepType === "fetch") {
    normalized.fetchIncludeSources = resolveIncludeSources(raw.fetchIncludeSources, false)
  }
  if (stepType === "ai") {
    normalized.aiDetailLevel = resolveAiDetailLevel(raw.aiDetailLevel, "standard")
  }
  if (stepType === "coinbase") {
    const normalizedIntent = String(raw.coinbaseIntent || "").trim().toLowerCase()
    normalized.coinbaseIntent =
      normalizedIntent === "status" ||
      normalizedIntent === "price" ||
      normalizedIntent === "portfolio" ||
      normalizedIntent === "transactions" ||
      normalizedIntent === "report"
        ? normalizedIntent
        : "report"
    normalized.coinbaseParams = {
      assets: Array.isArray(raw.coinbaseParams?.assets)
        ? raw.coinbaseParams?.assets.map((value) => String(value).trim()).filter(Boolean).slice(0, 8)
        : undefined,
      quoteCurrency: typeof raw.coinbaseParams?.quoteCurrency === "string" ? raw.coinbaseParams.quoteCurrency : undefined,
      thresholdPct: Number.isFinite(Number(raw.coinbaseParams?.thresholdPct)) ? Number(raw.coinbaseParams?.thresholdPct) : undefined,
      cadence: typeof raw.coinbaseParams?.cadence === "string" ? raw.coinbaseParams.cadence : undefined,
      transactionLimit: Number.isFinite(Number(raw.coinbaseParams?.transactionLimit)) ? Number(raw.coinbaseParams?.transactionLimit) : undefined,
      includePreviousArtifactContext:
        typeof raw.coinbaseParams?.includePreviousArtifactContext === "boolean"
          ? raw.coinbaseParams.includePreviousArtifactContext
          : true,
    }
    normalized.coinbaseFormat = {
      style: typeof raw.coinbaseFormat?.style === "string" ? raw.coinbaseFormat.style : "standard",
      includeRawMetadata: typeof raw.coinbaseFormat?.includeRawMetadata === "boolean" ? raw.coinbaseFormat.includeRawMetadata : true,
    }
    if (!raw.title || /^coinbase$/i.test(String(raw.title))) {
      normalized.title = "Run Coinbase step"
    }
  }
  if (stepType === "output") {
    const channel = String(raw.outputChannel || "").trim().toLowerCase()
    const defaultTitleByChannel: Record<string, string> = {
      novachat: "Send to NovaChat",
      telegram: "Send to Telegram",
      discord: "Send to Discord",
      email: "Send to Email",
      push: "Send Push Notification",
      webhook: "Send to Webhook",
    }
    const fallbackTitle = defaultTitleByChannel[channel] || "Send notification"
    const currentTitle = String(normalized.title || "").trim()
    const isGenericTitle = !currentTitle || /^output$/i.test(currentTitle) || /^send notification$/i.test(currentTitle)
    const isMismatchedTelegram = channel === "novachat" && /telegram/i.test(currentTitle)
    if (isGenericTitle || isMismatchedTelegram) {
      normalized.title = fallbackTitle
    }
  }
  return normalized
}

/**
 * Parse JSON headers string into a Record.
 */
export function parseHeadersJson(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k).trim()
      const value = String(v ?? "").trim()
      if (key && value) out[key] = value
    }
    return out
  } catch {
    const out: Record<string, string> = {}
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    for (const line of lines) {
      const separator = line.indexOf(":")
      if (separator <= 0) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim()
      if (key && value) out[key] = value
    }
    return out
  }
}

/**
 * Check if headers contain a specific header name (case-insensitive).
 */
export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.trim().toLowerCase()
  return Object.keys(headers).some((key) => key.trim().toLowerCase() === target)
}

/**
 * Resolve boolean include sources flag from various input types.
 */
export function resolveIncludeSources(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true
  }
  return fallback
}

/**
 * Resolve AI detail level from various input types.
 */
export function resolveAiDetailLevel(value: unknown, fallback: AiDetailLevel = "standard"): AiDetailLevel {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "concise" || normalized === "standard" || normalized === "detailed") {
    return normalized
  }
  return fallback
}

/**
 * Get default recipient placeholder for a channel.
 */
export function defaultRecipientPlaceholder(channel: string): string {
  const normalized = String(channel || "").trim().toLowerCase()
  if (normalized === "discord") return "{{secrets.DISCORD_WEBHOOK_URL}}"
  if (normalized === "telegram") return "{{secrets.TELEGRAM_CHAT_ID}}"
  if (normalized === "email") return "{{secrets.EMAIL_TO}}"
  if (normalized === "webhook") return "{{secrets.WEBHOOK_URL}}"
  if (normalized === "push") return "{{secrets.PUSH_TARGET}}"
  return ""
}

/**
 * Normalize output recipients to match the specified channel.
 */
export function normalizeOutputRecipientsForChannel(channel: string, recipients: string | undefined): string {
  const normalizedChannel = String(channel || "").trim().toLowerCase()
  const value = String(recipients || "").trim()
  const fallback = defaultRecipientPlaceholder(normalizedChannel)
  if (!value) return fallback

  const upper = value.toUpperCase()
  const mentionsTelegram = upper.includes("TELEGRAM")
  const mentionsDiscord = upper.includes("DISCORD")
  const mentionsWebhook = upper.includes("WEBHOOK")
  const mentionsEmail = upper.includes("EMAIL")
  const mentionsPush = upper.includes("PUSH")

  if (normalizedChannel === "telegram" && (mentionsDiscord || mentionsWebhook || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "discord" && (mentionsTelegram || mentionsWebhook || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "webhook" && (mentionsTelegram || mentionsDiscord || mentionsEmail || mentionsPush)) return fallback
  if (normalizedChannel === "email" && (mentionsTelegram || mentionsDiscord || mentionsWebhook || mentionsPush)) return fallback
  if (normalizedChannel === "push" && (mentionsTelegram || mentionsDiscord || mentionsWebhook || mentionsEmail)) return fallback

  return value
}

/**
 * Convert URL to OpenAI-compatible base URL.
 */
export function toOpenAiLikeBase(url: string, fallback: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return fallback
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

/**
 * Convert URL to Claude API base URL.
 */
export function toClaudeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.anthropic.com"
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed
}
