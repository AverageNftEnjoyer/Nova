import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.x.ai/v1"
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as {
      apiKey?: string
      baseUrl?: string
      model?: string
    }
    const config = await loadIntegrationsConfig(verified)

    const apiKey = (typeof body.apiKey === "string" && body.apiKey.trim()) || config.grok.apiKey.trim()
    const baseUrl = toApiBase((typeof body.baseUrl === "string" && body.baseUrl.trim()) || config.grok.baseUrl)
    const model = (typeof body.model === "string" && body.model.trim()) || config.grok.defaultModel

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Grok API key is required." }, { status: 400 })
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "Model is required." }, { status: 400 })
    }

    const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}`
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
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

    return NextResponse.json({ ok: true, model })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to validate Grok model availability." },
      { status: 500 },
    )
  }
}
