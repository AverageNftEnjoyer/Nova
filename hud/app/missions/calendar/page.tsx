"use client"

/**
 * Missions Calendar Hub — Nova OS aesthetic rebuild
 * Matches Nova OS: frosted glass, spotlight effects, space background
 * Layout: mini month picker sidebar + week/month/day views + detail modal
 */

import { useState, useMemo, useCallback, useEffect, useRef, createContext, useContext } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Settings, Plus, X, Clock, CalendarDays, Layers, User, Trash2 } from "lucide-react"
import Link from "next/link"

import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { ORB_COLORS, ACCENT_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor } from "@/lib/settings/userSettings"
import { useAccent } from "@/lib/context/accent-context"
import { hexToRgba } from "@/app/integrations/constants"
import { SettingsModal } from "@/components/settings/settings-modal"
import { useSpotlightEffect } from "@/app/integrations/hooks/useSpotlightEffect"
import { useCalendarEvents } from "@/lib/calendar/useCalendarEvents"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/store/client-store"
import { formatCompactModelLabelFromIntegrations } from "@/lib/integrations/llm/model-label"
import { loadCalendarCategories, addCalendarCategory, removeCalendarCategory, PRESET_COLORS, type CalendarCategory } from "@/lib/calendar/category-store"
import type { CalendarEvent, PersonalCalendarEvent } from "@/lib/calendar/types"

// ─── Mission color context (accent-driven, replaces hardcoded cyan) ──────────

const MissionColorCtx = createContext("#8b5cf6")
function useMissionColor() { return useContext(MissionColorCtx) }

// ─── Types ────────────────────────────────────────────────────────────────────

type EventKind   = "personal" | "mission" | "agent"
type EventStatus = "scheduled" | "running" | "completed" | "failed" | "draft"
type CalView     = "week" | "month" | "day"

