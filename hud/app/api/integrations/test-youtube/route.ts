import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { probeYouTubeConnection } from "@/lib/integrations/youtube"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"

import { logYouTubeApi, youtubeApiErrorResponse } from "../youtube/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const probe = await probeYouTubeConnection({ userId })
    const config = await loadIntegrationsConfig({ userId })
    logYouTubeApi("probe.success", {
      userContextId: userId,
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
