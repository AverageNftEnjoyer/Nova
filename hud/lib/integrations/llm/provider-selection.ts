import "server-only"

import type { IntegrationsConfig, LlmProvider } from "@/lib/integrations/store/server-store"

export interface ResolvedProviderSelection {
  provider: LlmProvider
  model: string
}

function providerReady(config: IntegrationsConfig, provider: LlmProvider): boolean {
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

export function resolveConfiguredLlmProvider(config: IntegrationsConfig): ResolvedProviderSelection {
  const active = config.activeLlmProvider
  if (!providerReady(config, active)) {
    throw new Error(
      `Active LLM provider "${active}" is not fully configured (connected + API key + default model required). Update Integrations settings.`,
    )
  }
  return { provider: active, model: modelForProvider(config, active) }
}
