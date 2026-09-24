import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { buildAnalyticsSummary } from "@/lib/analytics/usage-analytics"
import type { AnalyticsSummaryResponse } from "@/lib/analytics/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/analytics/summary → today's usage totals + current budget alerts (polled by the Home panel). */
export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    const summary = await buildAnalyticsSummary(userId)
    return NextResponse.json<AnalyticsSummaryResponse>({ ok: true, summary })
  } catch (error) {
    console.error("[analytics] Failed to build analytics summary:", error)
    return NextResponse.json<AnalyticsSummaryResponse>(
      { ok: false, error: "Could not load today's usage. Please try again in a moment." },
      { status: 500 },
    )
  }
}
