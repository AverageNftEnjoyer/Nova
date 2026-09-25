/**
 * LLM Provider Integration
 *
 * Functions for making LLM completions with configured providers.
 */

import "server-only"

import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { resolveConfiguredLlmProvider } from "@/lib/integrations/llm/provider-selection"
import { toOpenAiLikeBase, toClaudeBase } from "../utils/config"
import {
  normalizeAnthropicUsage,
  normalizeOpenAiCompatibleUsage,
  recordLlmUsageSafe,
  type LlmUsage,
} from "../../../../src/providers/usage/index.js"
import { resolveCurrentModelId } from "../../../../src/providers/models/retired-model-aliases/index.js"
import {
  approxTokens,
  resolveModelRoute,
  runWithRouteFallback,
  type ModelRoute,
  type ModelTier,
} from "../../../../src/runtime/modules/model-routing/index.js"
import type { Provider, CompletionResult, CompletionOverride, CompletionUsageContext } from "../types/index"

/**
 * Claude models before 4.7 accept a sampling temperature; Claude 4.7 and later (Sonnet 5, Opus 5.x, Fable 5.x, ...)
 * return 400 for a non-default temperature, and the docs say to omit it
 * (https://platform.claude.com/docs/en/about-claude/model-deprecations, "API parameter deprecations", 2026-09-24).
 */
const CLAUDE_MODELS_WITH_TEMPERATURE = /^claude-(?:haiku-4-5|sonnet-4-5|sonnet-4-6|opus-4-5|opus-4-6)(?:-|$)/

function claudeAcceptsTemperature(model: string): boolean {
  return CLAUDE_MODELS_WITH_TEMPERATURE.test(model.trim().toLowerCase())
}

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

/** The user the integrations config was loaded for (same resolution as the integrations store). */
function resolveScopeUserId(scope?: IntegrationsStoreScope): string {
  const userId = (typeof scope?.userId === "string" ? scope.userId : "") || (typeof scope?.user?.id === "string" ? scope.user.id : "")
  return String(userId || "").trim() || "local-user"
}

/** One llm_usage row per successful completion (source usageContext.source, default "mission"). Never throws. */
function recordMissionUsage(
  provider: Provider,
  model: string,
  usage: LlmUsage,
  scope?: IntegrationsStoreScope,
  usageContext?: CompletionUsageContext,
  tier?: ModelTier | null,
): LlmUsage {
  recordLlmUsageSafe({
    userContextId: resolveScopeUserId(scope),
    source: usageContext?.source === "utility" ? "utility" : "mission",
    refId: String(usageContext?.refId || "").trim(),
    provider,
    model,
    usage,
    ...(tier ? { tier } : {}),
  })
  return usage
}

/** A provider HTTP error that keeps its status, so isModelUnavailableError can recognise a 404 (model not found). */
function providerHttpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function readProviderErrorMessage(payload: unknown): string {
  return payload && typeof payload === "object" && "error" in payload
    ? String((payload as { error?: { message?: string } }).error?.message || "")
    : ""
}

/**
 * The model route of one call. Without a call site the call is not routed (selected model, no tier), so the request
 * is byte-identical to the pre-routing client. A node's explicit model is the user's choice: never routed.
 */
function resolveCompletionRoute(input: {
  provider: Provider
  selectedModel: string
  systemText: string
  userText: string
  scope?: IntegrationsStoreScope
  override?: CompletionOverride
  usageContext?: CompletionUsageContext
}): ModelRoute | null {
  const callSite = input.usageContext?.callSite
  if (!callSite) return null
  return resolveModelRoute({
    userContextId: resolveScopeUserId(input.scope),
    provider: input.provider,
    model: input.selectedModel,
    callSite,
    explicitModel: Boolean(input.override?.model),
    estimate: { inputTokens: approxTokens(input.systemText) + approxTokens(input.userText) },
  })
}

/** Run `call` on the routed model (retried once on the selected model if the provider refuses the economy model). */
async function runCompletion<T>(
  route: ModelRoute | null,
  selectedModel: string,
  call: (model: string) => Promise<T>,
): Promise<{ result: T; model: string }> {
  if (!route) return { result: await call(selectedModel), model: selectedModel }
  return runWithRouteFallback(route, call)
}

/** `tier` / `routed` of a routed call's result (nothing for an unrouted caller, so its result shape is unchanged). */
function routeResultFields(route: ModelRoute | null, answeredModel: string): Pick<CompletionResult, "tier" | "routed"> {
  if (!route) return {}
  return { tier: route.tier, routed: route.routed && answeredModel === route.model }
}

function readRawUsage(payload: unknown): unknown {
  return payload && typeof payload === "object" && "usage" in payload ? (payload as { usage?: unknown }).usage : null
}

/**
 * Complete text using the configured LLM provider.
 * Every successful call returns its normalised `usage` and writes one llm_usage row (source
 * usageContext.source, default "mission"; ref = usageContext.refId). A call that fails (HTTP error, timeout) returns no usage and writes no row.
 * With usageContext.callSite the call is routed (Settings -> Model routing): it may be sent to the provider's economy
 * model, is retried once on the selected model if the provider refuses that model, and its row records the model that
 * answered plus the call site's tier. Without a callSite the request and the row are exactly as before routing.
 */
