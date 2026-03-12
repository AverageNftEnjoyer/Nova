import { NextResponse } from "next/server"

import { fetchPolymarketLeaderboard, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 25
  return Math.min(100, Math.max(1, parsed))
}

function normalizeWindow(value: string | null): string {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "day" || normalized === "daily" || normalized === "1d") return "day"
  if (normalized === "week" || normalized === "weekly" || normalized === "7d") return "week"
  if (normalized === "month" || normalized === "monthly" || normalized === "30d") return "month"
  return "all"
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
    const window = normalizeWindow(url.searchParams.get("window"))
    const limit = normalizeLimit(url.searchParams.get("limit"))
    const leaderboard = await fetchPolymarketLeaderboard({ window, limit })
    return NextResponse.json({ ok: true, window, leaderboard })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
