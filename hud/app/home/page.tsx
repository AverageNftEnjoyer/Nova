"use client"

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  PanelLeftOpen,
  PanelLeftClose,
  Blocks,
  Pin,
  X,
  ArrowRight,
  Mic,
  MicOff,
  Send,
  Settings,
} from "lucide-react"
import { AnimatedOrb } from "@/components/animated-orb"
import TextType from "@/components/TextType"
import { useNovaState } from "@/lib/useNovaState"
import { ChatSidebar } from "@/components/chat-sidebar"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import {
  createConversation,
  saveConversations,
  loadConversations,
  setActiveId,
  generateId,
  type ChatMessage,
  type Conversation,
} from "@/lib/conversations"
import { loadUserSettings, ORB_COLORS, type OrbColor, type ThemeBackgroundType, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import {
  INTEGRATIONS_UPDATED_EVENT,
  loadIntegrationsSettings,
  type LlmProvider,
  updateClaudeIntegrationSettings,
  updateOpenAIIntegrationSettings,
  updateDiscordIntegrationSettings,
  updateTelegramIntegrationSettings,
} from "@/lib/integrations"
import FloatingLines from "@/components/FloatingLines"
import { DiscordIcon } from "@/components/discord-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import { getCachedBackgroundVideoObjectUrl, loadBackgroundVideoObjectUrl } from "@/lib/backgroundVideoStorage"
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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatDailyTime(time: string, timezone: string): string {
  const parts = /^(\d{2}):(\d{2})$/.exec(time)
  if (!parts) return time
  const hour = Number(parts[1])
  const minute = Number(parts[2])
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone || "America/New_York",
  }).format(date)
}

function toMissionDescription(message: string | undefined, integration: string, totalCount: number): string {
  const raw = typeof message === "string" ? message.trim() : ""
  if (!raw) {
    return `${integration} - ${totalCount} run${totalCount === 1 ? "" : "s"}/day`
  }

  const normalized = raw.replace(/\s+/g, " ")
  if (normalized.length <= 84) return normalized
  return `${normalized.slice(0, 81).trimEnd()}...`
}

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? legacyDark
}

function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

