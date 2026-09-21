import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { resolveProviderProbeTarget } from "@/lib/security/provider-base-url"


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
  const { userId } = await requireLocalUser()

  try {
    const body = (await req.json()) as { apiKey?: string; baseUrl?: string }
    const config = await loadIntegrationsConfig({ userId })

    // A stored key is only ever sent to the stored/default base URL; a request-supplied base URL needs a request-supplied key.
    const target = resolveProviderProbeTarget({
      callerApiKey: body.apiKey,
      callerBaseUrl: body.baseUrl,
      storedApiKey: config.claude.apiKey,
      storedBaseUrl: config.claude.baseUrl,
      defaultBaseUrl: "https://api.anthropic.com",
    })
    if (!target.ok) return NextResponse.json({ ok: false, models: [], error: target.error }, { status: target.status })
    const apiKey = target.apiKey
    const baseUrl = toApiBase(target.baseUrl)

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

      // Never follow a redirect: it could carry the provider key header to another host.

      redirect: "error",
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
