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
  const allowFallback = String(process.env.NOVA_ALLOW_PROVIDER_FALLBACK || "").trim() === "1"
  if (providerReady(config, active)) {
    return { provider: active, model: modelForProvider(config, active) }
  }

  if (!allowFallback) {
    throw new Error(
      `Active LLM provider "${active}" is not fully configured (connected + API key + default model required). Update Integrations or explicitly enable NOVA_ALLOW_PROVIDER_FALLBACK=1.`,
    )
  }

  const connectedCandidates: LlmProvider[] = []
  if (config.claude.connected) connectedCandidates.push("claude")
  if (config.openai.connected) connectedCandidates.push("openai")
  if (config.gemini.connected) connectedCandidates.push("gemini")
  if (config.grok.connected) connectedCandidates.push("grok")

  for (const candidate of connectedCandidates) {
    if (providerReady(config, candidate)) {
      return { provider: candidate, model: modelForProvider(config, candidate) }
    }
  }

  const allCandidates: LlmProvider[] = ["claude", "openai", "gemini", "grok"]
  for (const candidate of allCandidates) {
    if (providerReady(config, candidate)) {
      return { provider: candidate, model: modelForProvider(config, candidate) }
    }
  }

  throw new Error("No configured LLM provider has a valid API key and default model. Update Integrations settings.")
}
