import { NextResponse } from "next/server"
import { z } from "zod"

import { getYouTubeFeed } from "@/lib/integrations/youtube"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { logYouTubeApi, safeJson, youtubeApiErrorResponse } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const controlBodySchema = z.object({
  action: z.enum(["set_topic", "refresh"]).default("set_topic"),
  topic: z.string().trim().optional(),
  userContextId: z.string().trim().optional(),
})

function normalizeUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function normalizeTopic(value: unknown): string {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
  return normalized || "news"
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeFeedRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const config = await loadIntegrationsConfig(verified)
    return NextResponse.json({
      ok: true,
      topic: normalizeTopic(config.youtube.homeTopic || "news"),
      commandNonce: Math.max(0, Math.floor(Number(config.youtube.homeCommandNonce || 0))),
      connected: Boolean(config.youtube.connected),
      tokenConfigured:
        config.youtube.refreshTokenEnc.trim().length > 0 ||
        config.youtube.accessTokenEnc.trim().length > 0,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to read YouTube home control state.")
  }
}

export async function POST(req: Request) {
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) return runtimeSharedTokenErrorResponse(runtimeTokenDecision)

  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeSearch)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const body = await safeJson(req)
    const parsed = controlBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Invalid YouTube home control request.")
    }

    const requestedUserContextId = normalizeUserContextId(parsed.data.userContextId)
    const verifiedUserContextId = normalizeUserContextId(verified.user.id)
    if (requestedUserContextId && requestedUserContextId !== verifiedUserContextId) {
      logYouTubeApi("home_control.user_scope_hint_mismatch", {
        requestedUserContextId,
        verifiedUserContextId,
      })
      return NextResponse.json(
        {
          ok: false,
          code: "youtube.user_scope_mismatch",
          error: "User scope mismatch for YouTube home control.",
        },
        { status: 403 },
      )
    }

    const config = await loadIntegrationsConfig(verified)
    const tokenConfigured = config.youtube.refreshTokenEnc.trim().length > 0 || config.youtube.accessTokenEnc.trim().length > 0
    if (!config.youtube.connected || !tokenConfigured) {
      return NextResponse.json({ ok: false, code: "youtube.not_connected", error: "YouTube integration is not connected." }, { status: 400 })
    }
    if (!config.youtube.permissions.allowFeed) {
      return NextResponse.json({ ok: false, code: "youtube.forbidden", error: "YouTube feed is disabled in permissions." }, { status: 403 })
    }

    const nextTopic = parsed.data.action === "refresh"
      ? normalizeTopic(config.youtube.homeTopic || "news")
      : normalizeTopic(parsed.data.topic || config.youtube.homeTopic || "news")
    const nextNonce = Math.max(0, Math.floor(Number(config.youtube.homeCommandNonce || 0))) + 1

    await updateIntegrationsConfig(
      {
        youtube: {
          homeTopic: nextTopic,
          homeCommandNonce: nextNonce,
        },
      },
      verified,
    )

    const preferredSources = Array.isArray(config.news.preferredSources)
      ? config.news.preferredSources.map((source) => String(source).trim()).filter(Boolean)
      : []
    const feed = await getYouTubeFeed(
      {
        mode: "personalized",
        topic: nextTopic,
        maxResults: 6,
        preferredSources,
        historyChannelIds: [],
      },
      verified,
    )

    const lead = feed.items[0] || null
    const topicForReply = nextTopic.replace(/-/g, " ")
    const message = lead?.title
      ? `Switched YouTube to ${topicForReply}. Now showing ${lead.title}.`
      : `Switched YouTube to ${topicForReply}.`

    logYouTubeApi("home_control.success", {
      userContextId: verified.user.id,
      topic: nextTopic,
      action: parsed.data.action,
      itemCount: feed.items.length,
      commandNonce: nextNonce,
    })

    return NextResponse.json({
      ok: true,
      topic: nextTopic,
      commandNonce: nextNonce,
      message,
      selected: lead
        ? {
            videoId: lead.videoId,
            title: lead.title,
            channelTitle: lead.channelTitle,
          }
        : null,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to update YouTube home module.")
  }
}
