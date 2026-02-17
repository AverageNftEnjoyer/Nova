/**
 * LLM Provider Integration
 *
 * Functions for making LLM completions with configured providers.
 */

import "server-only"

import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import { toOpenAiLikeBase, toClaudeBase } from "../utils/config"
import type { Provider, CompletionResult, CompletionOverride } from "../types"

/**
 * Complete text using the configured LLM provider.
 */
export async function completeWithConfiguredLlm(
  systemText: string,
  userText: string,
  maxTokens = 1200,
  scope?: IntegrationsStoreScope,
  override?: CompletionOverride,
): Promise<CompletionResult> {
  const config = await loadIntegrationsConfig(scope)
  const resolved = resolveConfiguredLlmProvider(config)
  const requestedProvider = override?.provider
  const provider: Provider = requestedProvider || resolved.provider

  const providerHasCredentials = (candidate: Provider): boolean => {
    if (candidate === "claude") {
      return config.claude.connected && config.claude.apiKey.trim().length > 0
    }
    if (candidate === "grok") {
      return config.grok.connected && config.grok.apiKey.trim().length > 0
    }
    if (candidate === "gemini") {
      return config.gemini.connected && config.gemini.apiKey.trim().length > 0
    }
    return config.openai.connected && config.openai.apiKey.trim().length > 0
  }

  if (!providerHasCredentials(provider)) {
    throw new Error(`Selected provider "${provider}" is not fully configured for this account.`)
  }

  const requestedModel = String(override?.model || "").trim()

  if (provider === "claude") {
    const apiKey = config.claude.apiKey.trim()
    const model = requestedModel || config.claude.defaultModel.trim()
    const baseUrl = toClaudeBase(config.claude.baseUrl)
    if (!apiKey) throw new Error("Claude API key is missing.")
    if (!model) throw new Error("Claude default model is missing.")

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemText,
        messages: [{ role: "user", content: userText }],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Claude request failed (${res.status}).`)
    }
    const text = Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> }).content)
      ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
      : ""
    return { provider, model, text: String(text || "").trim() }
  }

  if (provider === "grok") {
    const apiKey = config.grok.apiKey.trim()
    const model = requestedModel || config.grok.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.grok.baseUrl, "https://api.x.ai/v1")
    if (!apiKey) throw new Error("Grok API key is missing.")
    if (!model) throw new Error("Grok default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Grok request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  if (provider === "gemini") {
    const apiKey = config.gemini.apiKey.trim()
    const model = requestedModel || config.gemini.defaultModel.trim()
    const baseUrl = toOpenAiLikeBase(config.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai")
    if (!apiKey) throw new Error("Gemini API key is missing.")
    if (!model) throw new Error("Gemini default model is missing.")

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
      throw new Error(msg || `Gemini request failed (${res.status}).`)
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    return { provider, model, text: text.trim() }
  }

  // OpenAI (default)
  const apiKey = config.openai.apiKey.trim()
  const model = requestedModel || config.openai.defaultModel.trim()
  const baseUrl = toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")
  if (!apiKey) throw new Error("OpenAI API key is missing.")
  if (!model) throw new Error("OpenAI default model is missing.")

  const openAiModelLower = model.toLowerCase()
  const supportsCustomTemperature =
    !openAiModelLower.startsWith("gpt-5") &&
    !openAiModelLower.startsWith("o1") &&
    !openAiModelLower.startsWith("o3")

  const openAiBody: Record<string, unknown> = {
    model,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText },
    ],
  }
  if (supportsCustomTemperature) {
    openAiBody.temperature = 0.2
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(openAiBody),
    cache: "no-store",
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message || "")
      : ""
    throw new Error(msg || `OpenAI request failed (${res.status}).`)
  }
  const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
  return { provider: "openai", model, text: text.trim() }
}
