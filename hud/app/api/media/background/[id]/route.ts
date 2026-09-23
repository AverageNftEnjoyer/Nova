import { Readable } from "node:stream"

import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import {
  backgroundAssetErrorResponse,
  deleteBackgroundAsset,
  openBackgroundAssetStream,
  parseAssetId,
  parseRangeHeader,
  statBackgroundAsset,
} from "@/lib/media/background-assets-server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ id: string }>
}

function notFound(): NextResponse {
  return NextResponse.json({ ok: false, error: "Background not found." }, { status: 404 })
}

/**
 * Stream the file with HTTP Range support so <video> can seek. The type comes from the stored extension (never from
 * the client); `nosniff` + `sandbox` keep the response inert even if someone navigates to it directly.
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { userId } = await requireLocalUser()
  const { id } = await params
  if (!parseAssetId(id)) return notFound()
  try {
    const asset = await statBackgroundAsset(userId, id)
    if (!asset) return notFound()

    const baseHeaders: Record<string, string> = {
      "Content-Type": asset.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Content-Disposition": "inline",
    }
    const range = parseRangeHeader(req.headers.get("range"), asset.size)
    if (range.kind === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${asset.size}` } })
    }
    const start = range.kind === "range" ? range.start : 0
    const end = range.kind === "range" ? range.end : asset.size - 1
    const stream = Readable.toWeb(openBackgroundAssetStream(asset.filePath, start, end)) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, {
      status: range.kind === "range" ? 206 : 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(end - start + 1),
        ...(range.kind === "range" ? { "Content-Range": `bytes ${start}-${end}/${asset.size}` } : {}),
      },
    })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to read the background.")
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.agentTasksWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)
  const { id } = await params
  if (!parseAssetId(id)) return notFound()
  try {
    const removed = await deleteBackgroundAsset(userId, id)
    if (!removed) return notFound()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return backgroundAssetErrorResponse(error, "Failed to delete the background.")
  }
}
