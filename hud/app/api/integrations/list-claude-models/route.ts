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

type AnthropicModel = {
  id: string
  display_name?: string
  created_at?: string
}

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const body = (await req.json().catch(() => ({}))) as { apiKey?: string; baseUrl?: string }
    const config = await loadIntegrationsConfig()

    const apiKey = (typeof body.apiKey === "string" && body.apiKey.trim()) || config.claude.apiKey.trim()
    const baseUrl = toApiBase((typeof body.baseUrl === "string" && body.baseUrl.trim()) || config.claude.baseUrl)

    if (!apiKey) {
      return NextResponse.json({ ok: false, models: [], error: "Claude API key is required." })
    }

    const res = await fetch(`${baseUrl}/v1/models`, {
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
      return NextResponse.json({ ok: false, models: [], error: msg || `Failed to fetch Claude models (${res.status}).` })
    }

    const data = payload && typeof payload === "object" && "data" in payload ? (payload as { data?: AnthropicModel[] }).data : []
    const models = Array.isArray(data)
      ? data
          .filter((m) => typeof m?.id === "string" && m.id.trim().length > 0)
          .map((m) => ({
            id: m.id,
            label: m.display_name?.trim() || m.id,
            createdAt: m.created_at || "",
          }))
      : []

    return NextResponse.json({ ok: true, models })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to list Claude models." },
      { status: 500 },
    )
  }
}