const GREETINGS = [
  "Hello sir, what are we working on today?",
  "Good to see you! What's on the agenda?",
  "Hey there! Ready when you are.",
  "Welcome back! What can I help with?",
  "Hi! What would you like to tackle today?",
  "Lets get to work!",
]

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export default function HomePage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const {
    state: novaState,
    connected,
    sendToAgent,
    sendGreeting,
    setVoicePreference,
    setMuted,
    agentMessages,
    latestUsage,
    clearAgentMessages,
  } = useNovaState()
  const [isMuted, setIsMuted] = useState(false)
  const [hasAnimated, setHasAnimated] = useState(false)
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notificationSchedules, setNotificationSchedules] = useState<NotificationSchedule[]>([])
  const [welcomeMessage, setWelcomeMessage] = useState(GREETINGS[0])
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<ThemeBackgroundType>(() => {
    const cached = readShellUiCache()
    return normalizeCachedBackground(cached.background) ?? resolveThemeBackground(isLight)
  })
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(() => {
    const cached = readShellUiCache().backgroundVideoUrl
    if (cached) return cached
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    return getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
  })
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [telegramConnected, setTelegramConnected] = useState(true)
  const [discordConnected, setDiscordConnected] = useState(false)
  const [openaiConnected, setOpenaiConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [activeLlmModel, setActiveLlmModel] = useState("gpt-4.1")
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const greetingSentRef = useRef(false)
  const pipelineSectionRef = useRef<HTMLElement | null>(null)
  const integrationsSectionRef = useRef<HTMLElement | null>(null)

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
    writeShellUiCache({ conversations: next })
  }, [])

  const refreshNotificationSchedules = useCallback(() => {
    void fetch("/api/notifications/schedules", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const schedules = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
        setNotificationSchedules(schedules)
      })
      .catch(() => {
        setNotificationSchedules([])
      })
  }, [])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const loadedConversations = cached.conversations ?? loadConversations()
    setConversations(loadedConversations) // eslint-disable-line react-hooks/set-state-in-effect
    writeShellUiCache({ conversations: loadedConversations })

    const settings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? settings.app.orbColor
    const nextBackground = normalizeCachedBackground(cached.background) ?? resolveThemeBackground(isLight)
    const nextSpotlight = cached.spotlightEnabled ?? (settings.app.spotlightEnabled ?? true)
    setOrbColor(nextOrbColor)
    setBackground(nextBackground)
    setSpotlightEnabled(nextSpotlight)
    writeShellUiCache({
      orbColor: nextOrbColor,
      background: nextBackground,
      spotlightEnabled: nextSpotlight,
    })
  }, [isLight])

  useEffect(() => {
    const sync = window.setTimeout(() => {
      const muted = localStorage.getItem("nova-muted") === "true"
      setIsMuted(muted)

      const shouldAnimateIntro = sessionStorage.getItem("nova-home-intro-pending") === "true"
      if (shouldAnimateIntro) {
        sessionStorage.removeItem("nova-home-intro-pending")
        setHasAnimated(true)
      }

      setWelcomeMessage(GREETINGS[Math.floor(Math.random() * GREETINGS.length)])
    }, 0)

    return () => window.clearTimeout(sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (isLight || background !== "customVideo") return

    const uiCached = readShellUiCache().backgroundVideoUrl
    if (uiCached) {
      setBackgroundVideoUrl(uiCached)
    }
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    const cached = getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
    if (cached) {
      setBackgroundVideoUrl(cached)
      writeShellUiCache({ backgroundVideoUrl: cached })
    }
    void loadBackgroundVideoObjectUrl(selectedAssetId || undefined)
      .then((url) => {
        if (cancelled) return
        setBackgroundVideoUrl(url)
        writeShellUiCache({ backgroundVideoUrl: url })
      })
      .catch(() => {
        if (cancelled) return
        const fallback = readShellUiCache().backgroundVideoUrl
        if (!fallback) setBackgroundVideoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [background, isLight])

  useEffect(() => {
    const settings = loadUserSettings()
    fetch("/api/integrations/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const telegram = Boolean(data?.config?.telegram?.connected)
        const discord = Boolean(data?.config?.discord?.connected)
        const openai = Boolean(data?.config?.openai?.connected)
        const claude = Boolean(data?.config?.claude?.connected)
        const provider: LlmProvider = data?.config?.activeLlmProvider === "claude" ? "claude" : "openai"
        setTelegramConnected(telegram)
        setDiscordConnected(discord)
        setOpenaiConnected(openai)
        setClaudeConnected(claude)
        setActiveLlmProvider(provider)
        setActiveLlmModel(
          provider === "claude"
            ? String(data?.config?.claude?.defaultModel || "claude-sonnet-4-20250514")
            : String(data?.config?.openai?.defaultModel || "gpt-4.1"),
        )
        updateTelegramIntegrationSettings({ connected: telegram })
        updateDiscordIntegrationSettings({ connected: discord })
        updateOpenAIIntegrationSettings({ connected: openai })
        updateClaudeIntegrationSettings({ connected: claude })
      })
      .catch(() => {})
    refreshNotificationSchedules()

    // Play launch sound only once per boot session (not every home page visit)
    const alreadyPlayed = sessionStorage.getItem("nova-launch-sound-played")
    if (settings.app.soundEnabled && !alreadyPlayed) {
      sessionStorage.setItem("nova-launch-sound-played", "true")
      audioRef.current = new Audio("/sounds/launch.mp3")
      audioRef.current.volume = 0.5
      audioRef.current.play().catch(() => {})
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setOrbColor(settings.app.orbColor)
      const nextBackground = resolveThemeBackground(isLight)
      setBackground(nextBackground)
      setSpotlightEnabled(settings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: settings.app.orbColor,
        background: nextBackground,
        spotlightEnabled: settings.app.spotlightEnabled ?? true,
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [isLight, refreshNotificationSchedules])

  useLayoutEffect(() => {
    const nextBackground = resolveThemeBackground(isLight)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBackground(nextBackground)
    writeShellUiCache({ background: nextBackground })
  }, [isLight])

  useEffect(() => {
    const onUpdate = () => {
      const integrations = loadIntegrationsSettings()
      setTelegramConnected(integrations.telegram.connected)
      setDiscordConnected(integrations.discord.connected)
      setOpenaiConnected(integrations.openai.connected)
      setClaudeConnected(integrations.claude.connected)
      setActiveLlmProvider(integrations.activeLlmProvider)
      setActiveLlmModel(
        integrations.activeLlmProvider === "claude" ? integrations.claude.defaultModel : integrations.openai.defaultModel,
      )
      refreshNotificationSchedules()
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [refreshNotificationSchedules])

  useEffect(() => {
    if (connected && !greetingSentRef.current) {
      greetingSentRef.current = true
      const settings = loadUserSettings()
      // Send voice preference to agent on connect (includes voiceEnabled)
      setVoicePreference(settings.app.ttsVoice, settings.app.voiceEnabled)
      const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      const t = setTimeout(() => sendGreeting(greeting, settings.app.ttsVoice, settings.app.voiceEnabled), 1500)
      return () => clearTimeout(t)
    }
  }, [connected, sendGreeting, setVoicePreference])

  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement) => {
      const spotlight = document.createElement("div")
      spotlight.className = "home-global-spotlight"
      section.appendChild(spotlight)
      let liveStars = 0

      const handleMouseMove = (e: MouseEvent) => {
        const rect = section.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        spotlight.style.left = `${mouseX}px`
        spotlight.style.top = `${mouseY}px`
        spotlight.style.opacity = "1"

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        const proximity = 70
        const fadeDistance = 140

        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const isInsideCard =
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
          if (effectiveDistance <= proximity) {
            glowIntensity = 1
          } else if (effectiveDistance <= fadeDistance) {
            glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
          }

          const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
          const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-intensity", glowIntensity.toString())
          card.style.setProperty("--glow-radius", "120px")

          if (isInsideCard && glowIntensity > 0.2 && Math.random() <= 0.16 && liveStars < 42) {
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
    if (pipelineSectionRef.current) cleanups.push(setupSectionSpotlight(pipelineSectionRef.current))
    if (integrationsSectionRef.current) cleanups.push(setupSectionSpotlight(integrationsSectionRef.current))

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [spotlightEnabled])

  // Sync local muted state with agent state (only when agent confirms muted, never auto-unmute)
  useEffect(() => {
    if (novaState === "muted") {
      setIsMuted(true) // eslint-disable-line react-hooks/set-state-in-effect
    }
    // Never auto-unmute - only user click should unmute
  }, [novaState])

  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted) // Immediate local update
    localStorage.setItem("nova-muted", String(newMuted)) // Persist
    setMuted(newMuted) // Send to agent
  }, [isMuted, setMuted])

  // Send muted state to agent on connect if we were muted
  useEffect(() => {
    if (connected && isMuted) {
      setMuted(true)
    }
  }, [connected, isMuted, setMuted])

  // Watch for voice-triggered messages and open chat
  const voiceConvoCreatedRef = useRef(false)
  useEffect(() => {
    // Skip greeting messages (first message after connect)
    if (agentMessages.length === 0) {
      voiceConvoCreatedRef.current = false
      return
    }

    // Check if we have a user message from voice (not from HUD)
    const voiceUserMsg = agentMessages.find(m => m.role === "user" && m.source === "voice")
    if (voiceUserMsg && !voiceConvoCreatedRef.current) {
      voiceConvoCreatedRef.current = true

      // Create conversation with voice messages
      const convo = createConversation()
      convo.messages = agentMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(m.ts).toISOString(),
        source: m.source || "voice",
      }))
      convo.title = voiceUserMsg.content.length > 40
        ? voiceUserMsg.content.slice(0, 40) + "..."
        : voiceUserMsg.content

      const next = [convo, ...conversations]
      persistConversations(next) // eslint-disable-line react-hooks/set-state-in-effect
      setActiveId(convo.id)
      clearAgentMessages()
      router.push("/chat")
    }
  }, [agentMessages, conversations, persistConversations, clearAgentMessages, router])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if ((!text && attachedFiles.length === 0) || !connected) return

    const attachmentNote = attachedFiles.length
      ? `\n\nAttached files: ${attachedFiles.map((f) => f.name).join(", ")}`
      : ""
    const finalText = `${text || "Attached files"}${attachmentNote}`

    const convo = createConversation()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: finalText,
      createdAt: new Date().toISOString(),
      source: "agent",
    }
    convo.messages = [userMsg]
    convo.title = text
      ? text.length > 40 ? text.slice(0, 40) + "..." : text
      : attachedFiles[0]?.name || "Attached files"

    const next = [convo, ...conversations]
    persistConversations(next)
    setActiveId(convo.id)

    const settings = loadUserSettings()
    sendToAgent(finalText, settings.app.voiceEnabled, settings.app.ttsVoice)
    setInput("")
    setAttachedFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
    router.push("/chat")
  }, [input, attachedFiles, connected, sendToAgent, router, conversations, persistConversations])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSelectConvo = useCallback((id: string) => {
    setActiveId(id)
    router.push("/chat")
  }, [router])

  const handleNewChat = useCallback(() => {
    // Home screen "New chat" should not navigate or create a conversation.
  }, [])

  const handleDeleteConvo = useCallback((id: string) => {
    const remaining = conversations.filter((c) => c.id !== id)
    persistConversations(remaining)
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

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setAttachedFiles((prev) => [...prev, ...Array.from(files)])
    e.target.value = ""
  }, [])

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleToggleTelegramIntegration = useCallback(() => {
    const next = !telegramConnected
    setTelegramConnected(next)
    updateTelegramIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram: { connected: next } }),
    }).catch(() => {})
  }, [telegramConnected])

  const handleToggleDiscordIntegration = useCallback(() => {
    const next = !discordConnected
    setDiscordConnected(next)
    updateDiscordIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discord: { connected: next } }),
    }).catch(() => {})
  }, [discordConnected])

  const handleToggleOpenAIIntegration = useCallback(() => {
    const next = !openaiConnected
    setOpenaiConnected(next)
    updateOpenAIIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openai: { connected: next } }),
    }).catch(() => {})
  }, [openaiConnected])

  const handleToggleClaudeIntegration = useCallback(() => {
    const next = !claudeConnected
    setClaudeConnected(next)
    updateClaudeIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claude: { connected: next } }),
    }).catch(() => {})
  }, [claudeConnected])

  const missions = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string
        integration: string
        title: string
        description: string
        enabledCount: number
        totalCount: number
        times: string[]
        timezone: string
      }
    >()

    for (const schedule of notificationSchedules) {
      const title = schedule.label?.trim() || "Scheduled notification"
      const integration = schedule.integration?.trim().toLowerCase() || "unknown"
      const key = `${integration}:${title.toLowerCase()}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: schedule.id,
          integration,
          title,
          description: schedule.message?.trim() || "",
          enabledCount: schedule.enabled ? 1 : 0,
          totalCount: 1,
          times: [schedule.time],
          timezone: schedule.timezone || "America/New_York",
        })
        continue
      }
      existing.totalCount += 1
      if (schedule.enabled) existing.enabledCount += 1
      existing.times.push(schedule.time)
      if (!existing.description && schedule.message?.trim()) {
        existing.description = schedule.message.trim()
      }
    }

    return Array.from(grouped.values())
      .map((mission) => ({
        ...mission,
        description: toMissionDescription(mission.description, mission.integration, mission.totalCount),
        times: mission.times.sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => {
        const activeDelta = Number(b.enabledCount > 0) - Number(a.enabledCount > 0)
        if (activeDelta !== 0) return activeDelta
        return b.totalCount - a.totalCount
      })
  }, [notificationSchedules])

  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const missionHover = isLight
    ? "hover:bg-[#eef3fb] hover:border-[#d5dce8]"
    : "hover:bg-[#141923] hover:border-[#2b3240]"
  const runningProvider = latestUsage?.provider ?? activeLlmProvider
  const runningModel = latestUsage?.model ?? activeLlmModel
  const runningLabel = `${runningProvider === "claude" ? "Claude" : "OpenAI"} - ${runningModel || "N/A"}`
  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(
    () => [orbPalette.circle1, orbPalette.circle2],
    [orbPalette.circle1, orbPalette.circle2],
  )

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {background === "floatingLines" && !isLight && (
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
              background:
                `radial-gradient(circle at 48% 46%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.18)} 28%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent 35%)`,
            }}
          />
          <div className="absolute inset-0">
            <div
              className="absolute top-[12%] left-[16%] h-72 w-72 rounded-full blur-[110px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle1, 0.24) }}
            />
            <div
              className="absolute bottom-[8%] right-[18%] h-80 w-80 rounded-full blur-[130px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle2, 0.22) }}
            />
          </div>
        </div>
      )}
      {background === "customVideo" && !isLight && !!backgroundVideoUrl && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            src={backgroundVideoUrl}
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

      <ChatSidebar
        conversations={conversations}
        activeId={null}
        isOpen={sidebarOpen}
        runningNowLabel={runningLabel}
        onSelect={handleSelectConvo}
        onNew={handleNewChat}
        onDelete={handleDeleteConvo}
        onRename={handleRenameConvo}
        onArchive={handleArchiveConvo}
        onPin={handlePinConvo}
        onReplayBoot={() => router.push("/boot-right")}
        novaState={novaState}
        agentConnected={connected}
      />

      <div
        className="flex-1 relative overflow-hidden"
        style={{
          marginLeft: "0",
        }}
      >
        <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center px-4 py-3">
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="group relative">
              <Button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                variant="ghost"
                size="icon"
                className={cn(
                  "chat-sidebar-card home-spotlight-card home-border-glow home-spotlight-card--hover h-9 w-9 rounded-full transition-all duration-150 hover:[--glow-intensity:1]",
                  isLight
                    ? "border border-[#d9e0ea] bg-[#f4f7fd] text-s-70"
                    : "border border-white/10 bg-white/4 text-slate-300 hover:bg-[#141923] hover:border-[#2b3240]",
                )}
                aria-label={sidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4 transition-transform duration-200 ease-out group-hover:rotate-12" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex-1" />
        </div>

        <div className="relative z-10 h-full w-full px-6 pt-4 pb-6">
          <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] gap-6">
            <div className="min-h-0 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center gap-6">
                <div className={`relative h-[280px] w-[280px] ${hasAnimated ? "orb-intro" : ""}`}>
                  {(
                    <>
                      {isLight && (
                        <div
                          className="absolute -inset-3 rounded-full"
                          style={{
                            background: "radial-gradient(circle, rgba(15,23,42,0.14) 0%, rgba(15,23,42,0.05) 52%, transparent 76%)",
                          }}
                        />
                      )}
                      <div
                        className="absolute -inset-6 rounded-full animate-spin animation-duration-[16s]"
                        style={{ border: `1px solid ${hexToRgba(orbPalette.circle1, isLight ? 0.16 : 0.22)}` }}
                      />
                      <div
                        className="absolute -inset-4 rounded-full"
                        style={{ boxShadow: `0 0 80px -15px ${hexToRgba(orbPalette.circle1, isLight ? 0.34 : 0.55)}` }}
                      />
                      <AnimatedOrb size={280} palette={orbPalette} showStateLabel={false} />
                    </>
                  )}
                </div>
                <div className="text-center">
                  <p className={cn(`mt-2 text-5xl font-semibold ${hasAnimated ? "text-blur-intro" : ""}`, isLight ? "text-s-90" : "text-white")}>
                    Hi, I&apos;m Nova
                  </p>
                  <p className={cn(`mt-3 text-lg ${hasAnimated ? "text-blur-intro-delay" : ""}`, isLight ? "text-s-50" : "text-slate-400")}>
                    <TextType
                      as="span"
                      text={[welcomeMessage]}
                      typingSpeed={75}
                      pauseDuration={1500}
                      showCursor
                      cursorCharacter="_"
                      deletingSpeed={50}
                      loop={false}
                      className="inline-block"
                    />
                  </p>
                </div>
              </div>

              <div className="max-w-3xl mx-auto w-full">
                <div className="relative">
                  <div className={cn("absolute -inset-1 rounded-2xl blur-md opacity-60", isLight ? "bg-accent-10" : "bg-accent-20")} />
                  <div className={cn("relative rounded-2xl transition-colors", isLight ? "border border-[#d9e0ea] bg-white focus-within:border-accent-30" : "border border-white/10 bg-black/40 backdrop-blur-xl focus-within:border-accent-30")}>
                    {attachedFiles.length > 0 && (
                      <div className="px-4 pt-3 flex flex-wrap gap-2">
                        {attachedFiles.map((file, index) => (
                          <div key={`${file.name}-${file.size}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border border-accent-30 bg-accent-10 px-2 py-1 max-w-55">
                            <span className="truncate text-xs text-accent">{file.name}</span>
                            <button
                              onClick={() => removeAttachedFile(index)}
                              className="h-4 w-4 rounded-sm text-accent hover:bg-accent-20 transition-colors"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={handleAttachClick}
                      className={cn(
                        "group absolute left-4 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-2xl leading-none transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-accent-10 hover:rotate-12" : "text-slate-400 hover:bg-accent-10 hover:rotate-12",
                      )}
                      aria-label="Attach files"
                    >
                      <span
                        className={cn(
                          "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                          isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                        )}
                      >
                        Upload Your Files
                      </span>
                      +
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={handleFileChange}
                    />
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={connected ? "Enter your command..." : "Waiting for agent..."}
                      disabled={!connected}
                      rows={1}
                      className={cn("w-full bg-transparent text-sm pl-12 pt-4.5 pb-2.5 pr-24 resize-none outline-none disabled:opacity-40", isLight ? "text-s-90 placeholder:text-s-30" : "text-slate-100 placeholder:text-slate-500")}
                      style={{ maxHeight: 120 }}
                    />
                    <div className="absolute right-3 bottom-3 flex items-center gap-2">
                      <button
                        onClick={handleSend}
                        disabled={(!input.trim() && attachedFiles.length === 0) || !connected}
                        className={cn(
                          "p-1.5 transition-colors disabled:opacity-20",
                          isLight ? "text-s-60 hover:text-accent" : "text-slate-400 hover:text-accent",
                        )}
                        aria-label="Send message"
                      >
                        <ArrowRight className="w-5 h-5" />
                      </button>
                      <button
                        onClick={handleMuteToggle}
                        className={cn(
                          "group relative h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 hover:rotate-12",
                          isMuted
                            ? "text-red-400 hover:text-red-300"
                            : "border border-accent-30 bg-accent-10 hover:bg-accent-20 text-accent"
                        )}
                        aria-label={isMuted ? "Unmute Nova" : "Mute Nova"}
                      >
                        <span
                          className={cn(
                            "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                            isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
                          )}
                        >
                          Mute Nova From Listening
                        </span>
                        {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="min-h-0 flex flex-col gap-4 pt-0">
              <section ref={pipelineSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 min-h-0 flex-1 flex flex-col`}>
                <div className="flex items-center justify-between gap-2 text-s-80">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline</h2>
                  </div>
                  <button
                    onClick={() => router.push("/missions")}
                    className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/mission-gear`, subPanelClass)}
                    aria-label="Open mission settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/mission-gear:text-accent group-hover/mission-gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>
                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Scheduled Nova workflows</p>

                <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-2 px-1 py-1">
                  {missions.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                      No missions yet. Add one in Mission Settings.
                    </p>
                  )}
                  {missions.map((mission) => (
                    <div key={mission.id} className={cn(`${subPanelClass} p-2.5 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover mission-spotlight-card`, missionHover)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-sm leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{mission.title}</p>
                        <span
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap",
                            mission.enabledCount > 0
                              ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                              : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                          )}
                        >
                          {mission.enabledCount > 0 ? "Active" : "Paused"}
                        </span>
                      </div>
                      <p className={cn("mt-1 text-xs leading-tight", isLight ? "text-s-60" : "text-slate-400")}>{mission.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {mission.times.map((time) => (
                          <span key={`${mission.id}-${time}`} className={cn("text-[11px] px-2 py-0.5 rounded-md border", isLight ? "border-[#d6deea] bg-[#edf2fb] text-s-70" : "border-white/10 bg-white/[0.04] text-slate-300")}>
                            {formatDailyTime(time, mission.timezone)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section
                ref={integrationsSectionRef}
                style={panelStyle}
                className={`${panelClass} home-spotlight-shell p-4`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-s-80">
                    <Blocks className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Nova Integrations</h2>
                  </div>
                  <button
                    onClick={() => router.push("/integrations")}
                    className={cn(`h-8 w-8 rounded-lg transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover group/gear`, subPanelClass)}
                    aria-label="Open integrations settings"
                  >
                    <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                  </button>
                </div>

                <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>

                <div className={cn("mt-3 p-2 rounded-lg", subPanelClass)}>
                  <div className="grid grid-cols-6 gap-1">
                    <button
                      onClick={handleToggleTelegramIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        telegramConnected
                          ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                          : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                      )}
                      aria-label={telegramConnected ? "Disable Telegram integration" : "Enable Telegram integration"}
                      title={telegramConnected ? "Telegram connected (click to disable)" : "Telegram disconnected (click to enable)"}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleDiscordIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        discordConnected
                          ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                          : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                      )}
                      aria-label={discordConnected ? "Disable Discord integration" : "Enable Discord integration"}
                      title={discordConnected ? "Discord connected (click to disable)" : "Discord disconnected (click to enable)"}
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-white" />
                    </button>
                    <button
                      onClick={handleToggleOpenAIIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        openaiConnected
                          ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                          : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                      )}
                      aria-label={openaiConnected ? "Disable OpenAI integration" : "Enable OpenAI integration"}
                      title={openaiConnected ? "OpenAI connected (click to disable)" : "OpenAI disconnected (click to enable)"}
                    >
                      <OpenAIIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleClaudeIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        claudeConnected
                          ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                          : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                      )}
                      aria-label={claudeConnected ? "Disable Claude integration" : "Enable Claude integration"}
                      title={claudeConnected ? "Claude connected (click to disable)" : "Claude disconnected (click to enable)"}
                    >
                      <ClaudeIcon className="w-4 h-4" />
                    </button>
                    {Array.from({ length: 20 }).map((_, index) => (
                      <div
                        key={index}
                        className={cn(
                          "h-9 rounded-sm border home-spotlight-card home-border-glow home-spotlight-card--hover",
                          isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20",
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-2" />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
