"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Clock, X, ExternalLink, Settings } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import type { CalendarEvent, PersonalCalendarEvent } from "@/lib/calendar/types"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"

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

const KIND_COLORS: Record<string, string> = {
  mission:  "#22D3EE",
  agent:    "#A78BFA",
  personal: "#F59E0B",
}

const DAY_START = 0
const DAY_END = 24

function fmtTime(h: number, m = 0) {
  const period = h < 12 ? "AM" : "PM"
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h
  const mm = m > 0 ? `:${String(m).padStart(2, "0")}` : ""
  return `${hh}${mm} ${period}`
}

function fmtHourLabel(h: number) {
  const period = h < 12 ? "AM" : "PM"
  const hh = h % 12 === 0 ? 12 : h % 12
  const padded = hh < 10 ? `\u00A0${hh}` : `${hh}`
  return `${padded} ${period}`
}

function apiToBriefing(ev: CalendarEvent): BriefingEvent | null {
  const start = new Date(ev.startAt)
  const end   = new Date(ev.endAt)
  const durMs = end.getTime() - start.getTime()
  const personal = ev.kind === "personal" ? (ev as PersonalCalendarEvent) : null
  const allDay   = personal?.provider === "gcalendar" && durMs >= 20 * 60 * 60 * 1000

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
    color:    KIND_COLORS[ev.kind] ?? "#94A3B8",
    allDay,
    htmlLink: personal?.htmlLink,
    provider: personal?.provider,
  }
}

export function ScheduleBriefing({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  sectionRef,
  onOpenCalendar,
}: ScheduleBriefingProps) {
  const [events, setEvents]     = useState<CalendarEvent[]>(() => {
    const cached = readShellUiCache().dailyScheduleEvents
    return Array.isArray(cached) ? (cached as CalendarEvent[]) : []
  })
  const [loading, setLoading]   = useState(() => {
    const cached = readShellUiCache().dailyScheduleEvents
    return !Array.isArray(cached) || cached.length === 0
  })
  const [selected, setSelected] = useState<BriefingEvent | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const syncViewport = () => setViewportHeight(window.innerHeight || 0)
    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [])

  useEffect(() => {
    const now   = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })

    fetch(`/api/calendar/events?${params}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const nextEvents = Array.isArray(data.events) ? (data.events as CalendarEvent[]) : []
          setEvents(nextEvents)
          writeShellUiCache({ dailyScheduleEvents: nextEvents })
          return
        }
        const cached = readShellUiCache().dailyScheduleEvents
        if (Array.isArray(cached)) {
          setEvents(cached as CalendarEvent[])
          return
        }
        setEvents([])
      })
      .catch(() => {
        const cached = readShellUiCache().dailyScheduleEvents
        if (Array.isArray(cached)) {
          setEvents(cached as CalendarEvent[])
          return
        }
        setEvents([])
      })
      .finally(() => setLoading(false))
  }, [])

  const briefingEvents = useMemo(() => {
    const mapped = events.map(apiToBriefing).filter((e): e is BriefingEvent => e !== null)
    return Array.from(new Map(mapped.map((e) => [e.id, e])).values())
      .sort((a, b) => a.startH * 60 + a.startM - (b.startH * 60 + b.startM))
  }, [events])

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

  return (
    <>
      <section ref={sectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 min-h-0 flex-1 flex flex-col`}>
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
          <div className="h-7 w-7" aria-hidden="true" />
          <h2 className={cn("min-w-0 text-center text-sm uppercase tracking-[0.16em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
            Daily Schedule
          </h2>
          <button
            onClick={onOpenCalendar}
            className={cn("h-7 w-7 justify-self-end rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/sched-cal", subPanelClass)}
            aria-label="Open calendar"
          >
            <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/sched-cal:text-accent group-hover/sched-cal:rotate-90 transition-transform duration-200" />
          </button>
        </div>
        <p className={cn("text-[13px] mt-1 text-center", isLight ? "text-s-60" : "text-slate-300")}>
          {now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </p>

        <div
          className="module-hover-scroll mt-2.5 min-h-0 flex-1 overflow-y-auto"
          ref={(el) => {
            if (el && isInRange) {
              const scrollTo = Math.max(0, nowTop - el.clientHeight * 0.35)
              el.scrollTop = scrollTo
            }
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-1.5 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-1 h-1 rounded-full bg-accent/40" style={{ animation: `calDot 1.4s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
              <style>{`@keyframes calDot { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
            </div>
          ) : (
            <div className="w-full">
              <div className="relative" style={{ height: totalHeight }}>
              {/* Hour lines + labels */}
              {hours.map((h, idx) => (
                <div key={h} className="absolute left-0 right-0" style={{ top: timelineTopInset + idx * pxPerHour }}>
                  <div className="flex h-[1px] items-center">
                    <span className={cn("text-[10px] font-mono -ml-2 shrink-0 text-left leading-none", isLight ? "text-s-50" : "text-slate-400")}>
                      {fmtHourLabel(h)}
                    </span>
                    <div className={cn("flex-1 border-t -mt-px", isLight ? "border-[#c9d7ea]" : "border-white/18")} />
                  </div>
                </div>
              ))}

              {/* Now indicator */}
              {isInRange && (
                <div className="absolute left-8 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                  <div className="relative h-px bg-accent">
                    <div className="absolute right-[0px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent" />
                  </div>
                </div>
              )}

              {/* Event bars */}
              {briefingEvents.map((ev) => {
                const top = evTop(ev.startH, ev.startM)
                const ht  = evHeight(ev.durMin)
                return (
                  <button
                    key={ev.id}
                    onClick={() => setSelected(ev)}
                    className="absolute left-11 right-0.5 rounded-[3px] text-left overflow-hidden transition-all hover:brightness-110 group/ev"
                    style={{
                      top,
                      height: ht,
                      background: `${ev.color}18`,
                      borderLeft: `2px solid ${ev.color}`,
                    }}
                  >
                    <div className="px-1.5 py-0.5 flex items-center gap-1.5 min-w-0">
                      {ht > 18 && (
                        <span className="text-[9px] font-mono shrink-0" style={{ color: `${ev.color}AA` }}>
                          {ev.allDay ? "All Day" : fmtTime(ev.startH, ev.startM)}
                        </span>
                      )}
                      <span
                        className="text-[10px] font-medium truncate leading-tight"
                        style={{ color: isLight ? "#334155" : "#E2E8F0" }}
                      >
                        {ev.title}
                      </span>
                    </div>
                  </button>
                )
              })}
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
