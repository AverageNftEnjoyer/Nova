"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, Layers, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"

import { PageContainer } from "@/components/shell"
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Panel,
  Spinner,
  StatusDot,
  Tabs,
  TabsList,
  TabsTrigger,
  type StatusTone,
} from "@/components/ui"
import { useNovaState, type CalendarEmitPayload } from "@/lib/chat/hooks/useNovaState"
import { useCalendarEvents } from "@/lib/calendar/useCalendarEvents"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/store/client-store"
import { loadCalendarCategories, addCalendarCategory, removeCalendarCategory, PRESET_COLORS, type CalendarCategory } from "@/lib/calendar/category-store"
import type { CalendarEvent, PersonalCalendarEvent } from "@/lib/calendar/types"
import { cn } from "@/lib/shared/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type EventKind = "personal" | "mission" | "agent"
type EventStatus = "scheduled" | "running" | "completed" | "failed" | "draft"
type CalView = "week" | "month" | "day"

interface CalEvent {
  id: string
  kind: EventKind
  title: string
  sub?: string
  date: Date
  startH: number
  startM: number
  durMin: number
  status: EventStatus
  missionId?: string
  nodeCount?: number
  conflict?: boolean
  allDay?: boolean
  provider?: "manual" | "gcalendar"
  externalId?: string
  htmlLink?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PX_HR = 48
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const KINDS: EventKind[] = ["mission", "agent", "personal"]

/** Missions take the accent; agent tasks stay neutral; personal (Google Calendar) events get one quiet chart hue. */
const KIND: Record<EventKind, { label: string; tone: string }> = {
  mission: { label: "Missions", tone: "var(--accent)" },
  agent: { label: "Agent tasks", tone: "var(--fg-muted)" },
  personal: { label: "Personal", tone: "var(--chart-3)" },
}

const STATUS: Record<EventStatus, { tone: StatusTone; label: string }> = {
  scheduled: { tone: "idle", label: "Scheduled" },
  running: { tone: "running", label: "Running" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "danger", label: "Failed" },
  draft: { tone: "idle", label: "Draft" },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(d: Date): Date {
  const date = new Date(d)
  date.setDate(date.getDate() - date.getDay())
  date.setHours(0, 0, 0, 0)
  return date
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtTime(h: number, m = 0) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function fmtDur(min: number) {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtFullDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function evTop(h: number, m: number) { return (h + m / 60) * PX_HR }
function evHt(min: number) { return Math.max((min / 60) * PX_HR, 20) }

/**
 * Column assignment for overlapping events in one day column: each event renders at width 1/numCols and
 * offset col/numCols, the usual side-by-side split for simultaneous events.
 */
function computeEventLayout(events: CalEvent[]): Map<string, { col: number; numCols: number }> {
  if (!events.length) return new Map()
  const sorted = [...events].sort((a, b) => {
    const aStart = a.startH * 60 + a.startM
    const bStart = b.startH * 60 + b.startM
    if (aStart !== bStart) return aStart - bStart
    return (b.startH * 60 + b.startM + b.durMin) - (a.startH * 60 + a.startM + a.durMin)
  })
  const colEnds: number[] = []
  const assignment = new Map<string, number>()
  for (const ev of sorted) {
    const start = ev.startH * 60 + ev.startM
    const end = start + ev.durMin
    const free = colEnds.findIndex((colEnd) => colEnd <= start)
    if (free >= 0) {
      assignment.set(ev.id, free)
      colEnds[free] = end
    } else {
      assignment.set(ev.id, colEnds.length)
      colEnds.push(end)
    }
  }
  const result = new Map<string, { col: number; numCols: number }>()
  for (const ev of sorted) {
    const evStart = ev.startH * 60 + ev.startM
    const evEnd = evStart + ev.durMin
    const col = assignment.get(ev.id) ?? 0
    let maxCol = col
    for (const other of sorted) {
      if (other.id === ev.id) continue
      const oStart = other.startH * 60 + other.startM
      const oEnd = oStart + other.durMin
      if (evStart < oEnd && oStart < evEnd) maxCol = Math.max(maxCol, assignment.get(other.id) ?? 0)
    }
    result.set(ev.id, { col, numCols: maxCol + 1 })
  }
  return result
}

/** Date cells for a month grid (Sunday start, whole weeks). */
function getMonthCells(year: number, month: number): Date[] {
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const total = Math.ceil((firstDow + daysInMonth) / 7) * 7
  return Array.from({ length: total }, (_, i) => new Date(year, month, 1 - firstDow + i))
}

function apiEventToCalEvent(ev: CalendarEvent): CalEvent {
  const start = new Date(ev.startAt)
  const end = new Date(ev.endAt)
  const personal = ev.kind === "personal" ? (ev as PersonalCalendarEvent) : null
  const durMs = end.getTime() - start.getTime()
  // Google all-day events (20h or longer) sit at the top of the day as a one-hour block.
  const allDay = personal?.provider === "gcalendar" && durMs >= 20 * 60 * 60 * 1000
  return {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    sub: ev.subtitle,
    date: start,
    startH: allDay ? 0 : Math.max(start.getHours(), 0),
    startM: allDay ? 0 : start.getMinutes(),
    durMin: allDay ? 60 : Math.max(Math.round(durMs / 60000), 15),
    status: ev.status,
    missionId: ev.kind === "mission" ? ev.missionId : undefined,
    nodeCount: ev.kind === "mission" ? ev.nodeCount : undefined,
    conflict: ev.kind === "mission" ? ev.conflict : undefined,
    allDay,
    provider: personal?.provider,
    externalId: personal?.externalId,
    htmlLink: personal?.htmlLink,
  }
}

function subscribeIntegrations(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onChange as EventListener)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onChange as EventListener)
  }
}

function readGcalConnected(): boolean {
  try {
    return Boolean(loadIntegrationsSettings().gcalendar?.connected)
  } catch {
    return false
  }
}

// ─── Event block (week/day) ───────────────────────────────────────────────────

function EventBlock({ ev, active, onClick, col = 0, numCols = 1 }: { ev: CalEvent; active: boolean; onClick: () => void; col?: number; numCols?: number }) {
  const top = evTop(ev.startH, ev.startM)
  const ht = evHt(ev.durMin)
  const compact = ht < 34
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "absolute overflow-hidden rounded-sm border border-border border-l-2 bg-surface-3 px-1.5 text-left transition-colors hover:bg-active",
        active ? "z-10 ring-1 ring-accent" : "z-1",
        ev.status === "completed" && "opacity-60",
      )}
      style={{
        top,
        height: ht,
        left: `calc(${((col / numCols) * 100).toFixed(2)}% + 2px)`,
        width: `calc(${(100 / numCols).toFixed(2)}% - 4px)`,
        borderLeftColor: KIND[ev.kind].tone,
      }}
    >
      <div className={cn("flex items-center gap-1", compact ? "pt-0.5" : "pt-1")}>
        {ev.status === "running" ? <StatusDot tone="running" size="sm" /> : null}
        {ev.conflict ? <StatusDot tone="warning" size="sm" label="Conflict" /> : null}
        <span className="truncate text-2xs font-medium leading-tight text-fg">{ev.title}</span>
      </div>
      {!compact ? (
        <div className="truncate font-mono text-2xs text-muted tabular-nums">{ev.allDay ? "All day" : fmtTime(ev.startH, ev.startM)}</div>
      ) : null}
    </button>
  )
}

