import { NextResponse } from "next/server"

import { getYouTubeFeed } from "@/lib/integrations/youtube"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { feedQuerySchema, logYouTubeApi, parseCsv, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeFeedRead, 2)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const config = await loadIntegrationsConfig(verified)
    const tokenConfigured = config.youtube.refreshTokenEnc.trim().length > 0 || config.youtube.accessTokenEnc.trim().length > 0
    if (!config.youtube.connected || !tokenConfigured) {
      return NextResponse.json({ ok: false, error: "YouTube integration is not connected." }, { status: 400 })
    }
    if (!config.youtube.permissions.allowFeed) {
      return NextResponse.json({ ok: false, error: "YouTube feed is disabled in permissions." }, { status: 403 })
    }

    const requestUrl = new URL(req.url)
    const configuredTopic = String(config.youtube.homeTopic || "news").trim() || "news"
    const parsed = feedQuerySchema.safeParse({
      mode: requestUrl.searchParams.get("mode") || "personalized",
      topic: requestUrl.searchParams.get("topic") || configuredTopic,
      pageToken: requestUrl.searchParams.get("pageToken") || undefined,
      maxResults: requestUrl.searchParams.get("maxResults") || undefined,
      historyChannelIds: requestUrl.searchParams.get("historyChannelIds") || undefined,
    })
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid YouTube feed request.")
    }
    const preferredSources = Array.isArray(config.news.preferredSources)
      ? config.news.preferredSources.map((source) => String(source).trim()).filter(Boolean)
      : []
    const result = await getYouTubeFeed(
      {
        mode: parsed.data.mode,
        topic: parsed.data.topic,
        pageToken: parsed.data.pageToken,
        maxResults: parsed.data.maxResults,
        preferredSources,
        historyChannelIds: parseCsv(parsed.data.historyChannelIds || ""),
      },
      verified,
    )

    logYouTubeApi("feed.success", {
      userContextId: verified.user.id,
      mode: result.mode,
      topic: result.topic,
      itemCount: result.items.length,
      preferredSourceCount: preferredSources.length,
    })

    return NextResponse.json({
      ok: true,
      ...result,
      preferredSources,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to load YouTube feed.")
  }
}
