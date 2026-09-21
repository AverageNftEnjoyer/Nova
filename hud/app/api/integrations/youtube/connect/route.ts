import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { buildYouTubeOAuthUrl } from "@/lib/integrations/youtube"
import { youtubeError } from "@/lib/integrations/youtube/errors/index"

import { connectQuerySchema, logYouTubeApi, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const url = new URL(req.url)
    const parsed = connectQuerySchema.safeParse({
      returnTo: url.searchParams.get("returnTo") ?? "/integrations",
      mode: url.searchParams.get("mode") ?? undefined,
    })
    if (!parsed.success) {
      throw youtubeError("youtube.invalid_request", parsed.error.issues[0]?.message || "Invalid request.", { status: 400 })
    }
    const { returnTo, mode } = parsed.data
    logYouTubeApi("connect.begin", {
      userContextId: userId,
      returnTo,
      mode: mode || "redirect",
    })
    const authUrl = await buildYouTubeOAuthUrl(returnTo)
    if (mode === "json") {
      return NextResponse.json({ ok: true, authUrl })
    }
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to start YouTube OAuth.")
  }
}
