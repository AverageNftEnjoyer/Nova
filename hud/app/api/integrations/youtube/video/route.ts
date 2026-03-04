import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { getYouTubeVideoDetails } from "@/lib/integrations/youtube"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logYouTubeApi, videoQuerySchema, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeVideoRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const config = await loadIntegrationsConfig(verified)
    if (!config.youtube.permissions.allowVideoDetails) {
      return NextResponse.json({ ok: false, error: "YouTube video details are disabled in permissions." }, { status: 403 })
    }

    const requestUrl = new URL(req.url)
    const parsed = videoQuerySchema.safeParse({
      id: requestUrl.searchParams.get("id") || "",
    })
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid YouTube video request.")
    }
    const details = await getYouTubeVideoDetails(parsed.data.id, verified)
    logYouTubeApi("video.success", {
      userContextId: verified.user.id,
      videoId: details.id,
      channelId: details.channelId,
    })
    return NextResponse.json({
      ok: true,
      video: details,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to read YouTube video details.")
  }
}
