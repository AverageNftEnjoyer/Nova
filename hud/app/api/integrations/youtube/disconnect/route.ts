import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { disconnectYouTube } from "@/lib/integrations/youtube"

import { disconnectBodySchema, logYouTubeApi, safeJson, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const body = await safeJson(req)
    const parsed = disconnectBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid request body.")
    }
    await disconnectYouTube({ userId })
    logYouTubeApi("disconnect.success", { userContextId: userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to disconnect YouTube.")
  }
}
