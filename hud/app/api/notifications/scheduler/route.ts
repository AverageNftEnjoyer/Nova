import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted, stopNotificationScheduler } from "@/lib/notifications/scheduler"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const state = ensureNotificationSchedulerStarted()
  return NextResponse.json(state)
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const state = stopNotificationScheduler()
  return NextResponse.json(state)
}

