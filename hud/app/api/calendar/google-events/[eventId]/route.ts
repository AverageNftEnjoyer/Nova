import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteCalendarEvent,
  getCalendarEvent,
  updateCalendarEvent,
} from "@/lib/integrations/google-calendar/service"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { runtimeSharedTokenErrorResponse, verifyRuntimeSharedToken } from "@/lib/security/runtime-auth"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { gmailCalendarApiErrorResponse, safeJson } from "../../../integrations/gmail-calendar/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOVA_MIRROR_ID_RE = /^(?:novamission|novaschedule|nova)[a-v0-9]{12,}(?:_[0-9]{8}t[0-9]{6}z)?$/i

const updateBodySchema = z.object({
  userContextId: z.string().trim().optional(),
  title: z.string().trim().optional(),
  description: z.string().trim().optional(),
  startAt: z.string().trim().optional(),
  endAt: z.string().trim().optional(),
  timeZone: z.string().trim().optional(),
})

const deleteBodySchema = z.object({
  userContextId: z.string().trim().optional(),
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const eventId = String((await params).eventId || "").trim()
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "eventId is required." }, { status: 400 })
  }
  if (isNovaMirroredScheduleEventId(eventId)) {
    return NextResponse.json({ ok: false, code: "calendar.mirrored_event_immutable", error: "Mirrored mission events cannot be edited through this route." }, { status: 400 })
  }

  const payload = updateBodySchema.safeParse(await safeJson(req))
  if (!payload.success) {
    return NextResponse.json({ ok: false, error: payload.error.issues[0]?.message || "Invalid calendar event request." }, { status: 400 })
  }

  const scopeDecision = await resolveCalendarScope(req, normalizeUserContextId(payload.data.userContextId))
  if (scopeDecision.error || !scopeDecision.userId || !scopeDecision.scope) {
    return scopeDecision.error ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(scopeDecision.userId, RATE_LIMIT_POLICIES.calendarRescheduleWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const hasPatchField = ["title", "description", "startAt", "endAt", "timeZone"]
    .some((key) => typeof payload.data[key as keyof typeof payload.data] === "string" && String(payload.data[key as keyof typeof payload.data] || "").trim().length > 0)
  if (!hasPatchField) {
    return NextResponse.json({ ok: false, error: "Provide at least one event field to update." }, { status: 400 })
  }

  const startAt = payload.data.startAt ? new Date(payload.data.startAt) : null
  const endAt = payload.data.endAt ? new Date(payload.data.endAt) : null
  if ((startAt && Number.isNaN(startAt.getTime())) || (endAt && Number.isNaN(endAt.getTime()))) {
    return NextResponse.json({ ok: false, error: "startAt and endAt must be valid ISO dates." }, { status: 400 })
  }
  if (startAt && endAt && endAt <= startAt) {
    return NextResponse.json({ ok: false, error: "endAt must be after startAt." }, { status: 400 })
  }

  try {
    const config = await loadIntegrationsConfig(scopeDecision.scope)
    if (!config?.gcalendar?.connected) {
      return NextResponse.json({ ok: false, code: "calendar.not_connected", error: "Google Calendar is not connected." }, { status: 409 })
    }
    if (!config.gcalendar.permissions?.allowEdit) {
      return NextResponse.json({ ok: false, code: "calendar.edit_disallowed", error: "Google Calendar edit permission is disabled." }, { status: 403 })
    }

    const accountId = resolveAccountId(config)
    const existing = await getCalendarEvent(eventId, {
      accountId: accountId || undefined,
      calendarId: "primary",
      scope: scopeDecision.scope,
    })
    if (!existing) {
      return NextResponse.json({ ok: false, code: "calendar.event_not_found", error: "Google Calendar event not found." }, { status: 404 })
    }

    const event = await updateCalendarEvent(
      eventId,
      {
        summary: payload.data.title ?? existing.summary,
        description: payload.data.description ?? existing.description,
        startAt: startAt ?? (existing.start?.dateTime ? new Date(existing.start.dateTime) : undefined),
        endAt: endAt ?? (existing.end?.dateTime ? new Date(existing.end.dateTime) : undefined),
        timeZone: payload.data.timeZone || existing.start?.timeZone || existing.end?.timeZone,
      },
      {
        accountId: accountId || undefined,
        calendarId: "primary",
        scope: scopeDecision.scope,
      },
    )
    return NextResponse.json({ ok: true, event })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to update Google Calendar event.")
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const eventId = String((await params).eventId || "").trim()
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "eventId is required." }, { status: 400 })
  }
  if (isNovaMirroredScheduleEventId(eventId)) {
    return NextResponse.json({ ok: false, code: "calendar.mirrored_event_immutable", error: "Mirrored mission events cannot be deleted through this route." }, { status: 400 })
  }

  const payload = deleteBodySchema.safeParse(await safeJson(req))
  if (!payload.success) {
    return NextResponse.json({ ok: false, error: payload.error.issues[0]?.message || "Invalid delete request." }, { status: 400 })
  }

  const scopeDecision = await resolveCalendarScope(req, normalizeUserContextId(payload.data.userContextId))
  if (scopeDecision.error || !scopeDecision.userId || !scopeDecision.scope) {
    return scopeDecision.error ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(scopeDecision.userId, RATE_LIMIT_POLICIES.calendarRescheduleWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const config = await loadIntegrationsConfig(scopeDecision.scope)
    if (!config?.gcalendar?.connected) {
      return NextResponse.json({ ok: false, code: "calendar.not_connected", error: "Google Calendar is not connected." }, { status: 409 })
    }
    if (!config.gcalendar.permissions?.allowDelete) {
      return NextResponse.json({ ok: false, code: "calendar.delete_disallowed", error: "Google Calendar delete permission is disabled." }, { status: 403 })
    }

    const accountId = resolveAccountId(config)
    const existing = await getCalendarEvent(eventId, {
      accountId: accountId || undefined,
      calendarId: "primary",
      scope: scopeDecision.scope,
    })
    if (!existing) {
      return NextResponse.json({ ok: false, code: "calendar.event_not_found", error: "Google Calendar event not found." }, { status: 404 })
    }

    await deleteCalendarEvent(eventId, {
      accountId: accountId || undefined,
      calendarId: "primary",
      scope: scopeDecision.scope,
    })
    return NextResponse.json({ ok: true, deleted: true, eventId })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to delete Google Calendar event.")
  }
}
