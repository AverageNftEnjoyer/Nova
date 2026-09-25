import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { resolveConfiguredLlmProvider } from "@/lib/integrations/llm/provider-selection"
import { loadIntegrationsConfig, type IntegrationsConfig } from "@/lib/integrations/store/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import {
  normalizeAnthropicUsage,
  normalizeOpenAiCompatibleUsage,
  recordLlmUsageSafe,
} from "../../../../../src/providers/usage/index.js"
import {
  approxTokens,
  resolveModelRoute,
  runWithRouteFallback,
  type ModelTier,
} from "../../../../../src/runtime/modules/model-routing/index.js"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Provider = "openai" | "claude" | "grok" | "gemini"

function toOpenAiLikeBase(url: string, fallback: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return fallback
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

function toClaudeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.anthropic.com"
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed
}

function readRawUsage(payload: unknown): unknown {
  return payload && typeof payload === "object" && "usage" in payload ? (payload as { usage?: unknown }).usage : null
}

/**
 * One llm_usage row (source "utility", ref "nova-suggest") per successful suggestion call, with the model that
 * answered and the routing tier. Never throws.
 */
function recordSuggestUsage(userId: string, provider: Provider, model: string, payload: unknown, tier: ModelTier | null): void {
  const raw = readRawUsage(payload)
  recordLlmUsageSafe({
    userContextId: userId,
    source: "utility",
    refId: "nova-suggest",
    provider,
    model,
    usage: provider === "claude" ? normalizeAnthropicUsage(raw) : normalizeOpenAiCompatibleUsage(raw),
    tier,
  })
}

/** A provider HTTP error; `status` lets isModelUnavailableError recognise a 404 (model not found). */
class SuggestHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "SuggestHttpError"
    this.status = status
  }
}

const PROVIDER_LABEL: Record<Provider, string> = { claude: "Claude", grok: "Grok", gemini: "Gemini", openai: "OpenAI" }

/** One suggestion request to `provider` with `model`; returns the parsed payload or throws SuggestHttpError. */
async function requestSuggestion(
  provider: Provider,
  config: IntegrationsConfig,
  model: string,
  systemText: string,
  userText: string,
): Promise<unknown> {
  let url: string
  let headers: Record<string, string>
  let body: Record<string, unknown>
  if (provider === "claude") {
    url = `${toClaudeBase(config.claude.baseUrl)}/v1/messages`
    headers = {
      "content-type": "application/json",
      "x-api-key": config.claude.apiKey.trim(),
      "anthropic-version": "2023-06-01",
    }
    body = { model, max_tokens: 640, system: systemText, messages: [{ role: "user", content: userText }] }
  } else {
    const messages = [
      { role: "system", content: systemText },
      { role: "user", content: userText },
    ]
    headers = { Authorization: `Bearer ${config[provider].apiKey.trim()}`, "Content-Type": "application/json" }
    if (provider === "openai") {
      url = `${toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")}/chat/completions`
      body = { model, max_completion_tokens: 640, messages }
    } else {
      const fallbackBase = provider === "grok" ? "https://api.x.ai/v1" : "https://generativelanguage.googleapis.com/v1beta/openai"
      url = `${toOpenAiLikeBase(config[provider].baseUrl, fallbackBase)}/chat/completions`
      body = { model, max_tokens: 640, messages }
    }
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message || "")
        : ""
    throw new SuggestHttpError(msg || `${PROVIDER_LABEL[provider]} suggest failed (${res.status}).`, res.status)
  }
  return payload
}

function readSuggestionText(provider: Provider, payload: unknown): string {
  if (provider === "claude") {
    return Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> } | null)?.content)
      ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
      : ""
  }
  return String((payload as { choices?: Array<{ message?: { content?: string } }> } | null)?.choices?.[0]?.message?.content || "")
}

function cleanPrompt(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim()
}

function buildFallbackSuggestion(stepTitle: string): string {
  const name = String(stepTitle || "AI Process").trim() || "AI Process"
  return [
    `Analyze the incoming mission data for "${name}" and surface the most actionable findings first.`,
    "Prioritize concrete signals, anomalies, and trend changes, then add one brief recommendation for what to do next based on the evidence.",
    "Return output as 3-5 bullets with: key finding, why it matters, and recommended next action.",
  ].join(" ")
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.missionSuggest)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  let debugSelected = "server_llm=unknown model=unknown"
  try {
    const body = (await req.json()) as { stepTitle?: string }
    const stepTitle = (typeof body.stepTitle === "string" ? body.stepTitle.trim() : "") || "AI Process"

    const config = await loadIntegrationsConfig({ userId })
    const selected = resolveConfiguredLlmProvider(config)
    const provider: Provider = selected.provider
    debugSelected = `server_llm=${selected.provider} model=${selected.model}`
    const selectedModelLabel = String(selected.model || "").trim() || "fallback"

    const hasCredentials =
      (provider === "claude" && Boolean(config.claude.apiKey.trim())) ||
      (provider === "grok" && Boolean(config.grok.apiKey.trim())) ||
      (provider === "gemini" && Boolean(config.gemini.apiKey.trim())) ||
      (provider === "openai" && Boolean(config.openai.apiKey.trim()))
    if (!hasCredentials || !String(selected.model || "").trim()) {
      return NextResponse.json({
        ok: true,
        prompt: buildFallbackSuggestion(stepTitle),
        provider,
        model: selectedModelLabel,
        debug: `${debugSelected} fallback=local-suggest`,
      })
    }

    const systemText = [
      "You are Nova, an expert workflow automation prompt writer.",
      "Given a workflow step name, produce a single high-quality AI prompt for that step.",
      "The prompt must be concrete, concise, and production-ready.",
      "Write 2-3 sentences.",
      "Include richer ideas: what to analyze, what to prioritize, and what to recommend.",
      "Include an output shape expectation (for example bullets with key findings, risks, and next actions).",
      "Avoid generic filler language.",
      "Output only the prompt text and nothing else.",
    ].join(" ")
    const userText = [
      `Step name: "${stepTitle}"`,
      "Generate one detailed prompt that tells the AI exactly what to do with incoming workflow data.",
      "Make it 2-3 sentences and include at least two concrete analysis ideas relevant to this step.",
      "Include expected output structure briefly.",
    ].join("\n")

    // Step suggestions are a trivial call: Model routing may send them to the provider's economy model.
    const route = resolveModelRoute({
      userContextId: userId,
      provider,
      model: selected.model,
      callSite: "utility.nova-suggest",
      estimate: { inputTokens: approxTokens(systemText) + approxTokens(userText) },
    })
    let answered: { result: unknown; model: string }
    try {
      answered = await runWithRouteFallback(route, (model) => requestSuggestion(provider, config, model, systemText, userText))
    } catch (error) {
      if (error instanceof SuggestHttpError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
      }
      throw error
    }
    const { result: payload, model } = answered
    recordSuggestUsage(userId, provider, model, payload, route.tier)
    const routedDebug = model !== selected.model ? ` routed_model=${model}` : ""
    const prompt = cleanPrompt(readSuggestionText(provider, payload))
    if (!prompt) {
      return NextResponse.json({
        ok: true,
        prompt: buildFallbackSuggestion(stepTitle),
        provider,
        model,
        debug: `${debugSelected}${routedDebug} fallback=empty-response`,
      })
    }
    return NextResponse.json({ ok: true, prompt, provider, model, debug: `${debugSelected}${routedDebug}` })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Nova suggest failed.", debug: debugSelected },
      { status: 500 },
    )
  }
}
