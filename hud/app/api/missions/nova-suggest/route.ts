import { NextResponse } from "next/server"

import { resolveConfiguredLlmProvider } from "@/lib/integrations/provider-selection"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

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
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  let debugSelected = "server_llm=unknown model=unknown"
  try {
    const body = (await req.json().catch(() => ({}))) as { stepTitle?: string }
    const stepTitle = (typeof body.stepTitle === "string" ? body.stepTitle.trim() : "") || "AI Process"

    const config = await loadIntegrationsConfig(verified)
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

    if (provider === "claude") {
      const apiKey = config.claude.apiKey.trim()
      const model = selected.model
      const baseUrl = toClaudeBase(config.claude.baseUrl)
      if (!apiKey) return NextResponse.json({ ok: false, error: "Claude API key is missing." }, { status: 400 })
      if (!model) return NextResponse.json({ ok: false, error: "Claude default model is missing." }, { status: 400 })

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 640,
          system: systemText,
          messages: [{ role: "user", content: userText }],
        }),
        cache: "no-store",
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: { message?: string } }).error?.message || "")
            : ""
        return NextResponse.json({ ok: false, error: msg || `Claude suggest failed (${res.status}).` }, { status: 400 })
      }
      const text =
        Array.isArray((payload as { content?: Array<{ type?: string; text?: string }> }).content)
          ? ((payload as { content: Array<{ type?: string; text?: string }> }).content.find((c) => c?.type === "text")?.text || "")
          : ""
      const prompt = cleanPrompt(text)
      if (!prompt) {
        return NextResponse.json({
          ok: true,
          prompt: buildFallbackSuggestion(stepTitle),
          provider,
          model,
          debug: `${debugSelected} fallback=empty-response`,
        })
      }
      return NextResponse.json({ ok: true, prompt, provider, model, debug: debugSelected })
    }

    if (provider === "grok") {
      const apiKey = config.grok.apiKey.trim()
      const model = selected.model
      const baseUrl = toOpenAiLikeBase(config.grok.baseUrl, "https://api.x.ai/v1")
      if (!apiKey) return NextResponse.json({ ok: false, error: "Grok API key is missing." }, { status: 400 })
      if (!model) return NextResponse.json({ ok: false, error: "Grok default model is missing." }, { status: 400 })

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 640,
          messages: [
            { role: "system", content: systemText },
            { role: "user", content: userText },
          ],
        }),
        cache: "no-store",
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: { message?: string } }).error?.message || "")
            : ""
        return NextResponse.json({ ok: false, error: msg || `Grok suggest failed (${res.status}).` }, { status: 400 })
      }
      const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
      const prompt = cleanPrompt(text)
      if (!prompt) {
        return NextResponse.json({
          ok: true,
          prompt: buildFallbackSuggestion(stepTitle),
          provider,
          model,
          debug: `${debugSelected} fallback=empty-response`,
        })
      }
      return NextResponse.json({ ok: true, prompt, provider, model, debug: debugSelected })
    }

    if (provider === "gemini") {
      const apiKey = config.gemini.apiKey.trim()
      const model = selected.model
      const baseUrl = toOpenAiLikeBase(config.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai")
      if (!apiKey) return NextResponse.json({ ok: false, error: "Gemini API key is missing." }, { status: 400 })
      if (!model) return NextResponse.json({ ok: false, error: "Gemini default model is missing." }, { status: 400 })

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 640,
          messages: [
            { role: "system", content: systemText },
            { role: "user", content: userText },
          ],
        }),
        cache: "no-store",
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: { message?: string } }).error?.message || "")
            : ""
        return NextResponse.json({ ok: false, error: msg || `Gemini suggest failed (${res.status}).` }, { status: 400 })
      }
      const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
      const prompt = cleanPrompt(text)
      if (!prompt) {
        return NextResponse.json({
          ok: true,
          prompt: buildFallbackSuggestion(stepTitle),
          provider,
          model,
          debug: `${debugSelected} fallback=empty-response`,
        })
      }
      return NextResponse.json({ ok: true, prompt, provider, model, debug: debugSelected })
    }

    const apiKey = config.openai.apiKey.trim()
    const model = selected.model
    const baseUrl = toOpenAiLikeBase(config.openai.baseUrl, "https://api.openai.com/v1")
    if (!apiKey) return NextResponse.json({ ok: false, error: "OpenAI API key is missing." }, { status: 400 })
    if (!model) return NextResponse.json({ ok: false, error: "OpenAI default model is missing." }, { status: 400 })

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: 640,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
      }),
      cache: "no-store",
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: { message?: string } }).error?.message || "")
          : ""
      return NextResponse.json({ ok: false, error: msg || `OpenAI suggest failed (${res.status}).` }, { status: 400 })
    }
    const text = String((payload as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content || "")
    const prompt = cleanPrompt(text)
    if (!prompt) {
      return NextResponse.json({
        ok: true,
        prompt: buildFallbackSuggestion(stepTitle),
        provider,
        model,
        debug: `${debugSelected} fallback=empty-response`,
      })
    }
    return NextResponse.json({ ok: true, prompt, provider, model, debug: debugSelected })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Nova suggest failed.", debug: debugSelected },
      { status: 500 },
    )
  }
}
