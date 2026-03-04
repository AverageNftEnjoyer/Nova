import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { searchYouTube } from "@/lib/integrations/youtube"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logYouTubeApi, searchQuerySchema, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeSearch)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const config = await loadIntegrationsConfig(verified)
    if (!config.youtube.permissions.allowSearch) {
      return NextResponse.json({ ok: false, error: "YouTube search is disabled in permissions." }, { status: 403 })
    }

    const requestUrl = new URL(req.url)
    const parsed = searchQuerySchema.safeParse({
      q: requestUrl.searchParams.get("q") || "",
      type: requestUrl.searchParams.get("type") || undefined,
      pageToken: requestUrl.searchParams.get("pageToken") || undefined,
      maxResults: requestUrl.searchParams.get("maxResults") || undefined,
    })
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid YouTube search request.")
    }
    const result = await searchYouTube(
      {
        query: parsed.data.q,
        type: parsed.data.type,
        pageToken: parsed.data.pageToken,
        maxResults: parsed.data.maxResults,
      },
      verified,
    )
    logYouTubeApi("search.success", {
      userContextId: verified.user.id,
      query: parsed.data.q,
      type: parsed.data.type || "video",
      itemCount: result.items.length,
    })
    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to search YouTube.")
  }
}
