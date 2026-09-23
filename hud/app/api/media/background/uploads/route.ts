import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import { backgroundAssetErrorResponse, beginBackgroundUpload } from "@/lib/media/background-assets-server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Start a chunked upload: body `{ fileName, sizeBytes, legacyId? }`.
 * Responds `{ uploadId, chunkBytes }`, or `{ existing }` when `legacyId` was already imported.
 */
export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  try {
    const body = (await req.json().catch(() => null)) as { fileName?: unknown; sizeBytes?: unknown; legacyId?: unknown } | null
    if (!body) return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 })
    const result = await beginBackgroundUpload(userId, body)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to start the upload.")
  }
}
