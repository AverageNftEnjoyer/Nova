import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.anthropic.com"
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed
}

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const body = (await req.json().catch(() => ({}))) as {
      apiKey?: string
      baseUrl?: string
      model?: string
    }
    const config = await loadIntegrationsConfig()

    const apiKey = (typeof body.apiKey === "string" && body.apiKey.trim()) || config.claude.apiKey.trim()
    const baseUrl = toApiBase((typeof body.baseUrl === "string" && body.baseUrl.trim()) || config.claude.baseUrl)
    const model = (typeof body.model === "string" && body.model.trim()) || config.claude.defaultModel

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Claude API key is required." }, { status: 400 })
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "Model is required." }, { status: 400 })
    }

    const res = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(model)}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
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
      { ok: false, error: error instanceof Error ? error.message : "Failed to validate Claude model availability." },
      { status: 500 },
    )
  }
}
