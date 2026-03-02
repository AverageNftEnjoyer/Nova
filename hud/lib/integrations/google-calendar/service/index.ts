/**
 * GmailCalendar public service API.
 *
 * All OAuth uses the same Google app as Gmail — no separate client ID/secret.
 */
import { buildGmailCalendarOAuthUrl as buildOAuthUrl, parseGmailCalendarOAuthState as parseOAuthState } from "../auth/index.ts"
import {
  createGmailCalendarEvent as createEvent,
  deleteGmailCalendarEvent as deleteEvent,
  listAllGmailCalendarEvents as listAllEvents,
} from "../events/index.ts"
import {
  disconnectGmailCalendar as disconnectTokens,
  exchangeCodeForGmailCalendarTokens,
  getGmailCalendarClientConfig,
  getValidGmailCalendarAccessToken,
} from "../tokens/index.ts"
import type { GmailCalendarScope } from "../types/index.ts"
import type { GmailCalendarEventItem } from "../types/index.ts"

export async function buildGmailCalendarOAuthUrl(returnTo: string, scope?: GmailCalendarScope): Promise<string> {
  const config = await getGmailCalendarClientConfig(scope)
  const userId = String(scope?.userId || scope?.user?.id || "").trim()
  // Pass existing Gmail scopes so consent screen increments rather than replaces
  const { loadIntegrationsConfig } = await import("../../store/server-store")
  const integrations = await loadIntegrationsConfig(scope)
  const currentGmailScopes = integrations.gmail.scopes ?? []
  return buildOAuthUrl({ returnTo, userId, config, currentGmailScopes })
}

export const parseGmailCalendarOAuthState = parseOAuthState

export { exchangeCodeForGmailCalendarTokens, getValidGmailCalendarAccessToken }

export async function disconnectGmailCalendar(accountId?: string, scope?: GmailCalendarScope): Promise<void> {
  return disconnectTokens(accountId, scope)
}

export async function listCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  accountId?: string,
  scope?: GmailCalendarScope,
): Promise<GmailCalendarEventItem[]> {
  return listAllEvents(timeMin, timeMax, { accountId, scope })
}

export async function createCalendarEvent(
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
  return createEvent(event, options)
}

export async function deleteCalendarEvent(
  eventId: string,
  options?: {
    accountId?: string
    calendarId?: string
    scope?: GmailCalendarScope
  },
): Promise<void> {
  return deleteEvent(eventId, options)
}

