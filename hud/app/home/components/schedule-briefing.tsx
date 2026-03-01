"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Clock, X, ExternalLink, Settings } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { CalendarEvent, PersonalCalendarEvent } from "@/lib/calendar/types"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { useAccent } from "@/lib/context/accent-context"
import { ACCENT_COLORS } from "@/lib/settings/userSettings"

interface ScheduleBriefingProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle?: React.CSSProperties
  sectionRef?: React.RefObject<HTMLElement | null>
  onOpenCalendar: () => void
}

interface BriefingEvent {
  id: string
  title: string
  subtitle?: string
  startH: number
  startM: number
  endH: number
  endM: number
  durMin: number
  kind: string
  status: string
  color: string
  allDay?: boolean
  htmlLink?: string
  provider?: string
}

type ScheduleMemoryState = {
  dayKey: string
  events: CalendarEvent[]
  fetchedAt: number
  hydrated: boolean
}

const KIND_COLORS_BASE: Record<string, string> = {
  agent:    "#A78BFA",
  personal: "#F59E0B",
}

const DAY_START = 0
const DAY_END = 24
let scheduleMemoryState: ScheduleMemoryState | null = null
let scheduleFetchInFlight: Promise<CalendarEvent[] | null> | null = null

function fmtTime(h: number, m = 0) {
  const period = h < 12 ? "AM" : "PM"
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h
  const mm = m > 0 ? `:${String(m).padStart(2, "0")}` : ""
  return `${hh}${mm} ${period}`
}

function fmtShort(h: number, m = 0) {
  const period = h < 12 ? "a" : "p"
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h
  const mm = m > 0 ? `:${String(m).padStart(2, "0")}` : ""
  return `${hh}${mm}${period}`
}

function apiToBriefing(ev: CalendarEvent, missionColor: string): BriefingEvent | null {
  const start = new Date(ev.startAt)
  const end   = new Date(ev.endAt)
  const durMs = end.getTime() - start.getTime()
  const personal = ev.kind === "personal" ? (ev as PersonalCalendarEvent) : null
  const allDay   = personal?.provider === "gcalendar" && durMs >= 20 * 60 * 60 * 1000
  const kindColors: Record<string, string> = { ...KIND_COLORS_BASE, mission: missionColor }

  return {
    id:       ev.id,
    title:    ev.title,
    subtitle: ev.subtitle,
    startH:   allDay ? DAY_START : start.getHours(),
    startM:   allDay ? 0 : start.getMinutes(),
    endH:     allDay ? DAY_END : end.getHours(),
    endM:     allDay ? 0 : end.getMinutes(),
    durMin:   allDay ? 60 : Math.max(Math.round(durMs / 60000), 15),
    kind:     ev.kind,
    status:   ev.status,
    color:    kindColors[ev.kind] ?? "#94A3B8",
    allDay,
    htmlLink: personal?.htmlLink,
    provider: personal?.provider,
  }
}

// ─── Event Overlap Layout ─────────────────────────────────────────────────────

/** Same 50/50-split algorithm as the calendar page, but typed for BriefingEvent. */
function computeBriefingLayout(events: BriefingEvent[]): Map<string, { col: number; numCols: number }> {
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
    const end   = start + ev.durMin
    let placed  = false
    for (let i = 0; i < colEnds.length; i++) {
      if (colEnds[i] <= start) {
        assignment.set(ev.id, i)
        colEnds[i] = end
        placed = true
        break
      }
    }
    if (!placed) {
      assignment.set(ev.id, colEnds.length)
      colEnds.push(end)
    }
  }

  const result = new Map<string, { col: number; numCols: number }>()
  for (const ev of sorted) {
    const evStart = ev.startH * 60 + ev.startM
    const evEnd   = evStart + ev.durMin
    const col     = assignment.get(ev.id) ?? 0
    let maxCol    = col

    for (const other of sorted) {
      if (other.id === ev.id) continue
      const oStart = other.startH * 60 + other.startM
      const oEnd   = oStart + other.durMin
      if (evStart < oEnd && oStart < evEnd) {
        const oCol = assignment.get(other.id) ?? 0
        if (oCol > maxCol) maxCol = oCol
      }
    }
    result.set(ev.id, { col, numCols: maxCol + 1 })
  }
  return result
}

function toLocalDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isEventOnDay(event: CalendarEvent, dayKey: string): boolean {
  const start = new Date(event.startAt)
  const end = new Date(event.endAt)
  return toLocalDayKey(start) === dayKey || toLocalDayKey(end) === dayKey
}

function readCachedEventsForDay(dayKey: string): CalendarEvent[] {
  const cached = readShellUiCache().dailyScheduleEvents
  if (!Array.isArray(cached) || cached.length === 0) return []
  return (cached as CalendarEvent[]).filter((event) => isEventOnDay(event, dayKey))
}

function setScheduleMemory(dayKey: string, events: CalendarEvent[]): void {
  scheduleMemoryState = {
    dayKey,
    events: [...events],
    fetchedAt: Date.now(),
    hydrated: true,
  }
}

async function fetchScheduleEventsForDay(dayKey: string): Promise<CalendarEvent[] | null> {
  if (scheduleFetchInFlight) return scheduleFetchInFlight
  const [year, month, day] = dayKey.split("-").map((value) => Number(value))
  const start = new Date(year, month - 1, day, 0, 0, 0, 0)
  const end = new Date(year, month - 1, day, 23, 59, 59, 999)
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })

  scheduleFetchInFlight = fetch(`/api/calendar/events?${params}`, { credentials: "include", cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      if (!data?.ok) return null
      const nextEvents = Array.isArray(data.events) ? (data.events as CalendarEvent[]) : []
      writeShellUiCache({ dailyScheduleEvents: nextEvents })
      setScheduleMemory(dayKey, nextEvents)
      return nextEvents
    })
    .catch(() => null)
    .finally(() => {
      scheduleFetchInFlight = null
    })

  return scheduleFetchInFlight
}

