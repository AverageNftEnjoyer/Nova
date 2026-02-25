/**
 * Calendar Hub — shared types
 * All times in ISO8601 UTC. UI converts to user timezone for display.
 */

export type CalendarEventKind = "personal" | "mission" | "agent"
export type CalendarEventStatus = "scheduled" | "running" | "completed" | "failed" | "draft"

interface BaseCalendarEvent {
  id: string
  kind: CalendarEventKind
  title: string
  subtitle?: string
  startAt: string   // ISO8601
  endAt: string     // ISO8601
  status: CalendarEventStatus
}

export interface MissionCalendarEvent extends BaseCalendarEvent {
  kind: "mission"
  missionId: string
  nodeCount: number
  integration?: string
  category?: string
  conflict?: boolean
  reschedulable: true
}

export interface AgentCalendarEvent extends BaseCalendarEvent {
  kind: "agent"
  agentType: string
  triggeredBy?: string     // missionId or "system"
  missionRunId?: string    // telemetry run id for traceability
  reschedulable: false
}

export interface PersonalCalendarEvent extends BaseCalendarEvent {
  kind: "personal"
  provider: "manual" | "gcalendar"
  externalId?: string    // Google Calendar event id
  htmlLink?: string      // direct link to event on Google Calendar
  reschedulable: false
}

export type CalendarEvent = MissionCalendarEvent | AgentCalendarEvent | PersonalCalendarEvent

export interface CalendarEventsResponse {
  ok: true
  events: CalendarEvent[]
  rangeStart: string
  rangeEnd: string
}
