/**
 * LLM Provider Integration
 *
 * Functions for making LLM completions with configured providers.
 */

import "server-only"

import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/llm/provider-selection"
import { toOpenAiLikeBase, toClaudeBase } from "../utils/config"
import type { Provider, CompletionResult, CompletionOverride } from "../types/index"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const MISSION_LLM_TIMEOUT_MS = readIntEnv("NOVA_MISSION_LLM_TIMEOUT_MS", 25_000, 1_000, 180_000)

async function postJsonWithTimeout(url: string, init: RequestInit): Promise<{ res: Response; payload: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MISSION_LLM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    const payload = await res.json().catch(() => null)
    return { res, payload }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LLM request timed out after ${MISSION_LLM_TIMEOUT_MS}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Complete text using the configured LLM provider.
 */
export async function completeWithConfiguredLlm(
  systemText: string,
  userText: string,
  maxTokens = 2200,
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

    const { res, payload } = await postJsonWithTimeout(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        system: systemText,
        messages: [{ role: "user", content: userText }],
      }),
      cache: "no-store",
    })
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

    const { res, payload } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
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

    const { res, payload } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
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

  const openAiBody: Record<string, unknown> = {
    model,
    max_completion_tokens: maxTokens,
    temperature: 0,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText },
    ],
  }

  const { res, payload } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(openAiBody),
    cache: "no-store",
  })
  if (!res.ok) {
    const msg = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message || "")
      : ""
    throw new Error(msg || `OpenAI request failed (${res.status}).`)
  }
  const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
  return { provider: "openai", model, text: text.trim() }
}
