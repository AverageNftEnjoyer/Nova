/**
 * GmailCalendar event fetching.
 *
 * Calls the Google Calendar API using an access token obtained from
 * getValidGmailCalendarAccessToken (stored under the `gcalendar` config key).
 */
import { gmailFetchWithRetry, assertGmailOk, readGmailErrorMessage } from "../../gmail/client.ts"
import { fromGmailHttpStatus } from "../../gmail/errors.ts"
import {
  GCALENDAR_API_BASE,
  type GmailCalendarEventItem,
  type GmailCalendarListItem,
  type GmailCalendarScope,
} from "../types/index.ts"
import { getValidGmailCalendarAccessToken } from "../tokens/index.ts"

function normalizeCalendarId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : ""
  return raw || "primary"
}

function toCalendarEventItem(item: Record<string, unknown>, calendarId?: string): GmailCalendarEventItem {
  return {
    id: String(item.id || ""),
    calendarId: calendarId ? normalizeCalendarId(calendarId) : undefined,
    summary: typeof item.summary === "string" ? item.summary : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    start: item.start && typeof item.start === "object"
      ? item.start as GmailCalendarEventItem["start"]
      : undefined,
    end: item.end && typeof item.end === "object"
      ? item.end as GmailCalendarEventItem["end"]
      : undefined,
    status: ["confirmed", "tentative", "cancelled"].includes(String(item.status))
      ? (item.status as GmailCalendarEventItem["status"])
      : undefined,
    htmlLink: typeof item.htmlLink === "string" ? item.htmlLink : undefined,
    organizer: item.organizer && typeof item.organizer === "object"
      ? { email: typeof (item.organizer as Record<string, unknown>).email === "string" ? String((item.organizer as Record<string, unknown>).email) : undefined }
      : undefined,
    attendees: Array.isArray(item.attendees)
      ? (item.attendees as Array<Record<string, unknown>>).map((a) => ({
          email: typeof a.email === "string" ? a.email : undefined,
          responseStatus: typeof a.responseStatus === "string" ? a.responseStatus : undefined,
          self: typeof a.self === "boolean" ? a.self : undefined,
        }))
      : undefined,
  }
}

function toCalendarListItem(item: Record<string, unknown>): GmailCalendarListItem {
  return {
    id: String(item.id || ""),
    summary: typeof item.summary === "string" ? item.summary : undefined,
    primary: typeof item.primary === "boolean" ? item.primary : undefined,
    selected: typeof item.selected === "boolean" ? item.selected : undefined,
    accessRole: typeof item.accessRole === "string" ? item.accessRole : undefined,
  }
}

function normalizeRecurrence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const recurrence = value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => /^RRULE:/i.test(entry))
  return recurrence.length > 0 ? recurrence : undefined
}

function calendarEventStartKey(event: GmailCalendarEventItem): string {
  return String(event.start?.dateTime || event.start?.date || "")
}

function calendarEventEndKey(event: GmailCalendarEventItem): string {
  return String(event.end?.dateTime || event.end?.date || "")
}

