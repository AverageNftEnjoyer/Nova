import { NextResponse } from "next/server"

import {
  fetchPolymarketMarketBySlug,
  fetchPolymarketMarkets,
  toPolymarketServerError,
} from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeLimit(value: string | null, fallback: number, maxValue: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(maxValue, Math.max(1, parsed))
}

function normalizeOffset(value: string | null): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.min(10_000, parsed)
}

function normalizeAscending(value: string | null): boolean | undefined {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === "1" || normalized === "true" || normalized === "asc" || normalized === "ascending") return true
  if (normalized === "0" || normalized === "false" || normalized === "desc" || normalized === "descending") return false
  return undefined
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const url = new URL(req.url)
    const slug = String(url.searchParams.get("slug") || "").trim()
    if (slug) {
      const market = await fetchPolymarketMarketBySlug(slug)
      if (!market) {
        return NextResponse.json({ ok: false, error: "Market not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, market })
    }

    const query = String(url.searchParams.get("q") || "").trim()
    const tagSlug = String(url.searchParams.get("tag") || "").trim()
    const limit = normalizeLimit(url.searchParams.get("limit"), 12, 24)
    const offset = normalizeOffset(url.searchParams.get("offset"))
    const order = String(url.searchParams.get("sort") || url.searchParams.get("order") || "").trim()
    const ascending = normalizeAscending(url.searchParams.get("ascending"))
    const markets = await fetchPolymarketMarkets({ query, tagSlug, limit, offset, order, ascending })
    return NextResponse.json({ ok: true, markets })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
