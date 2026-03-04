import { NextResponse } from "next/server"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { probeYouTubeConnection } from "@/lib/integrations/youtube"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { logYouTubeApi, youtubeApiErrorResponse } from "../youtube/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const probe = await probeYouTubeConnection(verified)
    const config = await loadIntegrationsConfig(verified)
    logYouTubeApi("probe.success", {
      userContextId: verified.user.id,
      connected: probe.connected,
      channelId: probe.channelId,
    })
    return NextResponse.json({
      ok: true,
      connected: probe.connected,
      channelId: probe.channelId,
      channelTitle: probe.channelTitle,
      scopes: probe.scopes,
      config: {
        youtube: {
          connected: config.youtube.connected,
          channelId: config.youtube.channelId,
          channelTitle: config.youtube.channelTitle,
          scopes: config.youtube.scopes,
          permissions: config.youtube.permissions,
          redirectUri: config.youtube.redirectUri,
          tokenConfigured:
            config.youtube.refreshTokenEnc.trim().length > 0 ||
            config.youtube.accessTokenEnc.trim().length > 0,
        },
      },
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "YouTube probe failed.")
  }
}
