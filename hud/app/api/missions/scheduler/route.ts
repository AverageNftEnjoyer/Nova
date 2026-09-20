import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import {
  ensureMissionSchedulerStarted as ensureHudMissionSchedulerStarted,
  getMissionSchedulerState,
  stopMissionScheduler,
} from "@/lib/notifications/scheduler"
import { getExecutionTickState } from "@/lib/missions/workflow/execution-tick"

import { ensureMissionSchedulerStarted } from "../../../../../src/runtime/modules/services/missions/scheduler/index.js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function combinedState() {
  return { ...getMissionSchedulerState(), executionTick: getExecutionTickState() }
}

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureMissionSchedulerStarted({ startScheduler: ensureHudMissionSchedulerStarted })
  }
  return NextResponse.json(combinedState())
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  ensureMissionSchedulerStarted({ startScheduler: ensureHudMissionSchedulerStarted })
  return NextResponse.json(combinedState())
}

export async function DELETE(req: Request) {
  const { userId } = await requireLocalUser()

  stopMissionScheduler()
  return NextResponse.json(combinedState())
}
