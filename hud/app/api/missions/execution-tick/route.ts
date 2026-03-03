import { NextResponse } from "next/server"

import {
  ensureExecutionTickStarted,
  getExecutionTickState,
  stopExecutionTick,
} from "@/lib/missions/workflow/execution-tick"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  if (url.searchParams.get("ensure") === "1") {
    ensureExecutionTickStarted()
  }
  return NextResponse.json(getExecutionTickState())
}

export async function POST(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  ensureExecutionTickStarted()
  return NextResponse.json(getExecutionTickState())
}

export async function DELETE(req: Request) {
  const { unauthorized } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized

  stopExecutionTick()
  return NextResponse.json(getExecutionTickState())
}
