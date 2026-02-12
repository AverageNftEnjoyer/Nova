"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Save, Trash2, Pin, Bot } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type BackgroundType, type OrbColor } from "@/lib/userSettings"
import { FluidSelect, type FluidSelectOption } from "@/components/ui/fluid-select"
import { ChatSidebar } from "@/components/chat-sidebar"
import { useNovaState } from "@/lib/useNovaState"
import {
  loadConversations,
  saveConversations,
  setActiveId,
  type Conversation,
} from "@/lib/conversations"
import FloatingLines from "@/components/FloatingLines"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import "@/components/FloatingLines.css"

interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  updatedAt: string
}

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

const CREATE_INTEGRATION_OPTIONS: FluidSelectOption[] = [
  { value: "telegram", label: "Telegram" },
  { value: "slack", label: "Slack (Soon)", disabled: true },
  { value: "discord", label: "Discord" },
  { value: "email", label: "Email (Soon)", disabled: true },
]
const EDIT_INTEGRATION_OPTIONS: FluidSelectOption[] = [
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack (Soon)", disabled: true },
  { value: "email", label: "Email (Soon)", disabled: true },
]
const MERIDIEM_OPTIONS: FluidSelectOption[] = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
]

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatIntegrationLabel(integration: string): string {
  const value = integration.trim().toLowerCase()
  if (value === "telegram") return "Telegram"
  if (value === "discord") return "Discord"
  if (value === "slack") return "Slack"
  if (value === "email") return "Email"
  if (!value) return "Telegram"
  return integration.charAt(0).toUpperCase() + integration.slice(1)
}

function to12HourParts(time24: string): { text: string; meridiem: "AM" | "PM" } {
  const match = /^(\d{2}):(\d{2})$/.exec(time24)
  if (!match) return { text: "09:00", meridiem: "AM" }

  const hour24 = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return { text: "09:00", meridiem: "AM" }

  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { text: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, meridiem }
}

function to24Hour(text12: string, meridiem: "AM" | "PM"): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text12)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null

  hour = hour % 12
  if (meridiem === "PM") hour += 12
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function normalizeTypedTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4)
  if (digits.length <= 2) return digits
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function clampToValid12Hour(text: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match) return text
  let hour = Number(match[1])
  let minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return text
  if (hour < 1) hour = 1
  if (hour > 12) hour = 12
  if (minute < 0) minute = 0
  if (minute > 59) minute = 59
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function isCompleteTypedTime(text: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(text)
}

function isLiveCommitTypedTime(text: string): boolean {
  return /^\d{2}:\d{2}$/.test(text)
}

interface TimeFieldProps {
  value24: string
  onChange24: (next: string) => void
  isLight: boolean
  className?: string
}

function TimeField({ value24, onChange24, isLight, className }: TimeFieldProps) {
  const parsed = to12HourParts(value24)
  const [text, setText] = useState(parsed.text)
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(parsed.meridiem)

  useEffect(() => {
    const next = to12HourParts(value24)
    setText(next.text) // eslint-disable-line react-hooks/set-state-in-effect
    setMeridiem(next.meridiem)
  }, [value24])

  const commit = useCallback(
    (nextText: string, nextMeridiem: "AM" | "PM") => {
      const full = clampToValid12Hour(nextText)
      const converted = to24Hour(full, nextMeridiem)
      if (converted) {
        setText(full)
        onChange24(converted)
      }
    },
    [onChange24],
  )

  return (
    <div className={cn("grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-2", className)}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          const normalized = normalizeTypedTime(e.target.value)
          setText(normalized)
          if (isLiveCommitTypedTime(normalized)) {
            commit(normalized, meridiem)
          }
        }}
        onBlur={() => {
          if (isCompleteTypedTime(text)) {
            commit(text, meridiem)
          } else {
            const fallback = to12HourParts(value24)
            setText(fallback.text)
            setMeridiem(fallback.meridiem)
          }
        }}
        placeholder="12:45"
        inputMode="numeric"
        maxLength={5}
        className={cn(
          "h-9 min-w-0 w-full rounded-md border px-3 text-sm outline-none transition-colors",
          isLight
            ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 placeholder:text-s-40 hover:bg-[#eef3fb]"
            : "border-white/12 bg-white/[0.06] text-slate-100 placeholder:text-slate-500 backdrop-blur-md hover:bg-white/[0.1]",
        )}
      />
      <FluidSelect
        value={meridiem}
        onChange={(next) => {
          const nextMeridiem = (next === "PM" ? "PM" : "AM") as "AM" | "PM"
          setMeridiem(nextMeridiem)
          if (isCompleteTypedTime(text)) {
            commit(text, nextMeridiem)
          }
        }}
        options={MERIDIEM_OPTIONS}
        isLight={isLight}
      />
    </div>
  )
}

