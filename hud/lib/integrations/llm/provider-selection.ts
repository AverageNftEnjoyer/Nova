import "server-only"

import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
} from "@/app/integrations/constants"
import type { IntegrationsConfig, LlmProvider } from "@/lib/integrations/store/server-store"

export interface ResolvedProviderSelection {
  provider: LlmProvider
  model: string
}

export interface ConfiguredLlmProvider {
  provider: LlmProvider
  label: string
  defaultModel: string
  models: Array<{ value: string; label: string }>
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "OpenAI",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
}

const KNOWN_MODELS: Record<LlmProvider, Array<{ value: string; label: string }>> = {
  openai: OPENAI_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  claude: CLAUDE_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  gemini: GEMINI_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
  grok: GROK_MODEL_OPTIONS.map(({ value, label }) => ({ value, label })),
}

export function providerReady(config: IntegrationsConfig, provider: LlmProvider): boolean {
  if (provider === "claude") {
    return config.claude.connected && config.claude.apiKey.trim().length > 0 && config.claude.defaultModel.trim().length > 0
  }
  if (provider === "grok") {
    return config.grok.connected && config.grok.apiKey.trim().length > 0 && config.grok.defaultModel.trim().length > 0
  }
  if (provider === "gemini") {
    return config.gemini.connected && config.gemini.apiKey.trim().length > 0 && config.gemini.defaultModel.trim().length > 0
  }
  return config.openai.connected && config.openai.apiKey.trim().length > 0 && config.openai.defaultModel.trim().length > 0
}

function modelForProvider(config: IntegrationsConfig, provider: LlmProvider): string {
  if (provider === "claude") return config.claude.defaultModel.trim()
  if (provider === "grok") return config.grok.defaultModel.trim()
  if (provider === "gemini") return config.gemini.defaultModel.trim()
  return config.openai.defaultModel.trim()
}

export function listConfiguredLlmProviders(config: IntegrationsConfig): ConfiguredLlmProvider[] {
  const providers: LlmProvider[] = ["openai", "claude", "gemini", "grok"]
  return providers.flatMap((provider) => {
    if (!providerReady(config, provider)) return []
    const defaultModel = modelForProvider(config, provider)
    const known = KNOWN_MODELS[provider]
    const models = known.some((option) => option.value === defaultModel)
      ? known
      : [{ value: defaultModel, label: defaultModel }, ...known]
    return [{
      provider,
      label: PROVIDER_LABELS[provider],
      defaultModel,
      models,
    }]
  })
}

export function resolveConfiguredLlmProvider(config: IntegrationsConfig): ResolvedProviderSelection {
  const active = config.activeLlmProvider
  if (!providerReady(config, active)) {
    throw new Error(
      `Active LLM provider "${active}" is not fully configured (connected + API key + default model required). Update Integrations settings.`,
    )
  }
  return { provider: active, model: modelForProvider(config, active) }
}

export function validateConfiguredLlmSelection(
  config: IntegrationsConfig,
  provider: LlmProvider,
  model: string,
): ResolvedProviderSelection {
  const configured = listConfiguredLlmProviders(config).find((candidate) => candidate.provider === provider)
  if (!configured) {
    throw new Error(`LLM provider "${provider}" is not configured. Connect it in Integrations first.`)
  }
  if (!configured.models.some((candidate) => candidate.value === model)) {
    throw new Error(`Model "${model}" is not available for provider "${provider}".`)
  }
  return { provider, model }
}
