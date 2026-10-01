import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { applyTownAck, parseTownAckRequest } from "@/lib/town/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST /api/town/ack { eventIds?, tutorial? } → marks events as shown and applies the tutorial choice. */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 })
  }
  const request = parseTownAckRequest(body)
  if (!request) {
    return NextResponse.json(
      { ok: false, error: 'Send "eventIds" (event id strings) and/or "tutorial" ("skip", "restart" or "finish").' },
      { status: 400 },
    )
  }
  try {
    const { userId } = await requireLocalUser()
    const { acknowledged } = applyTownAck(userId, request)
    return NextResponse.json({ ok: true, acknowledged })
  } catch (error) {
    console.error("[town] Failed to acknowledge town events:", error)
    return NextResponse.json({ ok: false, error: "Could not save your city's progress. Please try again." }, { status: 500 })
  }
}
