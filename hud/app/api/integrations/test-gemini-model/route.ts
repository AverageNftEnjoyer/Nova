import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { resolveProviderProbeTarget } from "@/lib/security/provider-base-url"
import { normalizeOpenAiCompatibleUsage, recordLlmUsageSafe } from "../../../../../src/providers/usage/index.js"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://generativelanguage.googleapis.com/v1beta/openai"
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const body = (await req.json()) as {
      apiKey?: string
      baseUrl?: string
      model?: string
    }
    const config = await loadIntegrationsConfig({ userId })

    // A stored key is only ever sent to the stored/default base URL; a request-supplied base URL needs a request-supplied key.
    const target = resolveProviderProbeTarget({
      callerApiKey: body.apiKey,
      callerBaseUrl: body.baseUrl,
      storedApiKey: config.gemini.apiKey,
      storedBaseUrl: config.gemini.baseUrl,
      defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    })
    if (!target.ok) return NextResponse.json({ ok: false, error: target.error }, { status: target.status })
    const apiKey = target.apiKey
    const baseUrl = toApiBase(target.baseUrl)
    const model = (typeof body.model === "string" && body.model.trim()) || config.gemini.defaultModel

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Gemini API key is required." }, { status: 400 })
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "Model is required." }, { status: 400 })
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
      cache: "no-store",

      // Never follow a redirect: it could carry the provider key header to another host.

      redirect: "error",
    })

    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: { message?: string } }).error?.message || "")
          : ""
      return NextResponse.json(
        { ok: false, error: msg || `Model "${model}" is not available for this key (${res.status}).` },
        { status: 400 },
      )
    }

    // Unlike the other providers' model probes (free GET /models/{id}), this probe is a billed 16-token completion,
    // so it lands one llm_usage row (source "utility", ref "model-test").
    recordLlmUsageSafe({
      userContextId: userId,
      source: "utility",
      refId: "model-test",
      provider: "gemini",
      model,
      usage: normalizeOpenAiCompatibleUsage(
        payload && typeof payload === "object" && "usage" in payload ? (payload as { usage?: unknown }).usage : null,
      ),
    })
    return NextResponse.json({ ok: true, model })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to validate Gemini model availability." },
      { status: 500 },
    )
  }
}
