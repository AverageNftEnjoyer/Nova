/**
 * Calendar aggregator source: GmailCalendar personal events.
 *
 * Only invoked when the user has a connected GmailCalendar account.
 * Skips silently if not connected to avoid errors in the default case.
 */
import "server-only"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { listCalendarEvents } from "@/lib/integrations/google-calender/service"
import type { GmailCalendarScope } from "@/lib/integrations/google-calender/types"
import type { PersonalCalendarEvent } from "./types"

const NOVA_MIRROR_ID_RE = /^(?:novamission|novaschedule|nova)[a-v0-9]{12,}(?:_[0-9]{8}t[0-9]{6}z)?$/i

function isNovaMirroredScheduleEventId(eventId: string): boolean {
  const normalized = String(eventId || "").trim().toLowerCase()
  if (!normalized) return false
  return NOVA_MIRROR_ID_RE.test(normalized)
}

export async function loadGmailCalendarEvents(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
  /** Pass pre-loaded connected flag to avoid a redundant DB round-trip. */
  gcalendarConnected?: boolean,
  scope?: GmailCalendarScope,
): Promise<PersonalCalendarEvent[]> {
  // If the caller already knows the connected state, skip the DB read
  let connected = gcalendarConnected
  if (connected === undefined) {
    try {
      const config = await loadIntegrationsConfig(scope ?? { userId })
      connected = Boolean(config.gcalendar.connected)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[calendar][gcalendar] unable to load integration state for user "${userId}": ${reason}`)
      return []
    }
  }

  if (!connected) return []

  let rawEvents
  try {
    rawEvents = await listCalendarEvents(rangeStart, rangeEnd, undefined, scope ?? { userId })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[calendar][gcalendar] event fetch failed for user "${userId}" (${rangeStart.toISOString()} to ${rangeEnd.toISOString()}): ${reason}`,
    )
    // Calendar fetch failure is non-fatal so the rest of the calendar can still load.
    return []
  }

  return rawEvents
    // Nova mirrors mission/schedule events into Google Calendar for user parity.
    // Do not re-ingest those mirrored events as "personal" rows, or the Nova UI
    // shows duplicates (native mission row + mirrored Google row).
    .filter((ev) => ev.status !== "cancelled" && !!ev.id && !isNovaMirroredScheduleEventId(ev.id))
    .map((ev): PersonalCalendarEvent => {
      const startRaw = ev.start?.dateTime ?? ev.start?.date ?? ""
      const endRaw = ev.end?.dateTime ?? ev.end?.date ?? ""
      const isAllDay = !ev.start?.dateTime

      // All-day events: date strings like 2025-03-10. Parse as local noon to avoid
      // off-by-one from UTC midnight crossing, and give them a 24h span.
      const startAt = startRaw
        ? isAllDay
          ? new Date(`${startRaw}T12:00:00`).toISOString()
          : new Date(startRaw).toISOString()
        : rangeStart.toISOString()

      const endAt = endRaw
        ? isAllDay
          ? new Date(`${endRaw}T12:00:00`).toISOString()
          : new Date(endRaw).toISOString()
        : new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString()

      return {
        id: `gcal::${ev.id}`,
        kind: "personal",
        provider: "gcalendar",
        externalId: ev.id,
        htmlLink: ev.htmlLink,
        title: ev.summary || "(No title)",
        subtitle: ev.organizer?.email,
        startAt,
        endAt,
        status: "scheduled",
        reschedulable: false,
      }
    })
}
