import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import {
  backgroundAssetErrorResponse,
  listBackgroundAssets,
  setActiveBackgroundAsset,
} from "@/lib/media/background-assets-server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** List the user's background assets and the active id. */
export async function GET() {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  try {
    const { assets, activeId } = await listBackgroundAssets(userId)
    return NextResponse.json({ ok: true, assets, activeId })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to load backgrounds.")
  }
}

/** Set or clear the active asset: body `{ activeId: string | null }`. */
export async function PATCH(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  try {
    const body = (await req.json().catch(() => null)) as { activeId?: unknown } | null
    if (!body || !("activeId" in body) || (body.activeId !== null && typeof body.activeId !== "string")) {
      return NextResponse.json({ ok: false, error: "activeId must be a string or null." }, { status: 400 })
    }
    const activeId = setActiveBackgroundAsset(userId, body.activeId)
    return NextResponse.json({ ok: true, activeId })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to update the active background.")
  }
}
