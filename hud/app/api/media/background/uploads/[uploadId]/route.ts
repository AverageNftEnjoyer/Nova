import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import {
  abortBackgroundUpload,
  appendBackgroundUploadChunk,
  backgroundAssetErrorResponse,
  finishBackgroundUpload,
} from "@/lib/media/background-assets-server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ uploadId: string }>
}

/**
 * Append one chunk. Raw bytes in the body, `?offset=<bytes already stored>`. Not user-rate-limited: a large video is
 * many chunks, and the per-IP limiter in proxy.ts still applies.
 */
export async function PUT(req: Request, { params }: RouteContext) {
  const { userId } = await requireLocalUser()
  const { uploadId } = await params
  try {
    const offset = Number(new URL(req.url).searchParams.get("offset"))
    if (!req.body) return NextResponse.json({ ok: false, error: "Missing chunk body." }, { status: 400 })
    const { sizeBytes } = await appendBackgroundUploadChunk(
      userId,
      uploadId,
      offset,
      req.body as unknown as AsyncIterable<Uint8Array>,
    )
    return NextResponse.json({ ok: true, sizeBytes })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to store the upload chunk.")
  }
}

/** Finish the upload: validates size and content, then makes it the active background unless `?activate=0`. */
export async function POST(req: Request, { params }: RouteContext) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  const { uploadId } = await params
  try {
    const activate = new URL(req.url).searchParams.get("activate") !== "0"
    const asset = await finishBackgroundUpload(userId, uploadId, { activate })
    return NextResponse.json({ ok: true, asset })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to finish the upload.")
  }
}

/** Abort an unfinished upload and delete its temp file. */
export async function DELETE(_req: Request, { params }: RouteContext) {
  const { userId } = await requireLocalUser()
  const { uploadId } = await params
  try {
    await abortBackgroundUpload(userId, uploadId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to abort the upload.")
  }
}
