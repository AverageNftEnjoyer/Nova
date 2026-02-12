import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://api.openai.com/v1"
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

export async function POST() {
  try {
    const config = await loadIntegrationsConfig()
    const apiKey = config.openai.apiKey.trim()
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OpenAI API key is required." }, { status: 400 })
    }

    const base = toApiBase(config.openai.baseUrl)
    const endpoint = `${base}/models`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }

    const res = await fetch(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
    })

    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        body && typeof body === "object" && "error" in body
          ? String((body as { error?: { message?: string } }).error?.message || "")
          : ""
      return NextResponse.json(
        { ok: false, error: msg || `OpenAI verification failed (${res.status}).` },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to verify OpenAI integration." },
      { status: 500 },
    )
  }
}
