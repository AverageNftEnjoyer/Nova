import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://generativelanguage.googleapis.com/v1beta/openai"
  if (trimmed.includes("/v1beta/openai") || /\/openai$/i.test(trimmed)) return trimmed
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`
}

type GeminiModel = {
  id?: string
  created?: number
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as { apiKey?: string; baseUrl?: string }
    const config = await loadIntegrationsConfig(verified)

    const apiKey = (typeof body.apiKey === "string" && body.apiKey.trim()) || config.gemini.apiKey.trim()
    const baseUrl = toApiBase((typeof body.baseUrl === "string" && body.baseUrl.trim()) || config.gemini.baseUrl)

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Gemini API key is required." }, { status: 400 })
    }

    const res = await fetch(`${baseUrl}/models`, {
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
        { ok: false, error: msg || `Failed to fetch Gemini models (${res.status}).` },
        { status: 400 },
      )
    }

    const data =
      payload && typeof payload === "object" && "data" in payload
        ? (payload as { data?: GeminiModel[] }).data
        : []
    const models = Array.isArray(data)
      ? data
          .filter((m) => typeof m?.id === "string" && m.id.trim().length > 0)
          .map((m) => ({
            id: String(m.id).trim(),
            label: String(m.id).trim(),
            createdAt: Number.isFinite(m.created) ? Number(m.created) : 0,
          }))
      : []

    return NextResponse.json({ ok: true, models })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to list Gemini models." },
      { status: 500 },
    )
  }
}
