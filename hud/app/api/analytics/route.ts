import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { buildAnalyticsData, resolveAnalyticsDays } from "@/lib/analytics/usage-analytics"
import type { AnalyticsResponse } from "@/lib/analytics/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/analytics?days=N (1..90, default 30) → agent-task stats + LLM usage for the range + budget state. */
export async function GET(req: Request) {
  try {
    const { userId } = await requireLocalUser()
    const days = resolveAnalyticsDays(new URL(req.url).searchParams.get("days"))
    const analytics = await buildAnalyticsData(userId, days)
    return NextResponse.json<AnalyticsResponse>({ ok: true, analytics })
  } catch (error) {
    console.error("[analytics] Failed to build analytics:", error)
    return NextResponse.json<AnalyticsResponse>(
      { ok: false, error: "Could not load analytics. Please try again in a moment." },
      { status: 500 },
    )
  }
}