export default function MissionsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<BackgroundType>("default")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)

  const [schedules, setSchedules] = useState<NotificationSchedule[]>([])
  const [baselineById, setBaselineById] = useState<Record<string, NotificationSchedule>>({})
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<null | { type: "success" | "error"; message: string }>(null)
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [pendingDeleteMission, setPendingDeleteMission] = useState<NotificationSchedule | null>(null)

  const [newIntegration, setNewIntegration] = useState("telegram")
  const [newLabel, setNewLabel] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [newTime, setNewTime] = useState("09:00")
  const [detectedTimezone, setDetectedTimezone] = useState("America/New_York")

  const listSectionRef = useRef<HTMLElement | null>(null)
  const createSectionRef = useRef<HTMLElement | null>(null)
  const notesSectionRef = useRef<HTMLElement | null>(null)

  const setItemBusy = useCallback((id: string, busy: boolean) => {
    setBusyById((prev) => ({ ...prev, [id]: busy }))
  }, [])

  const refreshSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/notifications/schedules", { cache: "no-store" })
      const data = await res.json()
      const next = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
      setSchedules(next)
      const baseline: Record<string, NotificationSchedule> = {}
      for (const item of next) baseline[item.id] = item
      setBaselineById(baseline)
    } catch {
      setStatus({ type: "error", message: "Failed to load missions." })
      setSchedules([])
      setBaselineById({})
    } finally {
      setLoading(false)
    }
  }, [])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const loadedConversations = cached.conversations ?? loadConversations()
    setConversations(loadedConversations)
    writeShellUiCache({ conversations: loadedConversations })

    const userSettings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? userSettings.app.orbColor
    const nextBackground = cached.background ?? (userSettings.app.background || "default")
    const nextSpotlight = cached.spotlightEnabled ?? (userSettings.app.spotlightEnabled ?? true)
    setOrbColor(nextOrbColor)
    setBackground(nextBackground)
    setSpotlightEnabled(nextSpotlight)
    writeShellUiCache({
      orbColor: nextOrbColor,
      background: nextBackground,
      spotlightEnabled: nextSpotlight,
    })

    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof localTimezone === "string" && localTimezone.trim().length > 0) {
      setDetectedTimezone(localTimezone)
    }
  }, [])

  useEffect(() => {
    void refreshSchedules()
  }, [refreshSchedules])

  useEffect(() => {
    const refresh = () => {
      const userSettings = loadUserSettings()
      setOrbColor(userSettings.app.orbColor)
      setBackground(userSettings.app.background || "default")
      setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: userSettings.app.orbColor,
        background: userSettings.app.background || "default",
        spotlightEnabled: userSettings.app.spotlightEnabled ?? true,
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement) => {
      const spotlight = document.createElement("div")
      spotlight.className = "home-global-spotlight"
      section.appendChild(spotlight)
      let liveStars = 0

      const handleMouseMove = (e: MouseEvent) => {
        const rect = section.getBoundingClientRect()
        spotlight.style.left = `${e.clientX - rect.left}px`
        spotlight.style.top = `${e.clientY - rect.top}px`
        spotlight.style.opacity = "1"

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        const proximity = 70
        const fadeDistance = 140
        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const inside =
            e.clientX >= cardRect.left &&
            e.clientX <= cardRect.right &&
            e.clientY >= cardRect.top &&
            e.clientY <= cardRect.bottom

          const centerX = cardRect.left + cardRect.width / 2
          const centerY = cardRect.top + cardRect.height / 2
          const distance =
            Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
          const effectiveDistance = Math.max(0, distance)

          let glowIntensity = 0
          if (effectiveDistance <= proximity) glowIntensity = 1
          else if (effectiveDistance <= fadeDistance) glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)

          const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
          const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-intensity", glowIntensity.toString())
          card.style.setProperty("--glow-radius", "120px")

          if (inside && glowIntensity > 0.2 && Math.random() <= 0.16 && liveStars < 42) {
            liveStars += 1
            const star = document.createElement("span")
            star.className = "fx-star-particle"
            star.style.left = `${e.clientX - cardRect.left}px`
            star.style.top = `${e.clientY - cardRect.top}px`
            star.style.setProperty("--fx-star-color", "rgba(255,255,255,1)")
            star.style.setProperty("--fx-star-glow", "rgba(255,255,255,0.7)")
            star.style.setProperty("--star-x", `${(Math.random() - 0.5) * 34}px`)
            star.style.setProperty("--star-y", `${-12 - Math.random() * 26}px`)
            star.style.animationDuration = `${0.9 + Math.random() * 0.6}s`
            card.appendChild(star)
            star.addEventListener(
              "animationend",
              () => {
                star.remove()
                liveStars = Math.max(0, liveStars - 1)
              },
              { once: true },
            )
          }
        })
      }

      const handleMouseLeave = () => {
        spotlight.style.opacity = "0"
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
        spotlight.remove()
      }
    }

    const cleanups: Array<() => void> = []
    if (createSectionRef.current) cleanups.push(setupSectionSpotlight(createSectionRef.current))
    if (listSectionRef.current) cleanups.push(setupSectionSpotlight(listSectionRef.current))
    if (notesSectionRef.current) cleanups.push(setupSectionSpotlight(notesSectionRef.current))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [spotlightEnabled])

  const handleSelectConvo = useCallback((id: string) => {
    setActiveId(id)
    router.push("/chat")
  }, [router])

  const handleNewChat = useCallback(() => {
    router.push("/home")
  }, [router])

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
    writeShellUiCache({ conversations: next })
  }, [])

  const handleDeleteConvo = useCallback((id: string) => {
    persistConversations(conversations.filter((c) => c.id !== id))
  }, [conversations, persistConversations])

  const handleRenameConvo = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const next = conversations.map((c) =>
      c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handleArchiveConvo = useCallback((id: string, archived: boolean) => {
    const next = conversations.map((c) =>
      c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
    )
    persistConversations(next)
  }, [conversations, persistConversations])

  const handlePinConvo = useCallback((id: string, pinned: boolean) => {
    const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
    persistConversations(next)
  }, [conversations, persistConversations])

  const updateLocalSchedule = useCallback((id: string, patch: Partial<NotificationSchedule>) => {
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const createMission = useCallback(async () => {
    const label = newLabel.trim()
    const message = newMessage.trim()
    const time = newTime.trim()
    const timezone = (detectedTimezone || "America/New_York").trim()

    if (!message) {
      setStatus({ type: "error", message: "Mission message is required." })
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setStatus({ type: "error", message: "Time must be HH:mm (24h)." })
      return
    }

    setCreating(true)
    setStatus(null)
    try {
      const res = await fetch("/api/notifications/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integration: newIntegration,
          label: label || "New Mission",
          message,
          time,
          timezone,
          enabled: true,
          chatIds: [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to create mission")

      setNewLabel("")
      setNewMessage("")
      setNewTime("09:00")
      setStatus({ type: "success", message: "Mission created." })
      await refreshSchedules()
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to create mission." })
    } finally {
      setCreating(false)
    }
  }, [newLabel, newMessage, newTime, detectedTimezone, newIntegration, refreshSchedules])

  const saveMission = useCallback(async (mission: NotificationSchedule) => {
    const baseline = baselineById[mission.id]
    const timeChanged = baseline ? baseline.time !== mission.time : true
    const timezoneChanged = baseline ? baseline.timezone !== (detectedTimezone || "America/New_York").trim() : true
    const enabledChanged = baseline ? baseline.enabled !== mission.enabled : true

    setItemBusy(mission.id, true)
    setStatus(null)
    try {
      const res = await fetch("/api/notifications/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: mission.id,
          integration: mission.integration,
          label: mission.label,
          message: mission.message,
          time: mission.time,
          timezone: (detectedTimezone || "America/New_York").trim(),
          enabled: mission.enabled,
          chatIds: [],
          resetLastSent: timeChanged || timezoneChanged || enabledChanged,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save mission")
      const updated = data?.schedule as NotificationSchedule | undefined
      if (updated) {
        updateLocalSchedule(mission.id, updated)
        setBaselineById((prev) => ({ ...prev, [mission.id]: updated }))
      }
      setStatus({ type: "success", message: `Mission \"${mission.label}\" saved.` })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save mission." })
      if (baseline) updateLocalSchedule(mission.id, baseline)
    } finally {
      setItemBusy(mission.id, false)
    }
  }, [baselineById, setItemBusy, updateLocalSchedule, detectedTimezone])

  const deleteMission = useCallback(async (id: string) => {
    setItemBusy(id, true)
    setStatus(null)
    try {
      const res = await fetch(`/api/notifications/schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to delete mission")
      setSchedules((prev) => prev.filter((s) => s.id !== id))
      setBaselineById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setStatus({ type: "success", message: "Mission deleted." })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to delete mission." })
    } finally {
      setItemBusy(id, false)
    }
  }, [setItemBusy])

  const confirmDeleteMission = useCallback(async () => {
    if (!pendingDeleteMission) return
    await deleteMission(pendingDeleteMission.id)
    setPendingDeleteMission(null)
  }, [deleteMission, pendingDeleteMission])

  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(() => [orbPalette.circle1, orbPalette.circle2], [orbPalette.circle1, orbPalette.circle2])
  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {background === "default" && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 48% 42%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.16)} 30%, transparent 60%)`,
            }}
          />
        </div>
      )}

      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={true}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        onReplayBoot={() => router.push("/boot-right")}
        novaState={novaState}
        agentConnected={agentConnected}
      />

      <div className="relative z-10 flex-1 h-dvh overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full items-start justify-center px-4 py-6 sm:px-6">
          <div className="w-full max-w-6xl">
            <div className="mb-5 flex items-center justify-center">
              <h1 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Missions</h1>
            </div>

            {status && (
              <div
                className={cn(
                  "mb-4 rounded-lg border px-3 py-2 text-sm",
                  status.type === "success"
                    ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                    : "border-rose-300/40 bg-rose-500/15 text-rose-200",
                )}
              >
                {status.message}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="space-y-4">
                <section ref={createSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4`}>
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Create Mission</h2>
                  </div>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Add a daily workflow Nova should run.</p>

                  <div className="mt-3 space-y-2">
                    <div className={cn(`px-3 py-2 ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`)}>
                      <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Integration</label>
                      <FluidSelect
                        value={newIntegration}
                        onChange={setNewIntegration}
                        options={CREATE_INTEGRATION_OPTIONS}
                        isLight={isLight}
                        className="mt-1"
                      />
                    </div>

                    <div className={cn(`px-3 py-2 ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`)}>
                      <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Mission Name</label>
                      <input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Daily Schedule Ping"
                        className={cn("mt-1 h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                      />
                    </div>

                    <div className={cn(`px-3 py-2 ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`)}>
                      <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Message</label>
                      <input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder="Hello Jack, here is your daily schedule for today."
                        className={cn("mt-1 h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                      />
                    </div>

                    <div className={cn(`px-3 py-2 ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`)}>
                      <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Time</label>
                      <TimeField
                        value24={newTime}
                        onChange24={setNewTime}
                        isLight={isLight}
                        className="mt-1"
                      />
                      <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                        Timezone: {detectedTimezone}
                      </p>
                    </div>

                  </div>

                  <button
                    onClick={createMission}
                    disabled={creating}
                    className="mt-3 h-9 w-full rounded-lg border border-accent-30 bg-accent-10 text-accent hover:bg-accent-20 transition-colors disabled:opacity-50 home-spotlight-card home-border-glow home-spotlight-card--hover"
                  >
                    {creating ? "Creating..." : "Create Mission"}
                  </button>
                </section>

                <section ref={notesSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4`}>
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Agent Ready</h2>
                  </div>
                  <p className={cn("text-xs mt-2", isLight ? "text-s-60" : "text-slate-300")}>
                    Missions are stored in the scheduler API, so Nova can create/update them later using the same endpoints.
                  </p>
                  <div className={cn(`mt-2 px-3 py-2 text-xs ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`)}>
                    <p>GET /api/notifications/schedules</p>
                    <p>POST /api/notifications/schedules</p>
                    <p>PATCH /api/notifications/schedules</p>
                    <p>DELETE /api/notifications/schedules?id=...</p>
                  </div>
                </section>
              </div>

              <section ref={listSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4`}>
                <div className="flex items-center gap-2">
                  <Pin className="w-4 h-4 text-accent" />
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline Settings</h2>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                  Edit, enable, disable, and delete missions. Changes update scheduler runtime.
                </p>

                <div className="mt-3 max-h-[68vh] overflow-y-auto space-y-3 pr-1">
                  {loading && <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>Loading missions...</p>}
                  {!loading && schedules.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>No missions yet.</p>
                  )}

                  {schedules.map((mission) => {
                    const busy = Boolean(busyById[mission.id])
                    return (
                      <div key={mission.id} className={cn(`p-3 ${subPanelClass} home-spotlight-card home-border-glow`)}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>
                            {formatIntegrationLabel(mission.integration)}
                          </span>
                          <button
                            onClick={() => {
                              const nextEnabled = !mission.enabled
                              updateLocalSchedule(mission.id, { enabled: nextEnabled })
                              void saveMission({ ...mission, enabled: nextEnabled })
                            }}
                            disabled={busy}
                            className={cn(
                              "text-xs px-2.5 py-1 rounded-md border transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover disabled:opacity-50",
                              mission.enabled
                                ? "border-rose-300/40 bg-rose-500/20 text-rose-200"
                                : "border-emerald-300/40 bg-emerald-500/20 text-emerald-200",
                            )}
                          >
                            {mission.enabled ? "Disable" : "Enable"}
                          </button>
                        </div>

                        <div className="mt-2 space-y-2">
                          <FluidSelect
                            value={mission.integration}
                            onChange={(nextIntegration) => updateLocalSchedule(mission.id, { integration: nextIntegration })}
                            options={EDIT_INTEGRATION_OPTIONS}
                            isLight={isLight}
                            className={cn(subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}
                          />
                          <input
                            value={mission.label}
                            onChange={(e) => updateLocalSchedule(mission.id, { label: e.target.value })}
                            className={cn(`h-9 w-full px-3 text-sm outline-none ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`, isLight ? "text-s-90" : "text-slate-100")}
                            placeholder="Mission name"
                          />
                          <input
                            value={mission.message}
                            onChange={(e) => updateLocalSchedule(mission.id, { message: e.target.value })}
                            className={cn(`h-9 w-full px-3 text-sm outline-none ${subPanelClass} home-spotlight-card home-border-glow home-spotlight-card--hover`, isLight ? "text-s-90" : "text-slate-100")}
                            placeholder="Mission message"
                          />
                          <TimeField
                            value24={mission.time}
                            onChange24={(nextTime) => updateLocalSchedule(mission.id, { time: nextTime })}
                            isLight={isLight}
                            className="w-full"
                          />
                          <p className={cn("text-[11px] mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                            Timezone: {detectedTimezone}
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            onClick={() => setPendingDeleteMission(mission)}
                            disabled={busy}
                            className="h-8 px-3 rounded-md border border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20 transition-colors disabled:opacity-50 home-spotlight-card home-border-glow home-spotlight-card--hover"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void saveMission(mission)}
                            disabled={busy}
                            className="h-8 px-3 rounded-md border border-accent-30 bg-accent-10 text-accent hover:bg-accent-20 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span className="text-xs">{busy ? "Saving..." : "Save"}</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {pendingDeleteMission && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setPendingDeleteMission(null)}
            aria-label="Close delete confirmation"
          />
          <div
            style={panelStyle}
            className={cn(
              "relative z-10 w-full max-w-md rounded-2xl border p-4",
              isLight
                ? "border-[#d9e0ea] bg-white shadow-none"
                : "border-white/12 bg-[#0b111a]/95 backdrop-blur-xl",
            )}
          >
            <h3 className={cn("text-sm uppercase tracking-[0.18em] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
              Delete Mission
            </h3>
            <p className={cn("mt-2 text-sm", isLight ? "text-s-60" : "text-slate-300")}>
              This will permanently delete
              {" "}
              <span className={cn("font-medium", isLight ? "text-s-90" : "text-slate-100")}>
                {pendingDeleteMission.label || "Untitled mission"}
              </span>
              .
            </p>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>
              Scheduled delivery for this mission will stop immediately.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDeleteMission(null)}
                className={cn(
                  "h-8 px-3 rounded-md border text-xs transition-colors",
                  isLight
                    ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:bg-[#eef3fb]"
                    : "border-white/12 bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]",
                )}
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDeleteMission()}
                disabled={Boolean(busyById[pendingDeleteMission.id])}
                className="h-8 px-3 rounded-md border border-rose-300/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/25 text-xs transition-colors disabled:opacity-60"
              >
                {busyById[pendingDeleteMission.id] ? "Deleting..." : "Delete Mission"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
