"use client"

import Link from "next/link"
import { CalendarDays, ExternalLink } from "lucide-react"

import { Badge, Button, EmptyState, Panel, SkeletonRows } from "@/components/ui"
import type { CalendarEvent } from "@/lib/calendar/types"
import { cn } from "@/lib/shared/utils"
import type { HomeScheduleState } from "../hooks/use-home-schedule"

interface HomeScheduleProps {
  schedule: HomeScheduleState
  now: number
}

const KIND_LABEL: Record<CalendarEvent["kind"], string> = { mission: "Automation", agent: "Agent", personal: "Event" }

function isAllDay(event: CalendarEvent): boolean {
  return Date.parse(event.endAt) - Date.parse(event.startAt) >= 20 * 3_600_000
}

function timeRange(event: CalendarEvent): string {
  if (isAllDay(event)) return "All day"
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  return fmt(event.startAt)
}

function externalLink(event: CalendarEvent): string | null {
  return event.kind === "personal" && event.htmlLink?.startsWith("https://") ? event.htmlLink : null
}

/** Today's calendar: automations, agent runs and personal events, with the next one marked. */
export function HomeSchedule({ schedule, now }: HomeScheduleProps) {
  const { today, loading, error, refresh } = schedule
  const nextId = today.find((event) => !isAllDay(event) && Date.parse(event.endAt) >= now)?.id

  return (
    <Panel
      title="Today"
      description={new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      icon={<CalendarDays />}
      flush
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/missions/calendar">Calendar</Link>
        </Button>
      }
    >
      {error && today.length === 0 ? (
        <EmptyState
          size="compact"
          tone="danger"
          title="Could not load today's schedule"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : loading && today.length === 0 ? (
        <SkeletonRows rows={3} className="px-1 py-1" />
      ) : today.length === 0 ? (
        <EmptyState size="compact" title="Nothing scheduled today" description="Scheduled automations and connected calendar events show up here." />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {today.map((event) => {
            const past = !isAllDay(event) && Date.parse(event.endAt) < now
            const href = externalLink(event)
            const body = (
              <>
                <span className={cn("w-16 shrink-0 font-mono text-xs tabular-nums", event.id === nextId ? "text-accent-text" : "text-muted")}>
                  {timeRange(event)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", past ? "text-muted" : "text-fg")}>{event.title}</span>
                  {event.subtitle ? <span className="block truncate text-xs text-faint">{event.subtitle}</span> : null}
                </span>
                {event.status === "running" ? (
                  <Badge tone="accent" dot="pulse">
                    Running
                  </Badge>
                ) : event.status === "failed" ? (
                  <Badge tone="danger">Failed</Badge>
                ) : (
                  <span className="shrink-0 text-xs text-faint">{KIND_LABEL[event.kind]}</span>
                )}
                {href ? <ExternalLink className="size-3.5 shrink-0 text-faint" aria-hidden /> : null}
              </>
            )
            const rowClass = cn(
              "relative flex items-center gap-3 px-4 py-2 transition-colors hover:bg-hover",
              event.id === nextId && "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent",
            )
            return (
              <li key={event.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className={rowClass} aria-label={`${event.title}, open in Google Calendar`}>
                    {body}
                  </a>
                ) : (
                  <Link href="/missions/calendar" className={rowClass}>
                    {body}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
