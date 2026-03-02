import { Activity, Database, GitBranch, Mail, MessageCircle, Send, SlidersHorizontal, Sparkles, WandSparkles, Zap } from "lucide-react"

import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { isBackgroundAssetImage } from "@/lib/media/backgroundVideoStorage"
import { loadUserSettings, type ThemeBackgroundType } from "@/lib/settings/userSettings"
import { resolveTimezone } from "@/lib/shared/timezone"
import { AI_MODEL_OPTIONS, STEP_TYPE_OPTIONS } from "./constants"
import type { AiIntegrationType, NotificationSchedule, WorkflowStep, WorkflowStepType } from "./types"

interface BuildBuilderWorkflowStepsInput {
  mission: NotificationSchedule
  rawSteps?: Array<Partial<WorkflowStep>>
  idPrefix: string
  detectedTimezone: string
  integrationsSettings: IntegrationsSettings
  resolveDefaultAiIntegration: () => AiIntegrationType
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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

export function getDefaultModelForProvider(provider: AiIntegrationType, settings: IntegrationsSettings): string {
  return settings[provider].defaultModel.trim() || AI_MODEL_OPTIONS[provider][0]?.value || ""
}

export function getModelOptionsForProvider(provider: AiIntegrationType, settings: IntegrationsSettings): FluidSelectOption[] {
  const base = AI_MODEL_OPTIONS[provider]
  const configuredDefault = getDefaultModelForProvider(provider, settings)
  if (!configuredDefault) return base
  if (base.some((option) => option.value === configuredDefault)) return base
  return [{ value: configuredDefault, label: configuredDefault }, ...base]
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

export function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? legacyDark
}

export function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "space" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

export function resolveCustomBackgroundIsImage() {
  const app = loadUserSettings().app
  return isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
}

export function isTemplateSecret(value: string): boolean {
  const text = String(value || "").trim()
  return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
}

export function usesSavedIntegrationDestination(channel: WorkflowStep["outputChannel"]): boolean {
  return channel === "telegram" || channel === "discord"
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

export function buildBuilderWorkflowStepsFromMeta(input: BuildBuilderWorkflowStepsInput): WorkflowStep[] {
  const { mission, rawSteps, idPrefix, detectedTimezone, integrationsSettings, resolveDefaultAiIntegration } = input
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return []

  return rawSteps.map((step, index) => {
    const stepType = String(step.type || "")
    const resolvedType: WorkflowStepType = isWorkflowStepType(stepType) ? stepType : "output"
    const aiIntegration = (step.aiIntegration === "openai" || step.aiIntegration === "claude" || step.aiIntegration === "grok" || step.aiIntegration === "gemini")
      ? step.aiIntegration
      : resolveDefaultAiIntegration()

    return {
      id: `${idPrefix}-${mission.id}-${index}-${Date.now()}`,
      type: resolvedType,
      title: step.title || STEP_TYPE_OPTIONS.find((option) => option.type === resolvedType)?.label || "Step",
      aiPrompt: resolvedType === "ai" ? (typeof step.aiPrompt === "string" ? step.aiPrompt : "") : undefined,
      aiModel: resolvedType === "ai"
        ? (typeof step.aiModel === "string" && step.aiModel.trim().length > 0
          ? step.aiModel
          : getDefaultModelForProvider(aiIntegration, integrationsSettings))
        : undefined,
      aiIntegration: resolvedType === "ai" ? aiIntegration : undefined,
      aiDetailLevel: resolvedType === "ai" ? normalizeAiDetailLevel(step.aiDetailLevel) : undefined,
      triggerMode: resolvedType === "trigger" ? (step.triggerMode === "once" || step.triggerMode === "daily" || step.triggerMode === "weekly" || step.triggerMode === "interval" ? step.triggerMode : "daily") : undefined,
      triggerTime: resolvedType === "trigger" ? (typeof step.triggerTime === "string" && step.triggerTime ? step.triggerTime : mission.time || "09:00") : undefined,
      triggerTimezone: resolvedType === "trigger"
        ? (typeof step.triggerTimezone === "string" && step.triggerTimezone
          ? step.triggerTimezone
          : resolveTimezone(mission.timezone, detectedTimezone))
        : undefined,
      triggerDays: resolvedType === "trigger" ? (Array.isArray(step.triggerDays) ? step.triggerDays.map((day) => String(day)) : ["mon", "tue", "wed", "thu", "fri"]) : undefined,
      triggerIntervalMinutes: resolvedType === "trigger" ? (typeof step.triggerIntervalMinutes === "string" && step.triggerIntervalMinutes ? step.triggerIntervalMinutes : "30") : undefined,
      fetchSource: resolvedType === "fetch" ? (step.fetchSource === "api" || step.fetchSource === "web" || step.fetchSource === "calendar" || step.fetchSource === "crypto" || step.fetchSource === "coinbase" || step.fetchSource === "rss" || step.fetchSource === "database" ? step.fetchSource : "web") : undefined,
      fetchMethod: resolvedType === "fetch" ? (step.fetchMethod === "POST" ? "POST" : "GET") : undefined,
      fetchApiIntegrationId: resolvedType === "fetch" ? (typeof step.fetchApiIntegrationId === "string" ? step.fetchApiIntegrationId : "") : undefined,
      fetchUrl: resolvedType === "fetch" ? (typeof step.fetchUrl === "string" ? step.fetchUrl : "") : undefined,
      fetchQuery: resolvedType === "fetch" ? (typeof step.fetchQuery === "string" ? step.fetchQuery : "") : undefined,
      fetchHeaders: resolvedType === "fetch" ? (typeof step.fetchHeaders === "string" ? step.fetchHeaders : "") : undefined,
      fetchSelector: resolvedType === "fetch" ? (typeof step.fetchSelector === "string" && step.fetchSelector.trim() ? step.fetchSelector : "a[href]") : undefined,
      fetchRefreshMinutes: resolvedType === "fetch" ? (typeof step.fetchRefreshMinutes === "string" && step.fetchRefreshMinutes ? step.fetchRefreshMinutes : "15") : undefined,
      fetchIncludeSources: resolvedType === "fetch" ? normalizeFetchIncludeSources(step.fetchIncludeSources) : undefined,
      coinbaseIntent: resolvedType === "coinbase"
        ? (step.coinbaseIntent === "status" || step.coinbaseIntent === "price" || step.coinbaseIntent === "portfolio" || step.coinbaseIntent === "transactions" || step.coinbaseIntent === "report"
          ? step.coinbaseIntent
          : "report")
        : undefined,
      coinbaseParams: resolvedType === "coinbase"
        ? {
          assets: Array.isArray(step.coinbaseParams?.assets)
            ? step.coinbaseParams.assets.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
            : ["BTC", "ETH", "SOL"],
          quoteCurrency: typeof step.coinbaseParams?.quoteCurrency === "string" && step.coinbaseParams.quoteCurrency.trim()
            ? step.coinbaseParams.quoteCurrency.trim().toUpperCase()
            : "USD",
          thresholdPct: Number.isFinite(Number(step.coinbaseParams?.thresholdPct)) ? Number(step.coinbaseParams?.thresholdPct) : undefined,
          cadence: typeof step.coinbaseParams?.cadence === "string" && step.coinbaseParams.cadence.trim()
            ? step.coinbaseParams.cadence
            : "daily",
          transactionLimit: Number.isFinite(Number(step.coinbaseParams?.transactionLimit)) ? Number(step.coinbaseParams?.transactionLimit) : undefined,
          includePreviousArtifactContext: typeof step.coinbaseParams?.includePreviousArtifactContext === "boolean"
            ? step.coinbaseParams.includePreviousArtifactContext
            : true,
        }
        : undefined,
      coinbaseFormat: resolvedType === "coinbase"
        ? {
          style: step.coinbaseFormat?.style === "concise" || step.coinbaseFormat?.style === "detailed" || step.coinbaseFormat?.style === "standard"
            ? step.coinbaseFormat.style
            : "standard",
          includeRawMetadata: typeof step.coinbaseFormat?.includeRawMetadata === "boolean"
            ? step.coinbaseFormat.includeRawMetadata
            : true,
        }
        : undefined,
      transformAction: resolvedType === "transform" ? (step.transformAction === "normalize" || step.transformAction === "dedupe" || step.transformAction === "aggregate" || step.transformAction === "format" || step.transformAction === "enrich" ? step.transformAction : "normalize") : undefined,
      transformFormat: resolvedType === "transform" ? (step.transformFormat === "text" || step.transformFormat === "json" || step.transformFormat === "markdown" || step.transformFormat === "table" ? step.transformFormat : "markdown") : undefined,
      transformInstruction: resolvedType === "transform" ? (typeof step.transformInstruction === "string" ? step.transformInstruction : "") : undefined,
      conditionField: resolvedType === "condition" ? (typeof step.conditionField === "string" ? step.conditionField : "priority") : undefined,
      conditionOperator: resolvedType === "condition"
        ? (step.conditionOperator === "contains" || step.conditionOperator === "equals" || step.conditionOperator === "not_equals" || step.conditionOperator === "greater_than" || step.conditionOperator === "less_than" || step.conditionOperator === "regex" || step.conditionOperator === "exists"
          ? step.conditionOperator
          : "contains")
        : undefined,
      conditionValue: resolvedType === "condition" ? (typeof step.conditionValue === "string" ? step.conditionValue : "") : undefined,
      conditionLogic: resolvedType === "condition" ? (step.conditionLogic === "any" ? "any" : "all") : undefined,
      conditionFailureAction: resolvedType === "condition" ? (step.conditionFailureAction === "notify" || step.conditionFailureAction === "stop" ? step.conditionFailureAction : "skip") : undefined,
      outputChannel: resolvedType === "output" ? (step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook" ? step.outputChannel : "telegram") : undefined,
      outputTiming: resolvedType === "output" ? (step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate") : undefined,
      outputTime: resolvedType === "output" ? (typeof step.outputTime === "string" && step.outputTime ? step.outputTime : mission.time || "09:00") : undefined,
      outputFrequency: resolvedType === "output" ? (step.outputFrequency === "multiple" ? "multiple" : "once") : undefined,
      outputRepeatCount: resolvedType === "output" ? (typeof step.outputRepeatCount === "string" && step.outputRepeatCount ? step.outputRepeatCount : "3") : undefined,
      outputRecipients: resolvedType === "output"
        ? sanitizeOutputRecipients(
          step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
            ? step.outputChannel
            : "telegram",
          typeof step.outputRecipients === "string" ? step.outputRecipients : "",
        )
        : undefined,
      outputTemplate: resolvedType === "output" ? (typeof step.outputTemplate === "string" ? step.outputTemplate : "") : undefined,
    }
  })
}
