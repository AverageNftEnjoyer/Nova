import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import {
  ensureExecutionTickStarted,
  getExecutionTickState,
  stopExecutionTick,
} from "@/lib/missions/workflow/execution-tick"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureExecutionTickStarted()
  }
  return NextResponse.json(getExecutionTickState())
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  ensureExecutionTickStarted()
  return NextResponse.json(getExecutionTickState())
}

export async function DELETE(req: Request) {
  const { userId } = await requireLocalUser()

  stopExecutionTick()
  return NextResponse.json(getExecutionTickState())
}
