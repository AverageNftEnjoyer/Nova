import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { fetchPolymarketEvents, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeLimit(value: string | null): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 20
  return Math.min(100, Math.max(1, parsed))
}

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const url = new URL(req.url)
    const tagSlug = String(url.searchParams.get("tag") || "").trim()
    const limit = normalizeLimit(url.searchParams.get("limit"))
    const events = await fetchPolymarketEvents({ tagSlug, limit })
    return NextResponse.json({ ok: true, events })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
