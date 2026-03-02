/**
 * GmailCalendar integration types.
 *
 * OAuth is shared with Gmail (same Google OAuth app / credentials).
 * Only the API base URL and scopes differ.
 */
import type { IntegrationsStoreScope } from "../../store/server-store"

export const GCALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"

export const GMAIL_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"

export type GmailCalendarScope = IntegrationsStoreScope

export interface GmailCalendarEventItem {
  id: string
  calendarId?: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  status?: "confirmed" | "tentative" | "cancelled"
  htmlLink?: string
  organizer?: { email?: string }
  attendees?: Array<{ email?: string; responseStatus?: string; self?: boolean }>
}

export interface GmailCalendarListItem {
  id: string
  summary?: string
  primary?: boolean
  selected?: boolean
  accessRole?: string
}
