import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { buildAnalyticsData, resolveAnalyticsDays, resolveTimeZone } from "@/lib/analytics/usage-analytics"
import { ANALYTICS_TIME_ZONE_PARAM, type AnalyticsResponse } from "@/lib/analytics/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/analytics?days=N&tz=Area/City (days 1..90, default 30; tz = the viewer's IANA zone, default the
 * server's) → agent-task stats + LLM usage for the range + budget state and budget event history.
 */
export async function GET(req: Request) {
  try {
    const { userId } = await requireLocalUser()
    const params = new URL(req.url).searchParams
    const days = resolveAnalyticsDays(params.get("days"))
    const timeZone = resolveTimeZone(params.get(ANALYTICS_TIME_ZONE_PARAM))
    const analytics = await buildAnalyticsData(userId, days, timeZone)
    return NextResponse.json<AnalyticsResponse>({ ok: true, analytics })
  } catch (error) {
    console.error("[analytics] Failed to build analytics:", error)
    return NextResponse.json<AnalyticsResponse>(
      { ok: false, error: "Could not load analytics. Please try again in a moment." },
      { status: 500 },
    )
  }
}
