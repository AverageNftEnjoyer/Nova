import { NextResponse } from "next/server"

import {
  ensureMissionSchedulerStarted,
  getMissionSchedulerState,
  stopMissionScheduler,
} from "@/lib/notifications/scheduler"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureMissionSchedulerStarted()
  }
  return NextResponse.json(getMissionSchedulerState())
}

export async function POST(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  ensureMissionSchedulerStarted()
  return NextResponse.json(getMissionSchedulerState())
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  stopMissionScheduler()
  return NextResponse.json(getMissionSchedulerState())
}

