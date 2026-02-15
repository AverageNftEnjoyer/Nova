import { NextResponse } from "next/server"

import { disconnectGmail } from "@/lib/integrations/gmail"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const body = (await req.json().catch(() => ({}))) as { accountId?: string }
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : ""
    await disconnectGmail(accountId || undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to disconnect Gmail." },
      { status: 500 },
    )
  }
}
