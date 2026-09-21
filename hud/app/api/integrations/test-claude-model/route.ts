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
      storedApiKey: config.claude.apiKey,
      storedBaseUrl: config.claude.baseUrl,
      defaultBaseUrl: "https://api.anthropic.com",
    })
    if (!target.ok) return NextResponse.json({ ok: false, error: target.error }, { status: target.status })
    const apiKey = target.apiKey
    const baseUrl = toApiBase(target.baseUrl)
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

    return NextResponse.json({ ok: true, model })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to validate Claude model availability." },
      { status: 500 },
    )
  }
}