export function ScheduleBriefing({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  sectionRef,
  onOpenCalendar,
}: ScheduleBriefingProps) {
  const { accentColor } = useAccent()
  const missionColor = ACCENT_COLORS[accentColor]?.primary ?? "#8b5cf6"
  const dayKey = toLocalDayKey(new Date())
  const initialMemory = scheduleMemoryState?.dayKey === dayKey ? scheduleMemoryState : null
  const hasInitialMemory = Boolean(initialMemory)
  // Use persisted cache only as a fallback on fetch failure.
  // Rendering persisted daily cache first can show stale mission times that "jump"
  // when fresh data arrives from /api/calendar/events.
  const persistedFallback = useMemo(
    () => (hasInitialMemory ? [] : readCachedEventsForDay(dayKey)),
    [dayKey, hasInitialMemory],
  )
  const [events, setEvents] = useState<CalendarEvent[]>(() => (initialMemory ? initialMemory.events : []))
  const [loading, setLoading] = useState(() => !hasInitialMemory)
  const [selected, setSelected] = useState<BriefingEvent | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const syncViewport = () => setViewportHeight(window.innerHeight || 0)
    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [])

  useEffect(() => {
    let cancelled = false

    void fetchScheduleEventsForDay(dayKey)
      .then((nextEvents) => {
        if (cancelled) return
        if (nextEvents) {
          setEvents(nextEvents)
          return
        }
        if (!hasInitialMemory && persistedFallback.length > 0) {
          setEvents(persistedFallback)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dayKey, hasInitialMemory, persistedFallback])

  const briefingEvents = useMemo(() => {
    const mapped = events.map((e) => apiToBriefing(e, missionColor)).filter((e): e is BriefingEvent => e !== null)
    return Array.from(new Map(mapped.map((e) => [e.id, e])).values())
      .sort((a, b) => a.startH * 60 + a.startM - (b.startH * 60 + b.startM))
  }, [events, missionColor])

  const hours = useMemo(
    () => Array.from({ length: DAY_END - DAY_START }, (_, i) => i + DAY_START),
    [],
  )

  const pxPerHour = useMemo(() => {
    if (!viewportHeight) return 30
    return Math.max(22, Math.min(40, Math.round(viewportHeight / 28)))
  }, [viewportHeight])
  const timelineTopInset = 10
  const totalHeight = hours.length * pxPerHour + timelineTopInset

  const evTop = useCallback(
    (h: number, m: number) => timelineTopInset + ((h - DAY_START) + m / 60) * pxPerHour,
    [pxPerHour, timelineTopInset],
  )
  const evHeight = useCallback(
    (min: number) => Math.max((min / 60) * pxPerHour, 14),
    [pxPerHour],
  )

  const now = new Date()
  const nowTop = evTop(now.getHours(), now.getMinutes())
  const isInRange = now.getHours() >= DAY_START && now.getHours() < DAY_END
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  const timelineAnchorTop = (() => {
    if (briefingEvents.length === 0) return nowTop
    const nextEvent = briefingEvents.find((event) => {
      const start = event.startH * 60 + event.startM
      const end = start + event.durMin
      return end >= nowMinute
    })
    const anchor = nextEvent || briefingEvents[0]
    return evTop(anchor.startH, anchor.startM)
  })()

  useEffect(() => {
    const container = timelineRef.current
    if (!container) return
    if (loading) return
    const scrollTo = Math.max(0, timelineAnchorTop - container.clientHeight * 0.25)
    container.scrollTop = scrollTo
  }, [timelineAnchorTop, loading])

  return (
    <>
      <section ref={sectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 min-h-0 flex-1 flex flex-col`}>
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
          <div className="h-8 w-8" aria-hidden="true" />
          <h2 className={cn("min-w-0 text-center text-sm uppercase tracking-[0.16em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
            Daily Schedule
          </h2>
          <button
            onClick={onOpenCalendar}
            className={cn("h-8 w-8 justify-self-end rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/sched-cal", subPanelClass)}
            aria-label="Open calendar"
          >
            <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/sched-cal:text-accent group-hover/sched-cal:rotate-90 transition-transform duration-200" />
          </button>
        </div>
        <p className={cn("text-[13px] mt-1 text-center", isLight ? "text-s-60" : "text-slate-300")}>
          {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </p>

        <div
          className="module-hover-scroll no-scrollbar mt-2.5 min-h-0 flex-1 overflow-y-auto"
          ref={timelineRef}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-1.5 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1 h-1 rounded-full bg-accent/40" style={{ animation: `calDot 1.4s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
              <style>{`@keyframes calDot { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
            </div>
          ) : (
            <div className="grid w-full" style={{ gridTemplateColumns: "1.5rem 1fr", columnGap: 4 }}>

              {/* ── Time label column ── */}
              <div className="relative shrink-0" style={{ height: totalHeight }}>
                {hours.map((h, idx) => {
                  const period = h < 12 ? "AM" : "PM"
                  const hh     = h % 12 === 0 ? 12 : h % 12
                  return (
                    <div
                      key={h}
                      className={cn(
                        "absolute flex items-baseline gap-0.5 -translate-y-1/2",
                        isLight ? "text-s-50" : "text-slate-400",
                      )}
                      style={{ top: timelineTopInset + idx * pxPerHour, right: 0 }}
                    >
                      <span className="text-[11px] font-mono leading-none">{hh}</span>
                      <span className="text-[9px] font-mono leading-none">{period}</span>
                    </div>
                  )
                })}
              </div>

              {/* ── Grid lines + now indicator + events ── */}
              <div className="relative" style={{ height: totalHeight }}>
                {/* Hour grid lines — flush left, touching the labels */}
                {hours.map((h, idx) => (
                  <div
                    key={h}
                    className={cn("absolute left-0 right-0 border-t", isLight ? "border-[#c9d7ea]" : "border-white/18")}
                    style={{ top: timelineTopInset + idx * pxPerHour }}
                  />
                ))}

                {/* Now indicator */}
                {isInRange && (
                  <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                    <div className="relative h-px bg-accent">
                      <div className="absolute right-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent" />
                    </div>
                  </div>
                )}

                {/* Event bars */}
                {(() => {
                  const layout = computeBriefingLayout(briefingEvents)
                  return briefingEvents.map((ev) => {
                    const top = evTop(ev.startH, ev.startM)
                    const ht  = evHeight(ev.durMin)
                    const { col, numCols } = layout.get(ev.id) ?? { col: 0, numCols: 1 }
                    const gapRight = col < numCols - 1 ? 2 : 0
                    return (
                      <button
                        key={ev.id}
                        onClick={() => setSelected(ev)}
                        className="absolute text-left overflow-hidden transition-all hover:brightness-110 active:scale-[0.99]"
                        style={{
                          top,
                          height: ht,
                          left:        `${((col / numCols) * 100).toFixed(2)}%`,
                          width:       `${(100 / numCols).toFixed(2)}%`,
                          paddingRight: gapRight,
                          borderRadius: 4,
                          background:  isLight ? `${ev.color}18` : `${ev.color}22`,
                          borderTop:    `1px solid ${ev.color}30`,
                          borderRight:  `1px solid ${ev.color}30`,
                          borderBottom: `1px solid ${ev.color}30`,
                          borderLeft:   `3px solid ${ev.color}`,
                        }}
                      >
                        {ht >= 30 ? (
                          /* Tall: time range on top, title below */
                          <div className="flex flex-col justify-center h-full px-1.5 py-1 gap-0.5">
                            <span
                              className="text-[8px] font-mono leading-none shrink-0 truncate"
                              style={{ color: ev.color }}
                            >
                              {ev.allDay ? "All Day" : `${fmtShort(ev.startH, ev.startM)} – ${fmtShort(ev.endH, ev.endM)}`}
                            </span>
                            <span
                              className="text-[10px] font-semibold leading-tight truncate"
                              style={{ color: isLight ? "#1e293b" : "#ffffff" }}
                            >
                              {ev.title}
                            </span>
                          </div>
                        ) : ht >= 16 ? (
                          /* Compact: time + title inline */
                          <div className="flex items-center gap-1 h-full px-1.5 min-w-0">
                            <span
                              className="text-[8px] font-mono leading-none shrink-0"
                              style={{ color: ev.color }}
                            >
                              {ev.allDay ? "·" : fmtShort(ev.startH, ev.startM)}
                            </span>
                            <span
                              className="text-[9px] font-semibold leading-none truncate"
                              style={{ color: isLight ? "#1e293b" : "#ffffff" }}
                            >
                              {ev.title}
                            </span>
                          </div>
                        ) : (
                          /* Tiny: just title */
                          <div className="flex items-center h-full px-1.5 min-w-0">
                            <span
                              className="text-[9px] font-semibold leading-none truncate"
                              style={{ color: isLight ? "#1e293b" : "#ffffff" }}
                            >
                              {ev.title}
                            </span>
                          </div>
                        )}
                      </button>
                    )
                  })
                })()}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Detail popup */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className={cn(
              "relative z-10 w-72 rounded-2xl border shadow-2xl",
              isLight
                ? "border-[#d9e0ea] bg-white"
                : "border-white/12 bg-white/6 backdrop-blur-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-[9px] font-mono uppercase tracking-[0.14em] px-2 py-1 rounded-md border"
                  style={{ color: selected.color, background: `${selected.color}12`, borderColor: `${selected.color}28` }}
                >
                  {selected.kind}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  className="h-6 w-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <h3 className={cn("text-base font-semibold mb-1 leading-snug", isLight ? "text-s-90" : "text-white")}>{selected.title}</h3>
              {selected.subtitle && <p className={cn("text-[11px] font-mono mb-3", isLight ? "text-s-50" : "text-slate-400")}>{selected.subtitle}</p>}

              <div className="space-y-2 mb-3">
                <div className={cn("flex items-center gap-2 text-[12px]", isLight ? "text-s-70" : "text-slate-300")}>
                  <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  <span>
                    {selected.allDay
                      ? "All Day"
                      : `${fmtTime(selected.startH, selected.startM)} — ${fmtTime(selected.endH, selected.endM)}`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selected.status === "running" ? "bg-emerald-400 animate-pulse"
                    : selected.status === "completed" ? "bg-slate-600"
                    : selected.status === "failed" ? "bg-red-400"
                    : "bg-slate-500",
                  )}
                />
                <span className={cn("text-[10px] font-mono uppercase tracking-widest", isLight ? "text-s-50" : "text-slate-400")}>
                  {selected.status}
                </span>
              </div>

              {selected.kind === "personal" && selected.provider === "gcalendar" && selected.htmlLink?.startsWith("https://") && (
                <a
                  href={selected.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 h-8 rounded-lg text-[11px] font-medium font-mono border transition-colors"
                  style={{
                    color: selected.color,
                    background: `${selected.color}10`,
                    borderColor: `${selected.color}28`,
                  }}
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>OPEN IN GOOGLE CALENDAR</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
