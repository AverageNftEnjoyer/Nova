import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createCalendarEvent,
  listCalendarEvents,
} from "@/lib/integrations/google-calendar/service"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { gmailCalendarApiErrorResponse, safeJson } from "../../integrations/gmail-calendar/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOVA_MIRROR_ID_RE = /^(?:novamission|novaschedule|nova)[a-v0-9]{12,}(?:_[0-9]{8}t[0-9]{6}z)?$/i

const createBodySchema = z.object({
  userContextId: z.string().trim().optional(),
  title: z.string().trim().min(1, "title is required."),
  description: z.string().trim().optional(),
  startAt: z.string().trim().min(1, "startAt is required."),
  endAt: z.string().trim().min(1, "endAt is required."),
  timeZone: z.string().trim().optional(),
})

function normalizeUserContextId(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function isNovaMirroredScheduleEventId(eventId: string): boolean {
  const normalized = normalizeUserContextId(eventId)
  return Boolean(normalized) && NOVA_MIRROR_ID_RE.test(normalized)
}

function resolveAccountId(config: Awaited<ReturnType<typeof loadIntegrationsConfig>>): string {
  const activeId = String(config?.gcalendar?.activeAccountId || "").trim().toLowerCase()
  const enabledAccounts = Array.isArray(config?.gcalendar?.accounts)
    ? config.gcalendar.accounts.filter((account) => account.enabled)
    : []
  if (activeId) {
    const active = enabledAccounts.find((account) => account.id === activeId)
    if (active?.id) return active.id
  }
  return String(enabledAccounts[0]?.id || "").trim().toLowerCase()
}

async function resolveCalendarScope(req: Request, requestedUserContextId: string) {
  const runtimeTokenDecision = verifyRuntimeSharedToken(req)
  if (!runtimeTokenDecision.ok) {
    return {
      error: runtimeSharedTokenErrorResponse(runtimeTokenDecision),
      userId: "",
      scope: null,
    }
  }

  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (verified?.user?.id) {
    return {
      error: null,
      userId: normalizeUserContextId(verified.user.id),
      scope: verified,
    }
  }

  if (runtimeTokenDecision.authenticated !== true) {
    return {
      error: unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 }),
      userId: "",
      scope: null,
    }
  }

  if (!requestedUserContextId) {
    return {
      error: NextResponse.json(
        { ok: false, code: "calendar.user_context_required", error: "Calendar runtime requests require userContextId." },
        { status: 400 },
      ),
      userId: "",
      scope: null,
    }
  }

  return {
    error: null,
    userId: requestedUserContextId,
    scope: {
      userId: requestedUserContextId,
      allowServiceRole: true,
      serviceRoleReason: "runtime-bridge" as const,
    } satisfies IntegrationsStoreScope,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const requestedUserContextId = normalizeUserContextId(url.searchParams.get("userContextId"))
  const scopeDecision = await resolveCalendarScope(req, requestedUserContextId)
  if (scopeDecision.error || !scopeDecision.userId || !scopeDecision.scope) {
    return scopeDecision.error ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(scopeDecision.userId, RATE_LIMIT_POLICIES.calendarEventsRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const startParam = String(url.searchParams.get("start") || "").trim()
  const endParam = String(url.searchParams.get("end") || "").trim()
  const rangeStart = startParam ? new Date(startParam) : new Date()
  const rangeEnd = endParam ? new Date(endParam) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd <= rangeStart) {
    return NextResponse.json({ ok: false, error: "Invalid start or end date." }, { status: 400 })
  }
  if (rangeEnd.getTime() - rangeStart.getTime() > 370 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: "Range cannot exceed 370 days." }, { status: 400 })
  }

  try {
    const config = await loadIntegrationsConfig(scopeDecision.scope)
    if (!config?.gcalendar?.connected) {
      return NextResponse.json({ ok: false, code: "calendar.not_connected", error: "Google Calendar is not connected." }, { status: 409 })
    }
    const accountId = resolveAccountId(config)
    const events = await listCalendarEvents(rangeStart, rangeEnd, accountId || undefined, scopeDecision.scope)
    return NextResponse.json({
      ok: true,
      events: events.filter((event) => event.status !== "cancelled" && !isNovaMirroredScheduleEventId(event.id)),
    })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to load Google Calendar events.")
  }
}

export async function POST(req: Request) {
  const payload = createBodySchema.safeParse(await safeJson(req))
  if (!payload.success) {
    return NextResponse.json({ ok: false, error: payload.error.issues[0]?.message || "Invalid calendar event request." }, { status: 400 })
  }

  const scopeDecision = await resolveCalendarScope(req, normalizeUserContextId(payload.data.userContextId))
  if (scopeDecision.error || !scopeDecision.userId || !scopeDecision.scope) {
    return scopeDecision.error ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(scopeDecision.userId, RATE_LIMIT_POLICIES.calendarRescheduleWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const startAt = new Date(payload.data.startAt)
  const endAt = new Date(payload.data.endAt)
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return NextResponse.json({ ok: false, error: "startAt and endAt must be valid ISO dates with endAt after startAt." }, { status: 400 })
  }

  try {
    const config = await loadIntegrationsConfig(scopeDecision.scope)
    if (!config?.gcalendar?.connected) {
      return NextResponse.json({ ok: false, code: "calendar.not_connected", error: "Google Calendar is not connected." }, { status: 409 })
    }
    if (!config.gcalendar.permissions?.allowCreate) {
      return NextResponse.json({ ok: false, code: "calendar.create_disallowed", error: "Google Calendar create permission is disabled." }, { status: 403 })
    }

    const accountId = resolveAccountId(config)
    const event = await createCalendarEvent(
      {
        summary: payload.data.title,
        description: payload.data.description,
        startAt,
        endAt,
        timeZone: payload.data.timeZone,
      },
      {
        accountId: accountId || undefined,
        calendarId: "primary",
        scope: scopeDecision.scope,
      },
    )
    if (isNovaMirroredScheduleEventId(event.id)) {
      return NextResponse.json({ ok: false, code: "calendar.invalid_event_id", error: "Mirrored mission events cannot be created through this route." }, { status: 400 })
    }
    return NextResponse.json({ ok: true, event })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to create Google Calendar event.")
  }
}
