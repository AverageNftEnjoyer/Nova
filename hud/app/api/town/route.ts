import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { resolveTimeZone } from "@/lib/analytics/time-zone"
import { ANALYTICS_TIME_ZONE_PARAM } from "@/lib/analytics/types"
import { loadTownProgress } from "@/lib/town/server"
import type { TownProgress } from "@/lib/town/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/town?tz=Area/City → U.B Agents City progression (level, XP sources, quests, buildings, pending events). */
export async function GET(req: Request) {
  try {
    const { userId } = await requireLocalUser()
    const timeZone = resolveTimeZone(new URL(req.url).searchParams.get(ANALYTICS_TIME_ZONE_PARAM))
    const progress = await loadTownProgress(userId, timeZone)
    return NextResponse.json<TownProgress>(progress, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("[town] Failed to build town progress:", error)
    return NextResponse.json({ error: "Could not load your city's progress. Please try again in a moment." }, { status: 500 })
  }
}