// ─── Time grid (week and day views) ───────────────────────────────────────────

function TimeGrid({ days, events, now, selected, onSelect }: {
  days: Date[]
  events: CalEvent[]
  now: Date
  selected: string | null
  onSelect: (ev: CalEvent | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const totalH = HOURS.length * PX_HR
  const nowTop = evTop(now.getHours(), now.getMinutes())
  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`

  // Open scrolled to an hour before now (or 7:00), not midnight.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const anchorHour = days.some((day) => sameDay(day, now)) ? Math.max(now.getHours() - 1, 0) : 7
    el.scrollTop = Math.max(anchorHour * PX_HR - 12, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => {
          const isToday = sameDay(day, now)
          return (
            <div key={day.toISOString()} className="flex items-baseline justify-center gap-1.5 border-l border-border-subtle py-2">
              <span className={cn("text-xs", isToday ? "text-accent-text" : "text-muted")}>{DAY_ABBR[day.getDay()]}</span>
              <span
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full text-sm font-medium tabular-nums",
                  isToday ? "bg-accent text-accent-fg" : "text-fg",
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="relative" style={{ height: totalH }}>
            {HOURS.map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-2xs text-faint tabular-nums"
                style={{ top: h === 0 ? 8 : h * PX_HR }}
              >
                {fmtTime(h)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dayEvs = events.filter((e) => sameDay(e.date, day))
            const layout = computeEventLayout(dayEvs)
            const isToday = sameDay(day, now)
            return (
              <div key={day.toISOString()} className={cn("relative border-l border-border-subtle", isToday && "bg-hover")} style={{ height: totalH }}>
                {HOURS.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border-subtle" style={{ top: h * PX_HR }} />
                ))}
                {isToday ? (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
                    <div className="relative h-px bg-accent">
                      <span className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-accent" />
                    </div>
                  </div>
                ) : null}
                {dayEvs.map((ev) => {
                  const { col, numCols } = layout.get(ev.id) ?? { col: 0, numCols: 1 }
                  return (
                    <EventBlock
                      key={ev.id}
                      ev={ev}
                      col={col}
                      numCols={numCols}
                      active={selected === ev.id}
                      onClick={() => onSelect(selected === ev.id ? null : ev)}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Month view ───────────────────────────────────────────────────────────────

function MonthView({ year, month, events, today, onSelect, onOpenDay }: {
  year: number
  month: number
  events: CalEvent[]
  today: Date
  onSelect: (ev: CalEvent) => void
  onOpenDay: (d: Date) => void
}) {
  const cells = useMemo(() => getMonthCells(year, month), [year, month])
  const weeks = cells.length / 7
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {DAY_ABBR.map((d) => (
          <div key={d} className="border-l border-border-subtle py-2 text-center text-xs text-muted first:border-l-0">{d}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 overflow-y-auto" style={{ gridTemplateRows: `repeat(${weeks}, minmax(6rem, 1fr))` }}>
        {Array.from({ length: weeks }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 border-b border-border-subtle last:border-b-0">
            {cells.slice(row * 7, row * 7 + 7).map((cell) => {
              const inMonth = cell.getMonth() === month
              const isToday = sameDay(cell, today)
              const dayEvs = events.filter((e) => sameDay(e.date, cell))
              return (
                <div key={cell.toISOString()} className="flex min-w-0 flex-col gap-0.5 border-l border-border-subtle p-1.5 first:border-l-0">
                  <button
                    type="button"
                    onClick={() => onOpenDay(cell)}
                    aria-label={`Open ${fmtFullDate(cell)}`}
                    className={cn(
                      "mb-0.5 inline-flex size-6 items-center justify-center self-start rounded-full text-xs font-medium tabular-nums hover:bg-hover",
                      isToday ? "bg-accent text-accent-fg hover:bg-accent-hover" : inMonth ? "text-fg" : "text-faint",
                    )}
                  >
                    {cell.getDate()}
                  </button>
                  {dayEvs.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onSelect(ev)}
                      className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-hover"
                    >
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: KIND[ev.kind].tone }} />
                      <span className="shrink-0 font-mono text-2xs text-faint tabular-nums">{ev.allDay ? "All day" : fmtTime(ev.startH, ev.startM)}</span>
                      <span className={cn("truncate text-2xs", inMonth ? "text-fg" : "text-muted")}>{ev.title}</span>
                    </button>
                  ))}
                  {dayEvs.length > 3 ? (
                    <button type="button" onClick={() => onOpenDay(cell)} className="px-1 text-left text-2xs text-muted hover:text-fg">
                      {dayEvs.length - 3} more
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Mini month (side column) ─────────────────────────────────────────────────

function MiniMonth({ year, month, rangeStart, rangeEnd, today, onNavigate, onSelectDate }: {
  year: number
  month: number
  rangeStart: Date
  rangeEnd: Date
  today: Date
  onNavigate: (delta: number) => void
  onSelectDate: (d: Date) => void
}) {
  const cells = useMemo(() => getMonthCells(year, month), [year, month])
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-fg">{MONTHS[month]} {year}</span>
        <div className="flex">
          <IconButton aria-label="Previous month" size="sm" onClick={() => onNavigate(-1)}><ChevronLeft /></IconButton>
          <IconButton aria-label="Next month" size="sm" onClick={() => onNavigate(1)}><ChevronRight /></IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7">
        {DAY_ABBR.map((d) => (
          <span key={d} className="py-1 text-center text-2xs text-faint">{d.slice(0, 2)}</span>
        ))}
        {cells.map((cell) => {
          const inMonth = cell.getMonth() === month
          const isToday = sameDay(cell, today)
          const inRange = cell >= rangeStart && cell < rangeEnd
          return (
            <button
              key={cell.toISOString()}
              type="button"
              onClick={() => onSelectDate(cell)}
              aria-label={fmtFullDate(cell)}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "mx-auto my-0.5 inline-flex size-7 items-center justify-center rounded-md text-xs tabular-nums",
                isToday ? "bg-accent font-medium text-accent-fg" : inRange ? "bg-active text-fg" : inMonth ? "text-fg hover:bg-hover" : "text-faint hover:bg-hover",
              )}
            >
              {cell.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Event detail dialog ──────────────────────────────────────────────────────

function EventDialog({ ev, onClose, onReschedule, onRemoveOverride, onDelete, onPublishCalendarEvent }: {
  ev: CalEvent | null
  onClose: () => void
  onReschedule: (missionId: string, newStartAt: string) => Promise<{ ok: boolean; conflict: boolean; error?: string }>
  onRemoveOverride: (missionId: string) => Promise<{ ok: boolean; error?: string }>
  onDelete: (ev: CalEvent) => Promise<void>
  onPublishCalendarEvent?: (payload: CalendarEmitPayload) => void
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [pickerDate, setPickerDate] = useState("")
  const [pickerTime, setPickerTime] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [shownId, setShownId] = useState<string | null>(null)
  if (ev && ev.id !== shownId) {
    // Reset per-event state when a different event opens (render-time sync, no effect).
    setShownId(ev.id)
    setRescheduleOpen(false)
    setPickerDate(`${ev.date.getFullYear()}-${String(ev.date.getMonth() + 1).padStart(2, "0")}-${String(ev.date.getDate()).padStart(2, "0")}`)
    setPickerTime(fmtTime(ev.startH, ev.startM))
    setSaveError(null)
    setConflict(false)
    setConfirmDelete(false)
  }

  if (!ev) return null

  const endTotal = ev.startH * 60 + ev.startM + ev.durMin
  const isOverrideEvent = ev.id.endsWith("::override")
  const status = STATUS[ev.status]

  async function handleReschedule() {
    if (!ev?.missionId) return
    const proposed = new Date(`${pickerDate}T${pickerTime}:00`)
    if (Number.isNaN(proposed.getTime())) {
      setSaveError("Enter a valid date and time.")
      return
    }
    if (proposed.getTime() < Date.now() - 10 * 60 * 1000) {
      setSaveError("Pick a time in the future.")
      return
    }
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    const iso = proposed.toISOString()
    const result = await onReschedule(ev.missionId, iso)
    setSaving(false)
    if (!result.ok) {
      setSaveError(result.error ?? "Failed to reschedule.")
      return
    }
    onPublishCalendarEvent?.({ eventType: "calendar:rescheduled", missionId: ev.missionId, newStartAt: iso, conflict: result.conflict })
    onPublishCalendarEvent?.({ eventType: "calendar:event:updated", eventId: ev.id, patch: { startAt: iso, conflict: result.conflict === true } })
    if (result.conflict) {
      onPublishCalendarEvent?.({ eventType: "calendar:conflict", conflicts: [ev.id] })
      setConflict(true)
    } else {
      onClose()
    }
  }

  async function handleRemoveOverride() {
    if (!ev?.missionId) return
    setSaving(true)
    const result = await onRemoveOverride(ev.missionId)
    setSaving(false)
    if (result.ok) {
      onPublishCalendarEvent?.({ eventType: "calendar:event:updated", eventId: ev.id, patch: { overrideCleared: true } })
      onClose()
    } else {
      setSaveError(result.error ?? "Failed to restore the original time.")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} size="sm">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: KIND[ev.kind].tone }} />
          <span className="text-xs text-muted">{KIND[ev.kind].label}</span>
        </div>
        <DialogTitle>{ev.title}</DialogTitle>
        {ev.sub ? <DialogDescription className="font-mono text-xs">{ev.sub}</DialogDescription> : <DialogDescription className="sr-only">Event details</DialogDescription>}
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Date</dt>
            <CalendarDays aria-hidden className="size-4 text-faint" />
            <dd className="text-fg">{fmtFullDate(ev.date)}</dd>
          </div>
          <div className="flex items-center gap-2.5">
            <dt className="sr-only">Time</dt>
            <Clock aria-hidden className="size-4 text-faint" />
            <dd className="font-mono text-fg tabular-nums">
              {ev.allDay ? "All day" : `${fmtTime(ev.startH, ev.startM)} to ${fmtTime(Math.floor(endTotal / 60) % 24, endTotal % 60)}`}
              {!ev.allDay ? <span className="ml-2 text-muted">{fmtDur(ev.durMin)}</span> : null}
            </dd>
          </div>
          {ev.nodeCount != null ? (
            <div className="flex items-center gap-2.5">
              <dt className="sr-only">Nodes</dt>
              <Layers aria-hidden className="size-4 text-faint" />
              <dd className="text-fg tabular-nums">{ev.nodeCount} {ev.nodeCount === 1 ? "node" : "nodes"}</dd>
            </div>
          ) : null}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone === "running" ? "accent" : status.tone === "success" ? "success" : status.tone === "danger" ? "danger" : "neutral"} dot={status.tone === "running" ? "pulse" : true}>
            {status.label}
          </Badge>
          {isOverrideEvent ? <Badge tone="info">Rescheduled</Badge> : null}
          {ev.conflict ? <Badge tone="warning">Overlaps another mission</Badge> : null}
        </div>

        {conflict ? (
          <p className="rounded-md bg-warning-muted px-3 py-2 text-xs text-warning">Saved, but this time overlaps another scheduled mission.</p>
        ) : null}
        {saveError ? <p className="rounded-md bg-danger-muted px-3 py-2 text-xs text-danger" role="alert">{saveError}</p> : null}

        {rescheduleOpen && ev.kind === "mission" ? (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <Field label="Date">
                <Input type="date" mono value={pickerDate} onChange={(e) => setPickerDate(e.target.value)} />
              </Field>
              <Field label="Time">
                <Input type="time" mono value={pickerTime} onChange={(e) => setPickerTime(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setRescheduleOpen(false); setSaveError(null); setConflict(false) }}>Cancel</Button>
              <Button size="sm" onClick={() => void handleReschedule()} loading={saving}>Move run</Button>
            </div>
          </div>
        ) : null}

        {confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
            <p className="text-sm text-fg">Delete this mission? Its scheduled runs stop immediately.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => void onDelete(ev)} data-autofocus>Delete mission</Button>
            </div>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter className="justify-between">
        <div className="flex gap-1">
          {ev.kind === "mission" && ev.missionId && !confirmDelete ? (
            <IconButton aria-label="Delete mission" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="text-danger hover:text-danger">
              <Trash2 />
            </IconButton>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {isOverrideEvent && ev.missionId ? (
            <Button variant="ghost" size="sm" onClick={() => void handleRemoveOverride()} disabled={saving}>
              <RotateCcw />
              Restore time
            </Button>
          ) : null}
          {ev.kind === "mission" && !rescheduleOpen ? (
            <Button variant="secondary" size="sm" onClick={() => { setRescheduleOpen(true); setSaveError(null); setConflict(false) }}>
              Reschedule
            </Button>
          ) : null}
          {ev.kind === "mission" && ev.missionId ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/missions?editId=${ev.missionId}&returnTo=/missions/calendar`} onClick={onClose}>
                <Pencil />
                Edit mission
              </Link>
            </Button>
          ) : null}
          {ev.kind === "personal" && ev.provider === "gcalendar" && ev.htmlLink?.startsWith("https://") ? (
            <Button variant="secondary" size="sm" asChild>
              <a href={ev.htmlLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open in Google Calendar
              </a>
            </Button>
          ) : null}
        </div>
      </DialogFooter>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MissionsCalendarPage() {
  const { chatTransportEvents, publishCalendarEvent } = useNovaState()
  const gcalConnected = useSyncExternalStore(subscribeIntegrations, readGcalConnected, () => false)

  const [view, setView] = useState<CalView>("week")
  const [selected, setSelected] = useState<CalEvent | null>(null)
  const [filters, setFilters] = useState<Record<EventKind, boolean>>({ personal: true, mission: true, agent: true })
  const [customCategories, setCustomCategories] = useState<CalendarCategory[]>([])
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [newCatLabel, setNewCatLabel] = useState("")
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[4])

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [dayView, setDayView] = useState(() => new Date())
  // Mini month = the main view's month plus this offset (browsing it does not move the main view).
  const [miniOffset, setMiniOffset] = useState(0)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  const today = useMemo(() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d
  }, [now])

  useEffect(() => {
    // Custom categories live in browser storage, so they are read after mount.
    setCustomCategories(loadCalendarCategories().filter((c) => !c.builtin)) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  }), [weekStart])

  const anchor = view === "day" ? dayView : weekStart
  const monthYear = anchor.getFullYear()
  const monthMonth = anchor.getMonth()

  const { fetchStart, fetchEnd } = useMemo(() => {
    if (view === "month") return { fetchStart: new Date(monthYear, monthMonth, 1), fetchEnd: new Date(monthYear, monthMonth + 1, 0, 23, 59, 59, 999) }
    if (view === "day") {
      return {
        fetchStart: new Date(dayView.getFullYear(), dayView.getMonth(), dayView.getDate(), 0, 0, 0, 0),
        fetchEnd: new Date(dayView.getFullYear(), dayView.getMonth(), dayView.getDate(), 23, 59, 59, 999),
      }
    }
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 7)
    return { fetchStart: weekStart, fetchEnd: end }
  }, [dayView, monthMonth, monthYear, view, weekStart])

  const { events: apiEvents, loading, error, refetch, reschedule, removeOverride } = useCalendarEvents(fetchStart, fetchEnd)

  const latestCalendarTransportSeq = useMemo(() => {
    for (let i = chatTransportEvents.length - 1; i >= 0; i -= 1) {
      const event = chatTransportEvents[i]
      if (event.type === "calendar:event:updated" || event.type === "calendar:rescheduled" || event.type === "calendar:conflict") return event.seq
    }
    return 0
  }, [chatTransportEvents])
  const lastHandledCalendarSeqRef = useRef(0)
  useEffect(() => {
    if (latestCalendarTransportSeq <= 0 || latestCalendarTransportSeq === lastHandledCalendarSeqRef.current) return
    lastHandledCalendarSeqRef.current = latestCalendarTransportSeq
    refetch()
  }, [latestCalendarTransportSeq, refetch])

  const calEvents = useMemo(() => {
    const mapped = apiEvents.map(apiEventToCalEvent)
    return Array.from(new Map(mapped.map((e) => [e.id, e])).values())
  }, [apiEvents])
  const visibleEvents = useMemo(() => calEvents.filter((e) => filters[e.kind]), [calEvents, filters])
  const upcoming = useMemo(
    () => visibleEvents
      .filter((e) => {
        const start = new Date(e.date)
        start.setHours(e.startH, e.startM, 0, 0)
        return start.getTime() + e.durMin * 60_000 >= now.getTime()
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.startH * 60 + a.startM - (b.startH * 60 + b.startM))
      .slice(0, 8),
    [now, visibleEvents],
  )
  const conflictCount = calEvents.filter((e) => e.conflict).length

  const toolbarLabel = useMemo(() => {
    if (view === "week") {
      const endDay = new Date(weekStart)
      endDay.setDate(endDay.getDate() + 6)
      if (weekStart.getMonth() === endDay.getMonth()) return `${MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()}`
      return `${weekStart.toLocaleDateString(undefined, { month: "short" })} to ${endDay.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
    }
    if (view === "month") return `${MONTHS[monthMonth]} ${monthYear}`
    return dayView.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  }, [view, weekStart, monthYear, monthMonth, dayView])

  const shift = useCallback((delta: number) => {
    setSelected(null)
    setMiniOffset(0)
    if (view === "week") setWeekStart((ws) => { const d = new Date(ws); d.setDate(d.getDate() + 7 * delta); return d })
    else if (view === "month") setWeekStart((ws) => new Date(ws.getFullYear(), ws.getMonth() + delta, 1))
    else setDayView((d) => { const n = new Date(d); n.setDate(n.getDate() + delta); return n })
  }, [view])

  const goToday = useCallback(() => {
    setSelected(null)
    setMiniOffset(0)
    setWeekStart(getWeekStart(new Date()))
    setDayView(new Date())
  }, [])

  const openDay = useCallback((d: Date) => {
    setSelected(null)
    setMiniOffset(0)
    setWeekStart(getWeekStart(d))
    setDayView(d)
    setView("day")
  }, [])

  const miniDate = new Date(monthYear, monthMonth + miniOffset, 1)
  const viewRangeEnd = view === "month" ? new Date(monthYear, monthMonth + 1, 1) : fetchEnd

  const handleAddCategory = useCallback(() => {
    if (!newCatLabel.trim()) return
    const cat = addCalendarCategory(newCatLabel.trim(), newCatColor)
    setCustomCategories((prev) => [...prev, cat])
    setNewCatLabel("")
    setNewCatColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
    setAddCatOpen(false)
  }, [newCatLabel, newCatColor])

  const handleRemoveCategory = useCallback((id: string) => {
    removeCalendarCategory(id)
    setCustomCategories((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleDeleteMission = useCallback(async (ev: CalEvent) => {
    if (!ev.missionId) return
    setSelected(null)
    await fetch(`/api/missions?id=${encodeURIComponent(ev.missionId)}`, { method: "DELETE", credentials: "include" }).catch(() => {})
    refetch()
  }, [refetch])

  return (
    <PageContainer width="full" fill>
      <PageHeader
        title="Calendar"
        description="Scheduled mission runs, agent tasks and Google Calendar events."
        actions={(
          <Button asChild>
            <Link href="/missions?create=builder&returnTo=/missions/calendar">
              <Plus />
              New mission
            </Link>
          </Button>
        )}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <section aria-label="Calendar" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="flex">
              <IconButton aria-label={`Previous ${view}`} size="sm" onClick={() => shift(-1)}><ChevronLeft /></IconButton>
              <IconButton aria-label={`Next ${view}`} size="sm" onClick={() => shift(1)}><ChevronRight /></IconButton>
            </div>
            <h2 className="text-md font-medium text-fg">{toolbarLabel}</h2>
            <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
            {loading ? <Spinner size="sm" aria-label="Loading events" /> : null}
            {conflictCount > 0 ? <Badge tone="warning" dot>{conflictCount} {conflictCount === 1 ? "overlap" : "overlaps"}</Badge> : null}
            <div className="ml-auto">
              <Tabs value={view} onValueChange={(v) => { setSelected(null); setView(v as CalView) }} variant="segmented">
                <TabsList aria-label="Calendar view">
                  <TabsTrigger value="day">Day</TabsTrigger>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {error ? (
            <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-border bg-danger-muted px-4 py-2 text-sm text-danger">
              <span className="min-w-0 flex-1 truncate">Could not load events: {error}</span>
              <Button variant="secondary" size="sm" onClick={refetch}>Retry</Button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            {view === "month" ? (
              <MonthView year={monthYear} month={monthMonth} events={visibleEvents} today={today} onSelect={setSelected} onOpenDay={openDay} />
            ) : (
              <TimeGrid
                days={view === "week" ? weekDays : [dayView]}
                events={visibleEvents}
                now={now}
                selected={selected?.id ?? null}
                onSelect={setSelected}
              />
            )}
          </div>
        </section>

        <aside aria-label="Calendar sidebar" className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
          <Panel>
            <MiniMonth
              year={miniDate.getFullYear()}
              month={miniDate.getMonth()}
              rangeStart={fetchStart}
              rangeEnd={viewRangeEnd}
              today={today}
              onNavigate={(delta) => setMiniOffset((offset) => offset + delta)}
              onSelectDate={openDay}
            />
          </Panel>

          <Panel title="Upcoming" description="Next events in this view." flush>
            {loading && calEvents.length === 0 ? (
              <div className="flex justify-center py-6"><Spinner size="sm" /></div>
            ) : upcoming.length === 0 ? (
              <EmptyState size="compact" title="Nothing coming up" description="Move forward a week, or schedule a mission." />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {upcoming.map((ev) => (
                  <li key={ev.id}>
                    <button type="button" onClick={() => setSelected(ev)} className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-hover">
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: KIND[ev.kind].tone }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{ev.title}</span>
                        <span className="block font-mono text-2xs text-muted tabular-nums">
                          {sameDay(ev.date, today) ? "Today" : ev.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                          {" "}{ev.allDay ? "All day" : fmtTime(ev.startH, ev.startM)}
                        </span>
                      </span>
                      {ev.status === "running" ? <StatusDot tone="running" className="mt-1.5" label="Running" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Show"
            actions={(
              <IconButton aria-label={addCatOpen ? "Cancel new category" : "Add category"} size="sm" onClick={() => setAddCatOpen((v) => !v)}>
                {addCatOpen ? <X /> : <Plus />}
              </IconButton>
            )}
          >
            <div className="flex flex-col gap-2">
              {KINDS.map((kind) => {
                const count = calEvents.filter((e) => e.kind === kind).length
                return (
                  <div key={kind} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={filters[kind]}
                        onCheckedChange={() => setFilters((f) => ({ ...f, [kind]: !f[kind] }))}
                        label={(
                          <span className="flex items-center gap-2">
                            <span aria-hidden className="size-2 rounded-full" style={{ background: KIND[kind].tone }} />
                            {KIND[kind].label}
                          </span>
                        )}
                      />
                      <span className="ml-auto font-mono text-2xs text-faint tabular-nums">{count}</span>
                    </div>
                    {kind === "personal" ? (
                      <p className="pl-6 text-2xs text-muted">
                        {gcalConnected ? "Google Calendar connected" : (
                          <>Google Calendar not connected. <Link href="/integrations?setup=gmail-calendar" className="text-accent-text hover:underline">Connect it</Link></>
                        )}
                      </p>
                    ) : null}
                  </div>
                )
              })}

              {customCategories.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1 border-t border-border-subtle pt-2">
                  {customCategories.map((cat) => (
                    <li key={cat.id} className="group flex items-center gap-2">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: cat.color }} />
                      <span className="flex-1 truncate text-sm text-fg">{cat.label}</span>
                      <IconButton aria-label={`Remove category ${cat.label}`} size="sm" onClick={() => handleRemoveCategory(cat.id)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                        <X />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}

              {addCatOpen ? (
                <div className="mt-1 flex flex-col gap-2 border-t border-border-subtle pt-3">
                  <Input
                    size="sm"
                    value={newCatLabel}
                    onChange={(e) => setNewCatLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddCategory() }}
                    placeholder="Category name"
                    aria-label="Category name"
                    data-autofocus
                  />
                  <div role="radiogroup" aria-label="Category colour" className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={newCatColor === c}
                        aria-label={c}
                        onClick={() => setNewCatColor(c)}
                        className={cn("size-4 rounded-full", newCatColor === c && "ring-2 ring-ring ring-offset-2 ring-offset-surface")}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <Button size="sm" variant="secondary" onClick={handleAddCategory} disabled={!newCatLabel.trim()} className="self-start">
                    Add category
                  </Button>
                </div>
              ) : null}
            </div>
          </Panel>
        </aside>
      </div>

      <EventDialog
        ev={selected}
        onClose={() => setSelected(null)}
        onReschedule={reschedule}
        onRemoveOverride={removeOverride}
        onDelete={handleDeleteMission}
        onPublishCalendarEvent={publishCalendarEvent}
      />
    </PageContainer>
  )
}
