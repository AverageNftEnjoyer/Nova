import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import { loadWardrobe, parseWardrobeUpdate, updateWardrobe } from "@/lib/town/wardrobe"
import type { TownWardrobe } from "@/lib/town/wardrobe-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

/** GET /api/town/wardrobe → every cosmetic with its unlock state, plus the resident looks (names + equipped items). */
export async function GET() {
  try {
    const { userId } = await requireLocalUser()
    return NextResponse.json<TownWardrobe>(loadWardrobe(userId), { headers: NO_STORE })
  } catch (error) {
    console.error("[town] Failed to load the wardrobe:", error)
    return NextResponse.json({ error: "Could not load the wardrobe. Please try again in a moment." }, { status: 500 })
  }
}

/**
 * POST /api/town/wardrobe  { residentId, name?, equipped? } → the full updated wardrobe.
 * 400 bad JSON/shape, 403 locked item, 404 unknown item, 409 too many customised residents, 422 item/slot mismatch.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: NO_STORE })
  }
  const parsed = parseWardrobeUpdate(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE })
  try {
    const { userId } = await requireLocalUser()
    const outcome = updateWardrobe(userId, parsed.update)
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE })
    return NextResponse.json<TownWardrobe>(outcome.wardrobe, { headers: NO_STORE })
  } catch (error) {
    console.error("[town] Failed to update the wardrobe:", error)
    return NextResponse.json({ error: "Could not save the wardrobe. Please try again in a moment." }, { status: 500 })
  }
}