interface CalEvent {
  id:          string
  kind:        EventKind
  title:       string
  sub?:        string
  date:        Date
  startH:      number
  startM:      number
  durMin:      number
  status:      EventStatus
  missionId?:  string
  nodeCount?:  number
  conflict?:   boolean
  allDay?:     boolean
  // personal event extras
  provider?:   "manual" | "gcalendar"
  externalId?: string
  htmlLink?:   string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_START = 0
const GRID_END   = 24
const PX_HR      = 64
const HOURS      = Array.from({ length: GRID_END - GRID_START }, (_, i) => i + GRID_START)
const DAY_ABBR   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_NAMES  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS     = ["January","February","March","April","May","June","July","August","September","October","November","December"]

const CAT: Record<EventKind, { label: string; color: string; bgClass: string; dotClass: string }> = {
  mission:  { label: "Agent Missions", color: "#8b5cf6", bgClass: "bg-violet-500/20 border-violet-500/40", dotClass: "bg-violet-500" },
  agent:    { label: "Agent Tasks",    color: "#A78BFA", bgClass: "bg-violet-400/20 border-violet-400/40", dotClass: "bg-violet-400" },
  personal: { label: "Personal",       color: "#F59E0B", bgClass: "bg-amber-400/20  border-amber-400/40",  dotClass: "bg-amber-400"  },
}

/** Get the live CAT entry for a kind, using the accent color for missions. */
function useCatEntry(kind: EventKind) {
  const missionColor = useMissionColor()
  if (kind !== "mission") return CAT[kind]
  return { ...CAT.mission, color: missionColor }
}

const STATUS_DOT: Record<EventStatus, string> = {
  scheduled: "bg-slate-500",
  running:   "bg-emerald-400 animate-pulse",
  completed: "bg-slate-600",
  failed:    "bg-red-400",
  draft:     "bg-slate-600",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(d: Date): Date {
  const date = new Date(d)
  date.setDate(date.getDate() - date.getDay())
  date.setHours(0, 0, 0, 0)
  return date
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate()  === b.getDate()
}

function fmtTime(h: number, m = 0) {
  const period = h < 12 ? "AM" : "PM"
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h
  const mm = m > 0 ? `:${String(m).padStart(2, "0")}` : ""
  return `${hh}${mm} ${period}`
}

function fmtDur(min: number) {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtFullDate(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function evTop(h: number, m: number) { return ((h - GRID_START) + m / 60) * PX_HR }
function evHt(min: number)           { return Math.max((min / 60) * PX_HR, 22) }

// ─── Event Overlap Layout ─────────────────────────────────────────────────────

/** Computes column assignments for overlapping events in a single day column.
 *  Returns Map<eventId, { col, numCols }> where col is the zero-based column
 *  index and numCols is the total columns in the overlap group, so each event
 *  renders at width 1/numCols and left offset col/numCols — producing the
 *  standard 50/50 Google-Calendar-style split for simultaneous events.
 */
function computeEventLayout(events: CalEvent[]): Map<string, { col: number; numCols: number }> {
  if (!events.length) return new Map()

  // Sort by start time ascending; ties: longer event gets the lower column
  const sorted = [...events].sort((a, b) => {
    const aStart = a.startH * 60 + a.startM
    const bStart = b.startH * 60 + b.startM
    if (aStart !== bStart) return aStart - bStart
    return (b.startH * 60 + b.startM + b.durMin) - (a.startH * 60 + a.startM + a.durMin)
  })

  // Greedy column assignment: place each event in the first non-overlapping column
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

  // numCols = (max col index of any event overlapping this one) + 1
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

/** Returns an array of Date cells for a mini-calendar (Sun-start, fills out to 6×7). */
function getMiniCells(year: number, month: number): Date[] {
  const firstDow     = new Date(year, month, 1).getDay()
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const total        = Math.ceil((firstDow + daysInMonth) / 7) * 7
  return Array.from({ length: total }, (_, i) => new Date(year, month, 1 - firstDow + i))
}

function apiEventToCalEvent(ev: CalendarEvent): CalEvent | null {
  const start    = new Date(ev.startAt)
  const end      = new Date(ev.endAt)
  const personal = ev.kind === "personal" ? (ev as PersonalCalendarEvent) : null

  // All-day events have a duration >= 20 hours and are from a personal gcalendar source
  const durMs  = end.getTime() - start.getTime()
  const allDay = personal?.provider === "gcalendar" && durMs >= 20 * 60 * 60 * 1000

  // Clamp all-day events to the grid start so they appear at the top instead of off-screen
  const rawH   = start.getHours()
  const startH = allDay ? GRID_START : Math.max(rawH, 0)
  const startM = allDay ? 0 : start.getMinutes()
  // All-day events get a fixed 60-min pill so they're visible but not huge
  const durMin = allDay ? 60 : Math.max(Math.round(durMs / 60000), 15)

  return {
    id:         ev.id,
    kind:       ev.kind as EventKind,
    title:      ev.title,
    sub:        ev.subtitle,
    date:       start,
    startH,
    startM,
    durMin,
    status:     ev.status as EventStatus,
    missionId:  ev.kind === "mission" ? ev.missionId : undefined,
    nodeCount:  ev.kind === "mission" ? ev.nodeCount : undefined,
    conflict:   ev.kind === "mission" ? ev.conflict  : undefined,
    allDay,
    provider:   personal?.provider,
    externalId: personal?.externalId,
    htmlLink:   personal?.htmlLink,
  }
}

// ─── Event Pill (week/day view) ───────────────────────────────────────────────

function EventPill({ ev, active, onClick, col = 0, numCols = 1, onDelete }: {
  ev: CalEvent; active: boolean; onClick: () => void
  col?: number; numCols?: number; onDelete?: () => void
}) {
  const cat      = useCatEntry(ev.kind)
  const top      = evTop(ev.startH, ev.startM)
  const ht       = evHt(ev.durMin)
  const running  = ev.status === "running"
  const done     = ev.status === "completed"
  const rightGap = col < numCols - 1 ? 2 : 0

  return (
    <div
      className={cn(
        "absolute group",
        active ? "z-10" : "z-[1]",
      )}
      style={{
        top,
        height: ht,
        left:  `${((col / numCols) * 100).toFixed(2)}%`,
        width: `${(100 / numCols).toFixed(2)}%`,
      }}
    >
      {/* Main clickable pill */}
      <button
        onClick={onClick}
        className="absolute inset-0 text-left overflow-hidden transition-all duration-100 rounded-[3px]"
        style={{
          right: rightGap,
          background: active
            ? cat.color
            : done
            ? `${cat.color}55`
            : `${cat.color}CC`,
        }}
      >
        {/* Running shimmer */}
        {running && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)`,
              backgroundSize: "200% 100%",
              animation: "calShimmer 2.4s linear infinite",
            }}
          />
        )}
        <div className="px-1.5" style={{ paddingTop: ht < 28 ? 2 : 4, paddingBottom: ht < 28 ? 2 : 4 }}>
          {ht > 28 && (
            <div
              className="text-[9px] font-mono mb-0.5 truncate"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              {ev.allDay ? "All Day" : fmtTime(ev.startH, ev.startM)}
            </div>
          )}
          <div
            className="font-semibold truncate"
            style={{
              fontSize: ht < 32 ? 9 : 11,
              lineHeight: "1.25",
              color: done ? "rgba(255,255,255,0.45)" : "#ffffff",
            }}
          >
            {ev.title}
          </div>
          {ht > 50 && ev.sub && (
            <div
              className="truncate mt-0.5"
              style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}
            >
              {ev.sub}
            </div>
          )}
        </div>
        {ev.conflict && (
          <div className="absolute top-0.5 right-1 text-[7px] font-mono text-white/70">⚠</div>
        )}
      </button>

      {/* Delete button — hover-visible, only for deletable events */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute bottom-0.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4 rounded flex items-center justify-center bg-black/40 hover:bg-red-500/80"
          style={{ right: rightGap + 2 }}
          title="Delete mission"
        >
          <Trash2 className="w-2.5 h-2.5 text-white" />
        </button>
      )}
    </div>
  )
}

// ─── Month event chip ─────────────────────────────────────────────────────────

function MonthChip({ ev, onClick }: { ev: CalEvent; onClick: () => void }) {
  const cat = useCatEntry(ev.kind)
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-sm px-1.5 py-0.5 mb-0.5 text-[9.5px] font-medium truncate border transition-opacity hover:opacity-90"
      style={{
        background: `${cat.color}18`,
        borderColor: `${cat.color}30`,
        color: cat.color,
      }}
    >
      {ev.title}
    </button>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({
  ev,
  onClose,
  isLight,
  onReschedule,
  onRemoveOverride,
  onDelete,
}: {
  ev: CalEvent
  onClose: () => void
  isLight: boolean
  onReschedule: (missionId: string, newStartAt: string) => Promise<{ ok: boolean; conflict: boolean; error?: string }>
  onRemoveOverride: (missionId: string) => Promise<{ ok: boolean; error?: string }>
  onDelete?: (ev: CalEvent) => void
}) {
  const cat  = useCatEntry(ev.kind)
  const endH = ev.startH + Math.floor((ev.startM + ev.durMin) / 60)
  const endM = (ev.startM + ev.durMin) % 60

  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [pickerDate,     setPickerDate]     = useState(() => ev.date.toISOString().slice(0, 10))
  const [pickerTime,     setPickerTime]     = useState(() => {
    const h = String(ev.startH).padStart(2, "0")
    const m = String(ev.startM).padStart(2, "0")
    return `${h}:${m}`
  })
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict,  setConflict]  = useState(false)

  const isOverrideEvent = ev.id.endsWith("::override")

  async function handleReschedule() {
    if (!ev.missionId) return
    const proposed = new Date(`${pickerDate}T${pickerTime}:00`)
    if (isNaN(proposed.getTime())) {
      setSaveError("Invalid date or time.")
      return
    }
    if (proposed.getTime() < Date.now() - 10 * 60 * 1000) {
      setSaveError("Cannot reschedule to a past time.")
      return
    }
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    const iso = proposed.toISOString()
    const result = await onReschedule(ev.missionId, iso)
    setSaving(false)
    if (result.ok) {
      if (result.conflict) {
        setConflict(true)
      } else {
        onClose()
      }
    } else {
      setSaveError(result.error ?? "Failed to reschedule.")
    }
  }

  async function handleRemoveOverride() {
    if (!ev.missionId) return
    setSaving(true)
    const result = await onRemoveOverride(ev.missionId)
    setSaving(false)
    if (result.ok) onClose()
    else setSaveError(result.error ?? "Failed to remove override.")
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Card */}
      <div
        className={cn(
          "relative z-10 w-80 rounded-2xl border border-white/12 bg-white/6 backdrop-blur-2xl shadow-2xl",
          "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]",
          "animate-in fade-in zoom-in-95 duration-150",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          {/* Kind badge + close */}
          <div className="flex items-center justify-between mb-4">
            <span
              className="text-[9px] font-mono uppercase tracking-[0.14em] px-2 py-1 rounded-md border"
              style={{ color: cat.color, background: `${cat.color}12`, borderColor: `${cat.color}28` }}
            >
              {cat.label}
            </span>
            <button
              onClick={onClose}
              className="h-6 w-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-white mb-1 leading-snug">{ev.title}</h3>
          {ev.sub && <p className="text-[11px] font-mono text-slate-400 mb-4">{ev.sub}</p>}

          {/* Meta rows */}
          <div className="space-y-2.5 mb-4">
            <div className="flex items-center gap-2.5 text-[12px] text-slate-300">
              <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span>{fmtFullDate(ev.date)}</span>
            </div>
            <div className="flex items-center gap-2.5 text-[12px] text-slate-300">
              <Clock className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span>{fmtTime(ev.startH, ev.startM)} — {fmtTime(endH, endM)}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{fmtDur(ev.durMin)}</span>
            </div>
            {ev.nodeCount != null && (
              <div className="flex items-center gap-2.5 text-[12px] text-slate-300">
                <Layers className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                <span>{ev.nodeCount} nodes · trigger → process → output</span>
              </div>
            )}
          </div>

          {/* Status pill */}
          <div className="flex items-center gap-2 mb-4">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[ev.status])} />
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              {ev.status}
            </span>
            {isOverrideEvent && (
              <span className="ml-1 text-[9px] font-mono text-cyan-400 border border-cyan-400/25 bg-cyan-400/8 px-1.5 py-0.5 rounded">
                ⊞ RESCHEDULED
              </span>
            )}
            {ev.conflict && (
              <span className="ml-auto text-[9px] font-mono text-red-400 border border-red-400/25 bg-red-400/8 px-1.5 py-0.5 rounded">
                ⚠ CONFLICT
              </span>
            )}
          </div>

          {/* Conflict warning */}
          {conflict && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-400/8 border border-red-400/20 text-[10px] font-mono text-red-400">
              ⚠ This time overlaps another scheduled mission. It was saved anyway — verify your schedule.
            </div>
          )}

          {/* Save error */}
          {saveError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-400/8 border border-red-400/20 text-[10px] font-mono text-red-400">
              {saveError}
            </div>
          )}

          {/* Inline reschedule picker */}
          {rescheduleOpen && ev.kind === "mission" && (
            <div className={cn("mb-3 p-3 rounded-xl border", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/30")}>
              <p className={cn("text-[9px] font-mono uppercase tracking-widest mb-2", isLight ? "text-s-50" : "text-slate-500")}>
                New time
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="date"
                  value={pickerDate}
                  onChange={(e) => setPickerDate(e.target.value)}
                  className={cn(
                    "flex-1 text-[11px] font-mono rounded-lg px-2 py-1.5 border focus:outline-none focus:ring-1 focus:ring-accent/50",
                    isLight
                      ? "border-[#d5dce8] bg-white text-s-90"
                      : "border-white/10 bg-white/5 text-slate-200",
                  )}
                />
                <input
                  type="time"
                  value={pickerTime}
                  onChange={(e) => setPickerTime(e.target.value)}
                  className={cn(
                    "w-24 text-[11px] font-mono rounded-lg px-2 py-1.5 border focus:outline-none focus:ring-1 focus:ring-accent/50",
                    isLight
                      ? "border-[#d5dce8] bg-white text-s-90"
                      : "border-white/10 bg-white/5 text-slate-200",
                  )}
                />
              </div>
              <div className="flex gap-2">
                <button
                  disabled={saving}
                  onClick={handleReschedule}
                  className="flex-1 h-8 rounded-lg text-[10px] font-mono font-medium bg-accent/80 hover:bg-accent text-white transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Confirm"}
                </button>
                <button
                  onClick={() => { setRescheduleOpen(false); setSaveError(null); setConflict(false) }}
                  className={cn(
                    "h-8 px-3 rounded-lg text-[10px] font-mono border transition-colors",
                    isLight ? "border-[#d5dce8] text-s-50 hover:bg-[#eef3fb]" : "border-white/8 text-slate-500 hover:bg-white/6",
                  )}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {ev.kind === "mission" && ev.missionId && (
              <Link
                href={`/missions?editId=${ev.missionId}&returnTo=/missions/calendar`}
                onClick={onClose}
                className="flex items-center justify-center gap-2 h-9 rounded-lg text-[11px] font-medium font-mono border transition-colors"
                style={{
                  color: cat.color,
                  background: `${cat.color}10`,
                  borderColor: `${cat.color}28`,
                }}
              >
                <span>↗</span>
                <span>EDIT IN MISSION BUILDER</span>
              </Link>
            )}

            {/* Google Calendar deep-link for personal/gcalendar events */}
            {ev.kind === "personal" && ev.provider === "gcalendar" && ev.htmlLink?.startsWith("https://") && (
              <a
                href={ev.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 h-9 rounded-lg text-[11px] font-medium font-mono border transition-colors"
                style={{
                  color: cat.color,
                  background: `${cat.color}10`,
                  borderColor: `${cat.color}28`,
                }}
              >
                <span>↗</span>
                <span>OPEN IN GOOGLE CALENDAR</span>
              </a>
            )}

            <div className="grid grid-cols-2 gap-2">
              {ev.kind === "mission" && (
                <button
                  onClick={() => { setRescheduleOpen((o) => !o); setSaveError(null); setConflict(false) }}
                  className={cn(
                    "h-9 rounded-lg text-[11px] font-mono border transition-colors",
                    rescheduleOpen
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : isLight
                        ? "border-[#d5dce8] bg-[#f4f7fd] text-slate-600 hover:bg-[#eef3fb]"
                        : "border-white/8 bg-white/3 text-slate-500 hover:bg-white/6",
                  )}
                >
                  ⊞ Reschedule
                </button>
              )}
              {isOverrideEvent && ev.missionId && (
                <button
                  disabled={saving}
                  onClick={handleRemoveOverride}
                  className={cn(
                    "h-9 rounded-lg text-[11px] font-mono border transition-colors disabled:opacity-50",
                    isLight
                      ? "border-[#d5dce8] bg-[#f4f7fd] text-slate-600 hover:bg-[#eef3fb]"
                      : "border-white/8 bg-white/3 text-slate-500 hover:bg-white/6",
                  )}
                >
                  ↩ Restore
                </button>
              )}
            </div>

            {/* Delete mission */}
            {ev.kind === "mission" && ev.missionId && onDelete && (
              <button
                onClick={() => onDelete(ev)}
                className="w-full h-9 rounded-lg text-[11px] font-mono border transition-colors border-red-500/25 bg-red-500/6 text-red-400 hover:bg-red-500/15 hover:border-red-500/40 flex items-center justify-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Mission
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Mini Calendar (sidebar) ──────────────────────────────────────────────────

function MiniCalendar({
  viewYear,
  viewMonth,
  weekStart,
  selectedDate,
  today,
  onNavigate,
  onSelectDate,
  isLight,
}: {
  viewYear:     number
  viewMonth:    number
  weekStart:    Date
  selectedDate: Date
  today:        Date
  onNavigate:   (delta: number) => void
  onSelectDate: (d: Date) => void
  isLight:      boolean
}) {
  const cells    = useMemo(() => getMiniCells(viewYear, viewMonth), [viewYear, viewMonth])
  const weekEnd  = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 6); return d }, [weekStart])

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className={cn("text-[12px] font-semibold", isLight ? "text-s-90" : "text-white")}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onNavigate(-1)}
            className={cn(
              "h-5 w-5 rounded-md flex items-center justify-center transition-colors home-spotlight-card home-border-glow",
              isLight
                ? "border border-[#d5dce8] bg-[#f4f7fd] text-s-50 hover:text-accent"
                : "border border-white/10 bg-black/25 text-slate-400 hover:text-slate-100",
            )}
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          <button
            onClick={() => onNavigate(1)}
            className={cn(
              "h-5 w-5 rounded-md flex items-center justify-center transition-colors home-spotlight-card home-border-glow",
              isLight
                ? "border border-[#d5dce8] bg-[#f4f7fd] text-s-50 hover:text-accent"
                : "border border-white/10 bg-black/25 text-slate-400 hover:text-slate-100",
            )}
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_ABBR.map((d) => (
          <div key={d} className="text-center text-[9px] font-mono tracking-wider text-white/80 py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((cell, i) => {
          const inMonth    = cell.getMonth() === viewMonth
          const isToday    = sameDay(cell, today)
          const isSel      = sameDay(cell, selectedDate)
          const inSelWeek  = cell >= weekStart && cell <= weekEnd

          return (
            <button
              key={i}
              onClick={() => onSelectDate(cell)}
              className={cn(
                "h-6 min-w-6 px-1 mx-auto rounded-full border border-transparent text-[10px] font-medium flex items-center justify-center transition-colors",
                isSel
                  ? isLight
                    ? "bg-white text-s-90 font-semibold border-white/90 shadow-sm"
                    : "bg-white text-slate-900 font-semibold border-white/90 shadow-sm"
                  : isToday
                  ? "text-accent font-semibold"
                  : inSelWeek
                  ? isLight ? "text-s-80" : "text-slate-200"
                  : inMonth
                  ? isLight ? "text-s-60 hover:text-s-80" : "text-slate-300 hover:text-slate-100"
                  : isLight ? "text-s-30 hover:text-s-50" : "text-slate-500 hover:text-slate-300",
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

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({
  weekDays,
  events,
  filters,
  today,
  selected,
  onSelect,
  onDeleteMission,
}: {
  weekDays:        Date[]
  events:          CalEvent[]
  filters:         Record<EventKind, boolean>
  today:           Date
  selected:        string | null
  onSelect:        (ev: CalEvent | null) => void
  onDeleteMission?: (ev: CalEvent) => void
}) {
  const visible  = events.filter((e) => filters[e.kind])
  const totalH   = HOURS.length * PX_HR
  const nowTop   = evTop(today.getHours(), today.getMinutes())

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Locked day headers */}
      <div className="shrink-0">
        <div
          className="grid border-b border-white/10 bg-black/25 backdrop-blur-md"
          style={{ gridTemplateColumns: `64px repeat(7, 1fr)` }}
        >
          <div className="border-r border-white/4" />
          {weekDays.map((day, i) => {
            const isToday = sameDay(day, today)
            return (
              <div key={i} className="h-[84px] px-1.5 border-l border-white/4 grid place-items-center content-center gap-0.5">
                <div className={cn(
                  "text-[18px] font-normal leading-none tracking-tight",
                  isToday ? "text-accent" : "text-white/85",
                )}>
                  {DAY_NAMES[day.getDay()]}
                </div>
                <div className={cn(
                  "text-[22px] leading-none font-medium transition-colors",
                  isToday ? "text-accent" : "text-white/90",
                )}>
                  {day.getDate()}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="module-hover-scroll calendar-scroll-hidden flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `64px repeat(7, 1fr)` }}>
          {/* Time axis */}
          <div className="border-r border-white/4 relative" style={{ height: totalH }}>
            {HOURS.map((h) => {
              const top    = (h - GRID_START) * PX_HR
              const period = h < 12 ? "AM" : "PM"
              const hh     = h > 12 ? h - 12 : h === 0 ? 12 : h
              const active = sameDay(today, today) && h === today.getHours()
              return (
                <div
                  key={h}
                  style={{ top: h === GRID_START ? top + 6 : top, right: 10 }}
                  className={cn(
                    "absolute flex items-baseline gap-[2px]",
                    h === GRID_START ? "translate-y-0" : "-translate-y-1/2",
                    active ? "text-accent" : "text-white/90",
                  )}
                >
                  <span className="text-[11px] font-medium leading-none">{hh}</span>
                  <span className="text-[9px] font-medium leading-none">{period}</span>
                </div>
              )
            })}
          </div>

          {/* Day columns */}
          {weekDays.map((day, dayIdx) => {
            const dayEvs  = visible.filter((e) => sameDay(e.date, day))
            const layout  = computeEventLayout(dayEvs)
            const isToday = sameDay(day, today)

            return (
              <div
                key={dayIdx}
                className={cn("border-l border-white/4 relative", isToday && "bg-accent/[0.018]")}
                style={{ height: totalH }}
              >
                {/* Hour gridlines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-white/4"
                    style={{ top: (h - GRID_START) * PX_HR }}
                  />
                ))}
                {/* Half-hour ticks */}
                {HOURS.map((h) => (
                  <div
                    key={`h${h}`}
                    className="absolute left-0 right-0 border-t border-white/2"
                    style={{ top: (h - GRID_START) * PX_HR + PX_HR / 2 }}
                  />
                ))}

                {/* Automation window glow (7–10am) */}
                <div
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top:        (7 - GRID_START) * PX_HR,
                    height:     3 * PX_HR,
                    background: "linear-gradient(180deg,rgba(34,211,238,0.028) 0%,transparent 100%)",
                  }}
                />

                {/* Now indicator */}
                {isToday && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: nowTop }}
                  >
                    <div className="relative h-px bg-accent shadow-[0_0_6px_rgba(139,92,246,0.9)]">
                      <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(139,92,246,1)]" />
                    </div>
                  </div>
                )}

                {/* Events */}
                {dayEvs.map((ev) => {
                  const { col, numCols } = layout.get(ev.id) ?? { col: 0, numCols: 1 }
                  return (
                    <EventPill
                      key={ev.id}
                      ev={ev}
                      col={col}
                      numCols={numCols}
                      active={selected === ev.id}
                      onClick={() => onSelect(selected === ev.id ? null : ev)}
                      onDelete={ev.kind === "mission" && onDeleteMission ? () => onDeleteMission(ev) : undefined}
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

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({
  day,
  events,
  filters,
  today,
  selected,
  onSelect,
  onDeleteMission,
}: {
  day:              Date
  events:           CalEvent[]
  filters:          Record<EventKind, boolean>
  today:            Date
  selected:         string | null
  onSelect:         (ev: CalEvent | null) => void
  onDeleteMission?: (ev: CalEvent) => void
}) {
  const visible  = events.filter((e) => filters[e.kind] && sameDay(e.date, day))
  const layout   = computeEventLayout(visible)
  const totalH   = HOURS.length * PX_HR
  const isToday  = sameDay(day, today)
  const nowTop   = evTop(today.getHours(), today.getMinutes())

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/6 py-3 px-4 bg-black/20 backdrop-blur-md">
        <div className={cn("text-[11px] font-mono tracking-wide mb-1", isToday ? "text-accent" : "text-white/85")}>
          {DAY_NAMES[day.getDay()]}
        </div>
        <div className={cn("text-2xl font-semibold", isToday ? "text-accent" : "text-slate-300")}>
          {day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </div>
      </div>

      <div className="module-hover-scroll calendar-scroll-hidden flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: "64px 1fr" }}>
          {/* Time axis */}
          <div className="border-r border-white/4 relative" style={{ height: totalH }}>
            {HOURS.map((h) => {
              const top    = (h - GRID_START) * PX_HR
              const period = h < 12 ? "AM" : "PM"
              const hh     = h > 12 ? h - 12 : h === 0 ? 12 : h
              return (
                <div
                  key={h}
                  style={{ top: h === GRID_START ? top + 6 : top, right: 10 }}
                  className={cn(
                    "absolute flex items-baseline gap-[2px] text-white/90",
                    h === GRID_START ? "translate-y-0" : "-translate-y-1/2",
                  )}
                >
                  <span className="text-[11px] font-medium leading-none">{hh}</span>
                  <span className="text-[9px] font-medium leading-none">{period}</span>
                </div>
              )
            })}
          </div>
          {/* Day column */}
          <div className={cn("relative", isToday && "bg-accent/[0.018]")} style={{ height: totalH }}>
            {HOURS.map((h) => (
              <div key={h} className="absolute left-0 right-0 border-t border-white/4" style={{ top: (h - GRID_START) * PX_HR }} />
            ))}
            {isToday && (
              <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                <div className="relative h-px bg-accent shadow-[0_0_6px_rgba(139,92,246,0.9)]">
                  <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(139,92,246,1)]" />
                </div>
              </div>
            )}
            {visible.map((ev) => {
              const { col, numCols } = layout.get(ev.id) ?? { col: 0, numCols: 1 }
              return (
                <EventPill
                  key={ev.id}
                  ev={ev}
                  col={col}
                  numCols={numCols}
                  active={selected === ev.id}
                  onClick={() => onSelect(selected === ev.id ? null : ev)}
                  onDelete={ev.kind === "mission" && onDeleteMission ? () => onDeleteMission(ev) : undefined}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  year,
  month,
  events,
  filters,
  today,
  onSelect,
}: {
  year:     number
  month:    number
  events:   CalEvent[]
  filters:  Record<EventKind, boolean>
  today:    Date
  onSelect: (ev: CalEvent) => void
}) {
  const cells   = useMemo(() => getMiniCells(year, month), [year, month])
  const visible = events.filter((e) => filters[e.kind])

  return (
    <div className="module-hover-scroll calendar-scroll-hidden flex flex-col h-full overflow-auto">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-white/6 shrink-0">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-2.5 text-center text-[10px] font-mono tracking-wide text-white/85 border-l border-white/4 first:border-l-0">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="flex-1 grid" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(96px, 1fr))` }}>
        {Array.from({ length: cells.length / 7 }).map((_, row) => (
          <div key={row} className="grid grid-cols-7 border-b border-white/4">
            {cells.slice(row * 7, row * 7 + 7).map((cell, col) => {
              const inMonth  = cell.getMonth() === month
              const isToday  = sameDay(cell, today)
              const dayEvs   = visible.filter((e) => sameDay(e.date, cell))

              return (
                <div
                  key={col}
                  className={cn(
                    "border-l border-white/4 first:border-l-0 p-1.5 min-h-24",
                    !inMonth && "opacity-30",
                    isToday && "bg-accent/4",
                  )}
                >
                  <div className={cn(
                    "inline-flex min-w-6 h-6 items-center justify-center mb-1 text-[11px] font-semibold",
                    isToday ? "text-accent" : "text-slate-500",
                  )}>
                    {cell.getDate()}
                  </div>
                  {dayEvs.slice(0, 3).map((ev) => (
                    <MonthChip key={ev.id} ev={ev} onClick={() => onSelect(ev)} />
                  ))}
                  {dayEvs.length > 3 && (
                    <div className="text-[8px] font-mono text-slate-600 px-1">+{dayEvs.length - 3} more</div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Loading ──────────────────────────────────────────────────────────────────

function CalLoading() {
  return (
    <div className="flex-1 flex items-center justify-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-accent/40"
          style={{ animation: `calDot 1.4s ease-in-out ${i * 0.18}s infinite` }}
        />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MissionsCalendarPage() {
  const router     = useRouter()
  const pageActive = usePageActive()
  const { theme }  = useTheme()
  const isLight    = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()
  const presence   = getNovaPresence({ agentConnected, novaState })
  const { accentColor } = useAccent()
  const missionColor = ACCENT_COLORS[accentColor]?.primary ?? "#8b5cf6"

  const shellRef = useRef<HTMLDivElement | null>(null)

  const [orbHovered,          setOrbHovered]          = useState(false)
  const [orbColor,            setOrbColor]            = useState<OrbColor>("violet")
  const [settingsOpen,        setSettingsOpen]        = useState(false)
  const [profileName,         setProfileName]         = useState("User")
  const [profileAvatar,       setProfileAvatar]       = useState<string | null>(null)
  const [compactModelLabel,   setCompactModelLabel]   = useState("Model Unset")
  const [view,                setView]                = useState<CalView>("week")
  const [selected,            setSelected]            = useState<CalEvent | null>(null)
  const [filters,             setFilters]             = useState<Record<EventKind, boolean>>({ personal: true, mission: true, agent: true })
  const [gcalConnected,       setGcalConnected]       = useState(false)
  const [customCategories,    setCustomCategories]    = useState<CalendarCategory[]>([])
  const [addCatOpen,          setAddCatOpen]          = useState(false)
  const [newCatLabel,         setNewCatLabel]         = useState("")
  const [newCatColor,         setNewCatColor]         = useState(PRESET_COLORS[4])

  // Week/day navigation state
  const [weekStart,     setWeekStart]     = useState(() => getWeekStart(new Date()))
  const [dayView,       setDayView]       = useState(() => new Date())
  const [selectedDate,  setSelectedDate]  = useState(() => new Date())

  // Mini-calendar navigation (independent from main view)
  const [miniYear,      setMiniYear]      = useState(() => new Date().getFullYear())
  const [miniMonth,     setMiniMonth]     = useState(() => new Date().getMonth())

  // Actually fix this — mini calendar state should track the month being viewed
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0,0,0,0)
    return d
  }, [])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const syncUserSettings = () => {
      try {
        const s = loadUserSettings()
        if (s.app?.orbColor) setOrbColor(s.app.orbColor as OrbColor)
        setProfileName(s.profile?.name?.trim() || "User")
        setProfileAvatar(s.profile?.avatar || null)
      } catch { /* ignore */ }
    }
    const syncIntegrations = () => {
      try {
        const integrations = loadIntegrationsSettings()
        setGcalConnected(Boolean(integrations.gcalendar?.connected))
        setCompactModelLabel(formatCompactModelLabelFromIntegrations(integrations))
      } catch { /* ignore */ }
    }

    syncUserSettings()
    syncIntegrations()
    setCustomCategories(loadCalendarCategories().filter((c) => !c.builtin))

    window.addEventListener("storage", syncUserSettings)
    window.addEventListener("storage", syncIntegrations)
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncUserSettings as EventListener)
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, syncIntegrations as EventListener)
    return () => {
      window.removeEventListener("storage", syncUserSettings)
      window.removeEventListener("storage", syncIntegrations)
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncUserSettings as EventListener)
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, syncIntegrations as EventListener)
    }
  }, [])

  // Keep mini calendar in sync with week navigation
  useEffect(() => {
    setMiniYear(weekStart.getFullYear())
    setMiniMonth(weekStart.getMonth())
  }, [weekStart])

  // Spotlight effect — same as every other Nova OS page
  useSpotlightEffect(true, [{ ref: shellRef, showSpotlightCore: true }], [isLight])

  const orbPalette      = ORB_COLORS[orbColor]
  const orbHoverFilter  = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  const panelClass      = isLight
    ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
    : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const subPanelClass   = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const panelStyle      = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }

  // Week days array (Sun–Sat)
  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    }),
    [weekStart],
  )

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d
  }, [weekStart])

  // For month view, derive the displayed month from weekStart
  const monthYear  = view === "month" ? weekStart.getFullYear() : weekStart.getFullYear()
  const monthMonth = view === "month" ? weekStart.getMonth()    : weekStart.getMonth()

  // Fetch events — day view fetches only the viewed day, week fetches 7 days
  const fetchStart = view === "month"
    ? new Date(monthYear, monthMonth, 1)
    : view === "day"
    ? new Date(dayView.getFullYear(), dayView.getMonth(), dayView.getDate(), 0, 0, 0, 0)
    : weekStart
  const fetchEnd = view === "month"
    ? new Date(monthYear, monthMonth + 1, 0, 23, 59, 59, 999)
    : view === "day"
    ? new Date(dayView.getFullYear(), dayView.getMonth(), dayView.getDate(), 23, 59, 59, 999)
    : weekEnd

  const { events: apiEvents, loading, error, refetch, reschedule, removeOverride } = useCalendarEvents(fetchStart, fetchEnd)

  const calEvents = useMemo(() => {
    const mapped = apiEvents.map(apiEventToCalEvent).filter((e): e is CalEvent => e !== null)
    return Array.from(new Map(mapped.map((e) => [e.id, e])).values())
  }, [apiEvents])

  // Toolbar label
  const toolbarLabel = useMemo(() => {
    if (view === "week") {
      const endDay = new Date(weekStart)
      endDay.setDate(endDay.getDate() + 6)
      if (weekStart.getMonth() === endDay.getMonth()) {
        return `${MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()}`
      }
      return `${weekStart.toLocaleDateString("en-US",{month:"short"})} – ${endDay.toLocaleDateString("en-US",{month:"short",year:"numeric"})}`
    }
    if (view === "month") return `${MONTHS[monthMonth]} ${monthYear}`
    return dayView.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  }, [view, weekStart, monthYear, monthMonth, dayView])

  // Navigation
  const goBack = useCallback(() => {
    setSelected(null)
    if (view === "week") setWeekStart((ws) => { const d = new Date(ws); d.setDate(d.getDate() - 7); return d })
    else if (view === "month") setWeekStart((ws) => new Date(ws.getFullYear(), ws.getMonth() - 1, 1))
    else setDayView((d) => { const n = new Date(d); n.setDate(n.getDate() - 1); return n })
  }, [view])

  const goForward = useCallback(() => {
    setSelected(null)
    if (view === "week") setWeekStart((ws) => { const d = new Date(ws); d.setDate(d.getDate() + 7); return d })
    else if (view === "month") setWeekStart((ws) => new Date(ws.getFullYear(), ws.getMonth() + 1, 1))
    else setDayView((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n })
  }, [view])

  const goToday = useCallback(() => {
    setSelected(null)
    setWeekStart(getWeekStart(new Date()))
    setDayView(new Date())
    setSelectedDate(new Date())
  }, [])

  const handleMiniNav = useCallback((delta: number) => {
    setMiniMonth((m) => {
      const next = m + delta
      if (next < 0)  { setMiniYear((y) => y - 1); return 11 }
      if (next > 11) { setMiniYear((y) => y + 1); return 0  }
      return next
    })
  }, [])

  const handleMiniSelect = useCallback((d: Date) => {
    setSelected(null)
    setSelectedDate(d)
    setWeekStart(getWeekStart(d))
    setDayView(d)
    setView("day")
  }, [])

  const toggleFilter = useCallback((kind: EventKind) => {
    setFilters((f) => ({ ...f, [kind]: !f[kind] }))
  }, [])

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

  const conflictCount = calEvents.filter((e) => e.conflict).length

  const handleDeleteMission = useCallback(async (ev: CalEvent) => {
    const missionId = ev.missionId
    if (!missionId) return
    setSelected(null)
    await fetch(`/api/missions?id=${encodeURIComponent(missionId)}`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {})
    refetch()
  }, [refetch])

  return (
    <MissionColorCtx.Provider value={missionColor}>
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>

      {/* Keyframes */}
      <style>{`
        @keyframes calShimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes calDot { 0%,100%{opacity:0.2;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
      `}</style>

      <div ref={shellRef} className="relative z-10 flex-1 h-dvh overflow-hidden home-spotlight-shell">
        <div className="flex h-full w-full flex-col px-3 py-4 sm:px-4 lg:px-6">

          {/* ── Nova OS Header ── */}
          <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 shrink-0">
            {/* Left: Orb + title */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => router.push("/home")}
                onMouseEnter={() => setOrbHovered(true)}
                onMouseLeave={() => setOrbHovered(false)}
                className="group relative h-11 w-11 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
                aria-label="Go to home"
              >
                <NovaOrbIndicator
                  palette={orbPalette}
                  size={30}
                  animated={pageActive}
                  className="transition-all duration-200"
                  style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                />
              </button>
              <div className="min-w-0">
                <div className="flex flex-col leading-tight">
                  <div className="flex items-baseline gap-3">
                    <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>
                      NovaOS
                    </h1>
                    <p className="text-[11px] text-accent font-mono">{NOVA_VERSION}</p>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <div className="inline-flex items-center gap-1.5">
                      <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} />
                      <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                        {presence.label}
                      </span>
                    </div>
                    <p className={cn("text-[13px] whitespace-nowrap", isLight ? "text-s-50" : "text-slate-400")}>
                      Calendar Hub
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Center: stats */}
            <div className="min-w-0 px-1">
              <div className="mx-auto grid w-full max-w-xl grid-cols-4 items-stretch gap-2">
                {[
                  {
                    label: view === "month" ? "This Month" : view === "day" ? "Today" : "This Week",
                    value: String(calEvents.length),
                    dot: "bg-accent",
                  },
                  { label: "Personal",  value: String(calEvents.filter((e) => e.kind === "personal").length), dot: "bg-amber-400" },
                  { label: "Running",   value: String(calEvents.filter((e) => e.status === "running").length),   dot: "bg-emerald-400" },
                  { label: "Conflicts", value: String(conflictCount), dot: conflictCount > 0 ? "bg-red-400" : "bg-slate-600" },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className={cn("h-9 rounded-md border px-2 py-1.5 flex items-center justify-between home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <div className="min-w-0">
                      <p className={cn("text-[9px] uppercase tracking-[0.12em] truncate", isLight ? "text-s-50" : "text-slate-400")}>{tile.label}</p>
                      <p className={cn("text-sm font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{tile.value}</p>
                    </div>
                    <span className={cn("h-2.5 w-2.5 rounded-sm", tile.dot)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2 home-spotlight-shell">
              <Link
                href="/missions?returnTo=/missions/calendar"
                className={cn(
                  "h-8 px-3 rounded-lg border transition-colors text-sm font-medium inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-dynamic",
                  isLight
                    ? "border-accent-30 bg-accent-10 text-accent"
                    : "border-accent-30 bg-accent-10 text-accent",
                )}
              >
                New Mission
              </Link>
            </div>
          </div>

          {/* ── Calendar Shell ── */}
          <div className={cn("flex-1 overflow-hidden flex gap-4 min-h-0")}>

            {/* ── Left Sidebar ── */}
            <div
              className={cn("w-66 shrink-0 flex flex-col gap-4", panelClass)}
              style={panelStyle}
            >
              <div className="module-hover-scroll calendar-scroll-hidden p-4 flex flex-col gap-4 h-full overflow-auto">

                {/* Mini calendar */}
                <MiniCalendar
                  viewYear={miniYear}
                  viewMonth={miniMonth}
                  weekStart={weekStart}
                  selectedDate={selectedDate}
                  today={today}
                  onNavigate={handleMiniNav}
                  onSelectDate={handleMiniSelect}
                  isLight={isLight}
                />

                <div className={cn("h-px", isLight ? "bg-[#e2e8f0]" : "bg-white/6")} />

                {/* Categories */}
                <div>
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <p className={cn("text-[9px] font-mono uppercase tracking-[0.16em]", isLight ? "text-s-50" : "text-white/80")}>
                      Categories
                    </p>
                    <button
                      onClick={() => setAddCatOpen((v) => !v)}
                      className={cn(
                        "h-4 w-4 rounded flex items-center justify-center text-[11px] leading-none transition-colors",
                        isLight ? "text-s-50 hover:text-accent hover:bg-accent/8" : "text-slate-400 hover:text-slate-100 hover:bg-white/10",
                      )}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Add category form */}
                  {addCatOpen && (
                    <div className={cn("mb-2 p-2 rounded-lg border", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/30")}>
                      <input
                        value={newCatLabel}
                        onChange={(e) => setNewCatLabel(e.target.value)}
                        placeholder="Category name"
                        onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                        className={cn(
                          "w-full text-[11px] rounded-md px-2 py-1.5 border mb-2 focus:outline-none focus:ring-1 focus:ring-accent/50",
                          isLight ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-40" : "border-white/10 bg-white/8 text-slate-100 placeholder:text-slate-400",
                        )}
                      />
                      <div className="flex flex-wrap gap-1 mb-2">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setNewCatColor(c)}
                            className={cn("h-4 w-4 rounded-full transition-all", newCatColor === c ? "ring-2 ring-white/60 scale-110" : "hover:scale-110")}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={handleAddCategory}
                          disabled={!newCatLabel.trim()}
                          className="flex-1 h-6 rounded-md text-[10px] font-medium bg-accent/80 hover:bg-accent text-white transition-colors disabled:opacity-40"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => setAddCatOpen(false)}
                          className={cn("h-6 px-2 rounded-md text-[10px] border transition-colors", isLight ? "border-[#d5dce8] text-s-50" : "border-white/10 text-slate-300 hover:bg-white/10")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-0.5">
                    {(["mission", "agent", "personal"] as const).map((kind) => {
                      const cat = kind === "mission" ? { ...CAT.mission, color: missionColor } : CAT[kind]
                      const on  = filters[kind]
                      const cnt = calEvents.filter((e) => e.kind === kind).length
                      return (
                        <div key={kind}>
                          <button
                            onClick={() => toggleFilter(kind)}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors",
                              isLight
                                ? on ? "bg-[#f0f4ff]" : "hover:bg-[#f4f7fd]"
                                : on ? "bg-white/4" : "hover:bg-white/2.5",
                            )}
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0 transition-opacity"
                              style={{
                                background: on ? cat.color : "transparent",
                                border: `1.5px solid ${cat.color}`,
                                opacity: on ? 1 : 0.4,
                              }}
                            />
                            <span className={cn("text-[11px] font-medium flex-1 text-left", isLight ? "text-s-70" : "text-white", !on && "opacity-40")}>
                              {cat.label}
                            </span>
                            {cnt > 0 && (
                              <span className={cn("text-[9px] font-mono", isLight ? "text-s-50" : "text-white/80", !on && "opacity-40")}>
                                {cnt}
                              </span>
                            )}
                          </button>
                          {kind === "personal" && (
                            <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md mx-1 mt-0.5 text-[9px] font-mono", isLight ? "text-s-50" : "text-white/80")}>
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full shrink-0", gcalConnected ? "bg-emerald-400" : "bg-slate-600")}
                                aria-hidden="true"
                              />
                              {gcalConnected ? "Google Calendar synced" : (
                                <Link
                                  href="/integrations"
                                  className={cn("hover:underline", isLight ? "text-s-50 hover:text-s-70" : "text-white/90 hover:text-white")}
                                >
                                  Connect →
                                </Link>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Custom categories */}
                    {customCategories.map((cat) => (
                      <div key={cat.id} className="group flex items-center">
                        <div
                          className={cn(
                            "flex-1 flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left",
                            isLight ? "bg-[#f0f4ff]" : "bg-white/4",
                          )}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ background: cat.color }}
                          />
                          <span className={cn("text-[11px] font-medium flex-1 text-left", isLight ? "text-s-70" : "text-white")}>
                            {cat.label}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveCategory(cat.id)}
                          className="h-5 w-5 ml-0.5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-red-400"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={cn("h-px", isLight ? "bg-[#e2e8f0]" : "bg-white/6")} />

                {/* Profile & settings footer */}
                <div className="mt-auto">
                  <div className={cn("flex items-center gap-2.5 px-3 py-2 transition-colors chat-sidebar-card home-spotlight-card", subPanelClass)}>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden", "border border-white/15 bg-white/5")}>
                      {profileAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={profileAvatar} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-s-80" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-s-90 font-medium truncate">
                        {profileName}
                      </p>
                      <p className="text-xs text-accent font-mono truncate">
                        {compactModelLabel}
                      </p>
                    </div>
                    <button
                      onClick={() => setSettingsOpen(true)}
                      className={cn(
                        "appearance-none h-8 w-8 rounded-lg flex items-center justify-center transition-colors group/gear chat-sidebar-card home-spotlight-card",
                      )}
                      aria-label="Settings"
                    >
                      <Settings className="w-4 h-4 text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Main Calendar ── */}
            <div
              className={cn("flex-1 flex flex-col overflow-hidden min-w-0", panelClass)}
              style={panelStyle}
            >
              {/* Toolbar */}
              <div className={cn(
                "flex items-center gap-3 px-4 py-2.5 border-b shrink-0",
                isLight ? "border-[#e2e8f0]" : "border-white/6",
              )}>
                {/* Nav arrows */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={goBack}
                    className={cn("h-7 w-7 rounded-lg flex items-center justify-center transition-colors home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={goForward}
                    className={cn("h-7 w-7 rounded-lg flex items-center justify-center transition-colors home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>

                {/* Month label */}
                <h2 className={cn("text-[15px] font-semibold tracking-tight", isLight ? "text-s-90" : "text-slate-100")}>
                  {toolbarLabel}
                </h2>

                {/* Today button */}
                <button
                  onClick={goToday}
                  className={cn(
                    "h-7 px-3 rounded-lg text-[11px] font-medium border transition-colors home-spotlight-card home-border-glow",
                    subPanelClass,
                    isLight ? "text-s-70" : "text-slate-400",
                  )}
                >
                  Today
                </button>

                {/* Conflict badge */}
                {conflictCount > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-400/8 border border-red-400/20 text-[9.5px] font-mono text-red-400">
                    ⚠ {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-400/8 border border-red-400/20 text-[9.5px] font-mono text-red-400 max-w-[200px] truncate" title={error}>
                    ⚠ {error}
                  </div>
                )}

                {/* View switcher */}
                <div className={cn("ml-auto flex items-center rounded-lg p-0.5 gap-0.5", isLight ? "bg-[#f0f4ff] border border-[#d5dce8]" : "bg-white/4 border border-white/6")}>
                  {(["day", "week", "month"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => { setSelected(null); setView(v) }}
                      className={cn(
                        "h-6 px-3 rounded-md text-[10px] font-medium capitalize transition-all",
                        view === v
                          ? isLight
                            ? "bg-white shadow-sm text-s-90"
                            : "bg-white/10 text-slate-100 shadow-sm"
                          : isLight
                          ? "text-s-50 hover:text-s-70"
                          : "text-slate-500 hover:text-slate-300",
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calendar body */}
              <div className="flex-1 overflow-hidden min-h-0">
                {loading ? (
                  <CalLoading />
                ) : view === "week" ? (
                  <WeekView
                    weekDays={weekDays}
                    events={calEvents}
                    filters={filters}
                    today={now}
                    selected={selected?.id ?? null}
                    onSelect={setSelected}
                    onDeleteMission={handleDeleteMission}
                  />
                ) : view === "month" ? (
                  <MonthView
                    year={monthYear}
                    month={monthMonth}
                    events={calEvents}
                    filters={filters}
                    today={today}
                    onSelect={setSelected}
                  />
                ) : (
                  <DayView
                    day={dayView}
                    events={calEvents}
                    filters={filters}
                    today={now}
                    selected={selected?.id ?? null}
                    onSelect={setSelected}
                    onDeleteMission={handleDeleteMission}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <DetailModal
          ev={selected}
          onClose={() => setSelected(null)}
          isLight={isLight}
          onReschedule={reschedule}
          onRemoveOverride={removeOverride}
          onDelete={handleDeleteMission}
        />
      )}

      {/* Settings */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
    </MissionColorCtx.Provider>
  )
}
