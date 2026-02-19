import { NextResponse } from "next/server"

import {
  ensureNotificationSchedulerStarted,
  getNotificationSchedulerState,
  stopNotificationScheduler,
} from "@/lib/notifications/scheduler"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureNotificationSchedulerStarted()
  }
  return NextResponse.json(getNotificationSchedulerState())
}

export async function POST(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  ensureNotificationSchedulerStarted()
  return NextResponse.json(getNotificationSchedulerState())
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  stopNotificationScheduler()
  return NextResponse.json(getNotificationSchedulerState())
}

