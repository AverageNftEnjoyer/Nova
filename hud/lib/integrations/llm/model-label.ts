import type { IntegrationsSettings, LlmProvider } from "@/lib/integrations/store/client-store"

export function formatCompactModelLabel(provider: LlmProvider, model: string): string {
  const modelRaw = String(model || "").trim()
  const modelLower = modelRaw.toLowerCase()

  if (!modelRaw || modelRaw === "N/A") return "Model Unset"

  if (provider === "openai") {
    const known: Record<string, string> = {
      "gpt-5.2": "GPT-5.2",
      "gpt-5.2-pro": "GPT-5.2 Pro",
      "gpt-5": "GPT-5",
      "gpt-5-mini": "GPT-5 Mini",
      "gpt-5-nano": "GPT-5 Nano",
      "gpt-4.1": "GPT-4.1",
      "gpt-4.1-mini": "GPT-4.1 Mini",
      "gpt-4.1-nano": "GPT-4.1 Nano",
      "gpt-4o": "GPT-4o",
      "gpt-4o-mini": "GPT-4o Mini",
    }
    if (known[modelLower]) return known[modelLower]
    if (modelLower.startsWith("gpt-")) return modelRaw.toUpperCase()
    return modelRaw
  }

  if (provider === "grok") {
    if (modelLower === "grok-4-1-fast-reasoning") return "4.1 FR"
    if (modelLower === "grok-4-1-fast-non-reasoning") return "4.1 FNR"
    if (modelLower === "grok-4-1") return "4.1"
    if (modelLower === "grok-4-fast-reasoning") return "4 FR"
    if (modelLower === "grok-4-fast-non-reasoning") return "4 FNR"
    if (modelLower === "grok-4-0709") return "4"
    if (modelLower === "grok-3-mini") return "3 Mini"
    if (modelLower === "grok-3") return "3"
    if (modelLower === "grok-code-fast-1") return "Code F1"
    return modelRaw.replace(/^grok[-\s]*/i, "").trim() || modelRaw
  }

  if (provider === "claude") {
    if (modelLower.startsWith("claude-opus-4-1")) return "Opus 4.1"
    if (modelLower.startsWith("claude-opus-4")) return "Opus 4"
    if (modelLower.startsWith("claude-sonnet-4")) return "Sonnet 4"
    if (modelLower.startsWith("claude-3-7-sonnet")) return "3.7 Sonnet"
    if (modelLower.startsWith("claude-3-5-sonnet")) return "3.5 Sonnet"
    if (modelLower.startsWith("claude-3-5-haiku")) return "3.5 Haiku"
    return modelRaw.replace(/^claude[-\s]*/i, "").trim() || modelRaw
  }

  if (provider === "gemini") {
    if (modelLower === "gemini-2.5-pro") return "2.5 Pro"
    if (modelLower === "gemini-2.5-flash") return "2.5 Flash"
    if (modelLower === "gemini-2.5-flash-lite") return "2.5 Flash Lite"
    if (modelLower === "gemini-2.0-flash") return "2.0 Flash"
    if (modelLower === "gemini-2.0-flash-lite") return "2.0 Flash Lite"
    return modelRaw.replace(/^gemini[-\s]*/i, "").trim() || modelRaw
  }

  return modelRaw
}

export function formatCompactModelLabelFromRunningLabel(runningNowLabel?: string): string | null {
  if (!runningNowLabel) return null
  const raw = runningNowLabel.trim()
  if (!raw) return null
  if (raw === "Needs Setup") return "Model Unset"

  const separatorIndex = raw.indexOf(" - ")
  if (separatorIndex < 0) return raw

  const providerRaw = raw.slice(0, separatorIndex).trim().toLowerCase()
  const modelRaw = raw.slice(separatorIndex + 3).trim()
  if (!modelRaw || modelRaw === "N/A") return null

  const provider: LlmProvider =
    providerRaw === "claude"
      ? "claude"
      : providerRaw === "grok"
        ? "grok"
        : providerRaw === "gemini"
          ? "gemini"
          : "openai"

  return formatCompactModelLabel(provider, modelRaw)
}

export function formatCompactModelLabelFromIntegrations(settings: IntegrationsSettings): string {
  const provider = settings.activeLlmProvider || "openai"
  const model =
    provider === "claude"
      ? settings.claude.defaultModel
      : provider === "grok"
        ? settings.grok.defaultModel
        : provider === "gemini"
          ? settings.gemini.defaultModel
          : settings.openai.defaultModel
  return formatCompactModelLabel(provider, model)
}
