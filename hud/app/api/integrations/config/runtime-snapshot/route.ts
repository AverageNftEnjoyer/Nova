import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { ensureRuntimeIntegrationsSnapshot } from "@/lib/integrations/runtime/snapshot"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  try {
    const ensured = await ensureRuntimeIntegrationsSnapshot(userId, { userId })
    return NextResponse.json({ ok: true, userId: ensured.userId, cached: ensured.cached })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to ensure runtime integrations snapshot." },
      { status: 500 },
    )
  }
}
