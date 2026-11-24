import { Activity, Database, GitBranch, Mail, MessageCircle, Send, SlidersHorizontal, Sparkles, WandSparkles, Zap } from "lucide-react"

import type { SelectOption } from "@/components/ui"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { resolveCurrentModelId } from "../../../src/providers/models/retired-model-aliases/index.js"
import { AI_MODEL_OPTIONS } from "./constants"
import type { AiIntegrationType, WorkflowStep, WorkflowStepType } from "./types"

export function formatIntegrationLabel(integration: string): string {
  const value = integration.trim().toLowerCase()
  if (value === "preferred") return "Preferred Channel"
  if (value === "telegram") return "Telegram"
  if (value === "discord") return "Discord"
  if (value === "slack") return "Slack"
  if (value === "email") return "Email"
  if (!value) return "Telegram"
  return integration.charAt(0).toUpperCase() + integration.slice(1)
}

/** The configured default; a retired stored ID shows as its current replacement (retired-model-aliases). */
export function getDefaultModelForProvider(provider: AiIntegrationType, settings: IntegrationsSettings): string {
  return resolveCurrentModelId(provider, settings[provider].defaultModel, { log: false }) || AI_MODEL_OPTIONS[provider][0]?.value || ""
}

/**
 * Listed models plus any configured default or step model that is no longer listed (an older stored choice), so a
 * picker always shows the value that will actually run instead of silently displaying the first option. A retired
 * model is shown as its replacement (which is what runs), never as a "(legacy)" entry.
 */
export function getModelOptionsForProvider(
  provider: AiIntegrationType,
  settings: IntegrationsSettings,
  selectedModel?: string,
): SelectOption[] {
  const base = AI_MODEL_OPTIONS[provider]
  const extras: SelectOption[] = []
  for (const candidate of [getDefaultModelForProvider(provider, settings), resolveCurrentModelId(provider, selectedModel, { log: false })]) {
    if (!candidate) continue
    if (base.some((option) => option.value === candidate) || extras.some((option) => option.value === candidate)) continue
    extras.push({ value: candidate, label: `${candidate} (legacy)` })
  }
  return extras.length > 0 ? [...extras, ...base] : base
}

export function renderStepIcon(type: WorkflowStepType, className: string) {
  if (type === "trigger") return <Zap className={className} />
  if (type === "fetch") return <Database className={className} />
  if (type === "coinbase") return <Sparkles className={className} />
  if (type === "ai") return <WandSparkles className={className} />
  if (type === "transform") return <GitBranch className={className} />
  if (type === "condition") return <SlidersHorizontal className={className} />
  return <Send className={className} />
}

export function getMissionIntegrationIcon(integration: string, className: string) {
  if (integration === "telegram") return <Send className={className} />
  if (integration === "discord") return <MessageCircle className={className} />
  if (integration === "slack") return <MessageCircle className={className} />
  if (integration === "email") return <Mail className={className} />
  if (integration === "openai" || integration === "claude" || integration === "grok" || integration === "gemini") {
    return <Sparkles className={className} />
  }
  return <Activity className={className} />
}

export function isWorkflowStepType(value: string): value is WorkflowStepType {
  return value === "trigger" || value === "fetch" || value === "coinbase" || value === "ai" || value === "transform" || value === "condition" || value === "output"
}

export function normalizePriority(value: string | undefined): "low" | "medium" | "high" | "critical" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized
  return "medium"
}

export function isTemplateSecret(value: string): boolean {
  const text = String(value || "").trim()
  return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
}

export function usesSavedIntegrationDestination(channel: WorkflowStep["outputChannel"]): boolean {
  return channel === "telegram" || channel === "discord" || channel === "slack"
}

export function sanitizeOutputRecipients(
  channel: WorkflowStep["outputChannel"],
  recipients: string | undefined,
): string {
  const value = String(recipients || "").trim()
  if (usesSavedIntegrationDestination(channel)) return ""
  if (isTemplateSecret(value)) return ""
  return value
}

export function normalizeAiDetailLevel(value: unknown): "concise" | "standard" | "detailed" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "concise" || normalized === "standard" || normalized === "detailed") {
    return normalized
  }
  return "standard"
}

export function normalizeFetchIncludeSources(value: unknown): boolean {
  if (typeof value === "boolean") return value
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") return false
  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") return true
  return false
}