export async function completeWithConfiguredLlm(
  systemText: string,
  userText: string,
  maxTokens = 2200,
  scope?: IntegrationsStoreScope,
  override?: CompletionOverride,
  usageContext?: CompletionUsageContext,
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

  // A node override or stored default may name a retired model: send its current replacement instead.
  const requestedModel = resolveCurrentModelId(provider, override?.model)

  if (provider === "claude") {
    const apiKey = config.claude.apiKey.trim()
    const model = requestedModel || resolveCurrentModelId("claude", config.claude.defaultModel)
    const baseUrl = toClaudeBase(config.claude.baseUrl)
    if (!apiKey) throw new Error("Claude API key is missing.")
    if (!model) throw new Error("Claude default model is missing.")

    const route = resolveCompletionRoute({ provider, selectedModel: model, systemText, userText, scope, override, usageContext })
    const { result: payload, model: answeredModel } = await runCompletion(route, model, async (sendModel) => {
      const { res, payload: body } = await postJsonWithTimeout(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: sendModel,
          max_tokens: maxTokens,
          ...(claudeAcceptsTemperature(sendModel) ? { temperature: 0 } : {}),
          system: systemText,
          messages: [{ role: "user", content: userText }],
        }),
        cache: "no-store",
      })
      if (!res.ok) {
        throw providerHttpError(readProviderErrorMessage(body) || `Claude request failed (${res.status}).`, res.status)
      }
      return body
    })
    const text = Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> }).content)
      ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
      : ""
    const usage = recordMissionUsage(provider, answeredModel, normalizeAnthropicUsage(readRawUsage(payload)), scope, usageContext, route?.tier)
    return { provider, model: answeredModel, text: String(text || "").trim(), usage, ...routeResultFields(route, answeredModel) }
  }

  if (provider === "grok") {
    const apiKey = config.grok.apiKey.trim()
    const model = requestedModel || resolveCurrentModelId("grok", config.grok.defaultModel)
    const baseUrl = toOpenAiLikeBase(config.grok.baseUrl, "https://api.x.ai/v1")
    if (!apiKey) throw new Error("Grok API key is missing.")
    if (!model) throw new Error("Grok default model is missing.")

    const route = resolveCompletionRoute({ provider, selectedModel: model, systemText, userText, scope, override, usageContext })
    const { result: payload, model: answeredModel } = await runCompletion(route, model, async (sendModel) => {
      const { res, payload: body } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: sendModel,
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
        throw providerHttpError(readProviderErrorMessage(body) || `Grok request failed (${res.status}).`, res.status)
      }
      return body
    })
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    const usage = recordMissionUsage(provider, answeredModel, normalizeOpenAiCompatibleUsage(readRawUsage(payload)), scope, usageContext, route?.tier)
    return { provider, model: answeredModel, text: text.trim(), usage, ...routeResultFields(route, answeredModel) }
  }

  if (provider === "gemini") {
    const apiKey = config.gemini.apiKey.trim()
    const model = requestedModel || resolveCurrentModelId("gemini", config.gemini.defaultModel)
    const baseUrl = toOpenAiLikeBase(config.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai")
    if (!apiKey) throw new Error("Gemini API key is missing.")
    if (!model) throw new Error("Gemini default model is missing.")

    const route = resolveCompletionRoute({ provider, selectedModel: model, systemText, userText, scope, override, usageContext })
    const { result: payload, model: answeredModel } = await runCompletion(route, model, async (sendModel) => {
      const { res, payload: body } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: sendModel,
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
        throw providerHttpError(readProviderErrorMessage(body) || `Gemini request failed (${res.status}).`, res.status)
      }
      return body
    })
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    const usage = recordMissionUsage(provider, answeredModel, normalizeOpenAiCompatibleUsage(readRawUsage(payload)), scope, usageContext, route?.tier)
    return { provider, model: answeredModel, text: text.trim(), usage, ...routeResultFields(route, answeredModel) }
  }

  // OpenAI (default)
  const apiKey = config.openai.apiKey.trim()
  const model = requestedModel || resolveCurrentModelId("openai", config.openai.defaultModel)
  const baseUrl = toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")
  if (!apiKey) throw new Error("OpenAI API key is missing.")
  if (!model) throw new Error("OpenAI default model is missing.")

  const route = resolveCompletionRoute({ provider: "openai", selectedModel: model, systemText, userText, scope, override, usageContext })
  const { result: payload, model: answeredModel } = await runCompletion(route, model, async (sendModel) => {
    const openAiBody: Record<string, unknown> = {
      model: sendModel,
      max_completion_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }

    const { res, payload: body } = await postJsonWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(openAiBody),
      cache: "no-store",
    })
    if (!res.ok) {
      throw providerHttpError(readProviderErrorMessage(body) || `OpenAI request failed (${res.status}).`, res.status)
    }
    return body
  })
  const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
  const usage = recordMissionUsage("openai", answeredModel, normalizeOpenAiCompatibleUsage(readRawUsage(payload)), scope, usageContext, route?.tier)
  return { provider: "openai", model: answeredModel, text: text.trim(), usage, ...routeResultFields(route, answeredModel) }
}