function dedupeCalendarEvents(items: GmailCalendarEventItem[]): GmailCalendarEventItem[] {
  const seen = new Set<string>()
  const unique: GmailCalendarEventItem[] = []
  for (const event of items) {
    if (!event.id) continue
    const dedupeKey = `${event.id}::${calendarEventStartKey(event)}::${calendarEventEndKey(event)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    unique.push(event)
  }
  return unique
}

async function listGmailCalendarIdsWithToken(accessToken: string): Promise<string[]> {
  const params = new URLSearchParams({
    maxResults: "250",
    minAccessRole: "reader",
    showDeleted: "false",
    showHidden: "false",
  })
  const url = `${GCALENDAR_API_BASE}/users/me/calendarList?${params.toString()}`
  const res = await gmailFetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { operation: "gmail_calendar_list_calendars", maxAttempts: 3, timeoutMs: 12_000 },
  )
  await assertGmailOk(res, "Google Calendar list fetch failed.")
  const data = await res.json().catch(() => null) as { items?: unknown[] } | null
  if (!data || !Array.isArray(data.items)) return ["primary"]

  const calendarIds = data.items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => toCalendarListItem(item))
    .filter((item) => !!item.id)
    .map((item) => normalizeCalendarId(item.id))

  const uniqueIds = Array.from(new Set(["primary", ...calendarIds]))
  return uniqueIds.length > 0 ? uniqueIds : ["primary"]
}

async function listEventsForCalendarWithToken(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  calendarId: string,
  maxResults: number,
): Promise<GmailCalendarEventItem[]> {
  const normalizedCalendarId = normalizeCalendarId(calendarId)
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: String(Math.min(Math.max(1, maxResults), 2500)),
    singleEvents: "true",
    orderBy: "startTime",
  })

  const url = `${GCALENDAR_API_BASE}/calendars/${encodeURIComponent(normalizedCalendarId)}/events?${params.toString()}`
  const res = await gmailFetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { operation: "gmail_calendar_list_events", maxAttempts: 3, timeoutMs: 12_000 },
  )
  await assertGmailOk(res, "Google Calendar events fetch failed.")
  const data = await res.json().catch(() => null) as { items?: unknown[] } | null
  if (!data || !Array.isArray(data.items)) return []

  return data.items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item): GmailCalendarEventItem => toCalendarEventItem(item, normalizedCalendarId))
    .filter((event) => !!event.id)
}

export async function listGmailCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  options?: {
    accountId?: string
    maxResults?: number
    scope?: GmailCalendarScope
    calendarId?: string
  },
): Promise<GmailCalendarEventItem[]> {
  const { accountId, maxResults = 250, scope, calendarId = "primary" } = options ?? {}
  const accessToken = await getValidGmailCalendarAccessToken(accountId, false, scope)
  return listEventsForCalendarWithToken(accessToken, timeMin, timeMax, calendarId, maxResults)
}

export async function listAllGmailCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  options?: {
    accountId?: string
    maxResults?: number
    scope?: GmailCalendarScope
  },
): Promise<GmailCalendarEventItem[]> {
  const { accountId, maxResults = 250, scope } = options ?? {}
  const desiredMax = Math.min(Math.max(1, maxResults), 2500)
  const accessToken = await getValidGmailCalendarAccessToken(accountId, false, scope)
  const calendarIds = await listGmailCalendarIdsWithToken(accessToken)
  const perCalendarMax = Math.min(2500, Math.max(50, Math.ceil(desiredMax / Math.max(1, calendarIds.length))))

  const byCalendar = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        return await listEventsForCalendarWithToken(accessToken, timeMin, timeMax, calendarId, perCalendarMax)
      } catch (error) {
        if (calendarId === "primary") throw error
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`[gcalendar][list_events] skipped calendar "${calendarId}": ${reason}`)
        return []
      }
    }),
  )

  const merged = dedupeCalendarEvents(byCalendar.flat())
  merged.sort((a, b) => calendarEventStartKey(a).localeCompare(calendarEventStartKey(b)))
  return merged.slice(0, desiredMax)
}

export async function createGmailCalendarEvent(
  event: {
    summary: string
    description?: string
    startAt: Date
    endAt: Date
    timeZone?: string
    eventId?: string
    recurrence?: string[]
  },
  options?: {
    accountId?: string
    calendarId?: string
    scope?: GmailCalendarScope
  },
): Promise<GmailCalendarEventItem> {
  const { accountId, calendarId = "primary", scope } = options ?? {}
  const accessToken = await getValidGmailCalendarAccessToken(accountId, false, scope)
  const summary = String(event.summary || "").trim() || "Nova Automation"
  const description = typeof event.description === "string" ? event.description.trim() : ""
  const timeZone = String(event.timeZone || "").trim() || "UTC"

  const body: Record<string, unknown> = {
    summary,
    description: description || undefined,
    start: {
      dateTime: event.startAt.toISOString(),
      timeZone,
    },
    end: {
      dateTime: event.endAt.toISOString(),
      timeZone,
    },
  }
  const recurrence = normalizeRecurrence(event.recurrence)
  if (recurrence) body.recurrence = recurrence
  const eventId = String(event.eventId || "").trim().toLowerCase()
  if (eventId) body.id = eventId

  const url = `${GCALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
  const res = await gmailFetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { operation: "gmail_calendar_create_event", maxAttempts: 3, timeoutMs: 12_000 },
  )
  if (res.status === 400 && eventId) {
    const createError = await readGmailErrorMessage(res, "Google Calendar event create failed.")
    if (/invalid resource id value/i.test(createError)) {
      // Fallback for strict ID validation variants: retry without caller-provided ID.
      const retryBody: Record<string, unknown> = { ...body }
      delete retryBody.id
      const retryRes = await gmailFetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(retryBody),
        },
        { operation: "gmail_calendar_create_event_no_id", maxAttempts: 3, timeoutMs: 12_000 },
      )
      await assertGmailOk(retryRes, "Google Calendar event create failed.")
      const retryRaw = await retryRes.json().catch(() => null) as Record<string, unknown> | null
      if (!retryRaw || typeof retryRaw !== "object") {
        return {
          id: "",
          summary,
          description: description || undefined,
          start: { dateTime: event.startAt.toISOString(), timeZone },
          end: { dateTime: event.endAt.toISOString(), timeZone },
          status: "confirmed",
        }
      }
      return toCalendarEventItem(retryRaw)
    }
    throw fromGmailHttpStatus(res.status, createError || "Google Calendar event create failed.")
  }
  if (res.status === 409 && eventId) {
    const patchUrl = `${GCALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    const patchBody: Record<string, unknown> = { ...body }
    delete patchBody.id
    const patchRes = await gmailFetchWithRetry(
      patchUrl,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(patchBody),
      },
      { operation: "gmail_calendar_update_event", maxAttempts: 3, timeoutMs: 12_000 },
    )
    await assertGmailOk(patchRes, "Google Calendar event update failed.")
    const updatedRaw = await patchRes.json().catch(() => null) as Record<string, unknown> | null
    if (!updatedRaw || typeof updatedRaw !== "object") {
      return {
        id: eventId,
        summary,
        description: description || undefined,
        start: { dateTime: event.startAt.toISOString(), timeZone },
        end: { dateTime: event.endAt.toISOString(), timeZone },
        status: "confirmed",
      }
    }
    return toCalendarEventItem(updatedRaw)
  }
  await assertGmailOk(res, "Google Calendar event create failed.")
  const raw = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!raw || typeof raw !== "object") {
    return {
      id: eventId || "",
      summary,
      description: description || undefined,
      start: { dateTime: event.startAt.toISOString(), timeZone },
      end: { dateTime: event.endAt.toISOString(), timeZone },
      status: "confirmed",
    }
  }
  return toCalendarEventItem(raw)
}

export async function deleteGmailCalendarEvent(
  eventId: string,
  options?: {
    accountId?: string
    calendarId?: string
    scope?: GmailCalendarScope
  },
): Promise<void> {
  const targetEventId = String(eventId || "").trim()
  if (!targetEventId) return

  const { accountId, calendarId = "primary", scope } = options ?? {}
  const accessToken = await getValidGmailCalendarAccessToken(accountId, false, scope)
  const url = `${GCALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}`
  const res = await gmailFetchWithRetry(
    url,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { operation: "gmail_calendar_delete_event", maxAttempts: 3, timeoutMs: 12_000 },
  )
  if (res.status === 404 || res.status === 410) return
  await assertGmailOk(res, "Google Calendar event delete failed.")
}

