import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted, stopNotificationScheduler } from "@/lib/notifications/scheduler"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  const state = ensureNotificationSchedulerStarted()
  return NextResponse.json(state)
}

export async function DELETE(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  const state = stopNotificationScheduler()
  return NextResponse.json(state)
}
