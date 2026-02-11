import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted, stopNotificationScheduler } from "@/lib/notifications/scheduler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  const state = ensureNotificationSchedulerStarted()
  return NextResponse.json(state)
}

export async function DELETE() {
  const state = stopNotificationScheduler()
  return NextResponse.json(state)
}
