import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { loadResidentNames, parseResidentRename, renameResident } from "@/lib/town/residents"
import type { ResidentNames } from "@/lib/town/residents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

/** GET /api/town/residents -> { names } (resident id -> chosen display name; residents without one use their default). */
export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    return NextResponse.json<{ names: ResidentNames }>({ names: loadResidentNames(userId) }, { headers: NO_STORE })
  } catch (error) {
    console.error("[town] Failed to load resident names:", error)
    return NextResponse.json({ error: "Could not load resident names. Please try again in a moment." }, { status: 500 })
  }
}

/**
 * POST /api/town/residents  { residentId, name } -> { names }. `name` null/empty clears the custom name.
 * 400 bad JSON/shape/residentId/name over 24 characters, 409 too many renamed residents.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: NO_STORE })
  }
  const parsed = parseResidentRename(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE })
  try {
    const { userId } = await requireLocalUser()
    const outcome = renameResident(userId, parsed.request)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE })
    return NextResponse.json<{ names: ResidentNames }>({ names: outcome.names }, { headers: NO_STORE })
  } catch (error) {
    console.error("[town] Failed to rename a resident:", error)
    return NextResponse.json({ error: "Could not save the name. Please try again in a moment." }, { status: 500 })
  }
}
