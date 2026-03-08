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
    const limit = Number.parseInt(String(url.searchParams.get("limit") || "12"), 10)
    const markets = await fetchPolymarketMarkets({ query, tagSlug, limit })
    return NextResponse.json({ ok: true, markets })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
