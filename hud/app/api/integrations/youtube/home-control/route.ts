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
  preferredSources: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  strictTopic: z.boolean().optional(),
  strictSources: z.boolean().optional(),
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

function normalizeSourceLabel(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.&'/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
}

function normalizePreferredSources(value: unknown): string[] {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of values) {
    const normalized = normalizeSourceLabel(entry)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= 4) break
  }
  return out
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

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.youtubeSearch, 2)
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
    const requestedSources = normalizePreferredSources(parsed.data.preferredSources)
    const strictSources = parsed.data.strictSources === true || requestedSources.length > 0
    const strictTopic = parsed.data.strictTopic === true || strictSources

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
    const mergedPreferredSources = Array.from(new Set([...requestedSources, ...preferredSources])).slice(0, 8)
    const feed = await getYouTubeFeed(
      {
        mode: requestedSources.length > 0 ? "sources" : "personalized",
        topic: nextTopic,
        maxResults: 8,
        preferredSources: mergedPreferredSources,
        requiredSources: requestedSources,
        strictTopic,
        strictSources,
        historyChannelIds: [],
      },
      verified,
    )

    const lead = feed.items[0] || null
    const topicForReply = nextTopic.replace(/-/g, " ")
    const sourceSuffix = requestedSources.length > 0
      ? ` from ${requestedSources.join(", ")}`
      : ""
    const message = lead?.title
      ? `Switched YouTube to ${topicForReply}${sourceSuffix}. Now showing ${lead.title}.`
      : requestedSources.length > 0
        ? `I couldn't find a strong match for ${topicForReply} from ${requestedSources.join(", ")}. Try a different channel or broaden the topic.`
        : `I couldn't find a strong match for ${topicForReply}. Try a more specific topic or add a channel.`

    logYouTubeApi("home_control.success", {
      userContextId: verified.user.id,
      topic: nextTopic,
      action: parsed.data.action,
      itemCount: feed.items.length,
      commandNonce: nextNonce,
      strictTopic,
      strictSources,
      requestedSources,
    })

    return NextResponse.json({
      ok: true,
      topic: nextTopic,
      commandNonce: nextNonce,
      strictTopic,
      strictSources,
      preferredSources: requestedSources,
      message,
      items: feed.items,
      selected: lead
        ? {
            videoId: lead.videoId,
            title: lead.title,
            channelId: lead.channelId,
            channelTitle: lead.channelTitle,
            publishedAt: lead.publishedAt,
            thumbnailUrl: lead.thumbnailUrl,
            description: lead.description,
            score: lead.score,
            reason: lead.reason,
          }
        : null,
    })
  } catch (error) {
    return youtubeApiErrorResponse(error, "Failed to update YouTube home module.")
  }
}
