import { NextResponse } from "next/server"

import {
  ensureMissionSchedulerStarted as ensureHudMissionSchedulerStarted,
  getMissionSchedulerState,
  stopMissionScheduler,
} from "@/lib/notifications/scheduler"
import { getExecutionTickState } from "@/lib/missions/workflow/execution-tick"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { ensureMissionSchedulerStarted } from "../../../../../src/runtime/modules/services/missions/scheduler/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function combinedState() {
  return { ...getMissionSchedulerState(), executionTick: getExecutionTickState() }
}

export async function GET(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureMissionSchedulerStarted({ startScheduler: ensureHudMissionSchedulerStarted })
  }
  return NextResponse.json(combinedState())
}

export async function POST(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  ensureMissionSchedulerStarted({ startScheduler: ensureHudMissionSchedulerStarted })
  return NextResponse.json(combinedState())
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  stopMissionScheduler()
  return NextResponse.json(combinedState())
}
