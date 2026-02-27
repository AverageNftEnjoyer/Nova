/**
 * GmailCalendar event fetching.
 *
 * Calls the Google Calendar API using an access token obtained from
 * getValidGmailCalendarAccessToken (stored under the `gcalendar` config key).
 */
import { gmailFetchWithRetry, assertGmailOk } from "../gmail/client.ts"
import { GCALENDAR_API_BASE, type GmailCalendarEventItem, type GmailCalendarScope } from "./types.ts"
import { getValidGmailCalendarAccessToken } from "./tokens.ts"

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

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: String(Math.min(maxResults, 2500)),
    singleEvents: "true",
    orderBy: "startTime",
  })

  const url = `${GCALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
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
    .map((item): GmailCalendarEventItem => ({
      id: String(item.id || ""),
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
    }))
    .filter((ev) => !!ev.id)
}

