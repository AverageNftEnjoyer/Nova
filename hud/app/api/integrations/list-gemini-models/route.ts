import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { GEMINI_MODEL_OPTIONS } from "@/app/integrations/constants/gemini-models"

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

const STANDARD_GEMINI_MODEL_MAP = new Map(
  GEMINI_MODEL_OPTIONS.map((option, index) => [
    option.value,
    { label: option.label, order: index },
  ]),
)

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

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
    const deduped = new Map<string, { id: string; label: string; createdAt: number; order: number }>()
    if (Array.isArray(data)) {
      for (const model of data) {
        const id = typeof model?.id === "string" ? model.id.trim() : ""
        if (!id) continue
        const standard = STANDARD_GEMINI_MODEL_MAP.get(id)
        if (!standard) continue
        deduped.set(id, {
          id,
          label: standard.label,
          createdAt: Number.isFinite(model.created) ? Number(model.created) : 0,
          order: standard.order,
        })
      }
    }

    const models = Array.from(deduped.values())
      .sort((a, b) => a.order - b.order)
      .map(({ id, label, createdAt }) => ({ id, label, createdAt }))

    return NextResponse.json({ ok: true, models })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to list Gemini models." },
      { status: 500 },
    )
  }
}
