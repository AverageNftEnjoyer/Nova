/**
 * Calendar aggregator source: GmailCalendar personal events.
 *
 * Only invoked when the user has a connected GmailCalendar account.
 * Skips silently if not connected to avoid errors in the default case.
 */
import "server-only"

import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { listCalendarEvents } from "@/lib/integrations/gmail-calendar/service"
import type { PersonalCalendarEvent } from "./types"

export async function loadGmailCalendarEvents(
  userId: string,
  rangeStart: Date,
  rangeEnd: Date,
  /** Pass pre-loaded connected flag to avoid a redundant DB round-trip. */
  gcalendarConnected?: boolean,
): Promise<PersonalCalendarEvent[]> {
  // If the caller already knows the connected state, skip the DB read
  let connected = gcalendarConnected
  if (connected === undefined) {
    try {
      const config = await loadIntegrationsConfig({ userId })
      connected = Boolean(config.gcalendar.connected)
    } catch {
      return []
    }
  }

  if (!connected) return []

  let rawEvents
  try {
    rawEvents = await listCalendarEvents(rangeStart, rangeEnd, undefined, { userId })
  } catch {
    // Calendar fetch failure is non-fatal — the rest of the calendar still loads.
    return []
  }

  return rawEvents
    .filter((ev) => ev.status !== "cancelled" && !!ev.id)
    .map((ev): PersonalCalendarEvent => {
      const startRaw = ev.start?.dateTime ?? ev.start?.date ?? ""
      const endRaw   = ev.end?.dateTime   ?? ev.end?.date   ?? ""
      const isAllDay = !ev.start?.dateTime

      // All-day events: date strings like "2025-03-10" — parse as local noon to
      // avoid off-by-one from UTC midnight crossing, and give them a 24h span.
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
