"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  PanelLeftOpen,
  PanelLeftClose,
  Blocks,
  Pin,
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
  updateGmailIntegrationSettings,
  updateGeminiIntegrationSettings,
  updateGrokIntegrationSettings,
  updateOpenAIIntegrationSettings,
  updateDiscordIntegrationSettings,
  updateTelegramIntegrationSettings,
} from "@/lib/integrations"
import FloatingLines from "@/components/FloatingLines"
import { TelegramIcon } from "@/components/telegram-icon"
import { DiscordIcon } from "@/components/discord-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { XAIIcon } from "@/components/xai-icon"
import { GeminiIcon } from "@/components/gemini-icon"
import { GmailIcon } from "@/components/gmail-icon"
import { Composer } from "@/components/composer"
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

const PENDING_CHAT_SESSION_KEY = "nova_pending_chat_message"
const GREETING_COOLDOWN_MS = 60_000

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

function priorityRank(priority: "low" | "medium" | "high" | "critical"): number {
  if (priority === "low") return 0
  if (priority === "medium") return 1
  if (priority === "high") return 2
  return 3
}

function normalizePriority(value: string | undefined): "low" | "medium" | "high" | "critical" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized
  return "medium"
}

function parseMissionWorkflowMeta(message: string | undefined): {
  description: string
  priority: "low" | "medium" | "high" | "critical"
} {
  const raw = typeof message === "string" ? message : ""
  const marker = "[NOVA WORKFLOW]"
  const idx = raw.indexOf(marker)
  const description = (idx < 0 ? raw : raw.slice(0, idx)).trim()
  if (idx < 0) return { description, priority: "medium" }

  const jsonText = raw.slice(idx + marker.length).trim()
  try {
    const parsed = JSON.parse(jsonText) as { priority?: string }
    return { description, priority: normalizePriority(parsed.priority) }
  } catch {
    return { description, priority: "medium" }
  }
}

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? (isLight ? "none" : legacyDark)
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
    sendGreeting,
    setVoicePreference,
    setMuted,
    agentMessages,
    latestUsage,
    clearAgentMessages,
  } = useNovaState()
  const [isMuted, setIsMuted] = useState(false)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const [hasAnimated, setHasAnimated] = useState(false)
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
  const [backgroundVideoAssetId, setBackgroundVideoAssetId] = useState<string | null>(() => loadUserSettings().app.customBackgroundVideoAssetId)
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [discordConnected, setDiscordConnected] = useState(false)
  const [openaiConnected, setOpenaiConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [grokConnected, setGrokConnected] = useState(false)
  const [geminiConnected, setGeminiConnected] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [openaiConfigured, setOpenaiConfigured] = useState(false)
  const [claudeConfigured, setClaudeConfigured] = useState(false)
  const [grokConfigured, setGrokConfigured] = useState(false)
  const [geminiConfigured, setGeminiConfigured] = useState(false)
  const [gmailTokenConfigured, setGmailTokenConfigured] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [activeLlmModel, setActiveLlmModel] = useState("gpt-4.1")
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
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const schedules = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
        setNotificationSchedules(schedules)
      })
      .catch(() => {
        setNotificationSchedules([])
      })
  }, [router])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const loadedConversations = cached.conversations ?? loadConversations()
    setConversations(loadedConversations)
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

  useLayoutEffect(() => {
    const integrations = loadIntegrationsSettings()
    setTelegramConnected(integrations.telegram.connected)
    setDiscordConnected(integrations.discord.connected)
    setOpenaiConnected(integrations.openai.connected)
    setClaudeConnected(integrations.claude.connected)
    setGrokConnected(integrations.grok.connected)
    setGeminiConnected(integrations.gemini.connected)
    setGmailConnected(integrations.gmail.connected)
    setOpenaiConfigured(Boolean(integrations.openai.apiKeyConfigured))
    setClaudeConfigured(Boolean(integrations.claude.apiKeyConfigured))
    setGrokConfigured(Boolean(integrations.grok.apiKeyConfigured))
    setGeminiConfigured(Boolean(integrations.gemini.apiKeyConfigured))
    setGmailTokenConfigured(Boolean(integrations.gmail.tokenConfigured))
    setActiveLlmProvider(integrations.activeLlmProvider)
    setActiveLlmModel(
      integrations.activeLlmProvider === "claude"
        ? integrations.claude.defaultModel
        : integrations.activeLlmProvider === "grok"
          ? integrations.grok.defaultModel
          : integrations.activeLlmProvider === "gemini"
            ? integrations.gemini.defaultModel
          : integrations.openai.defaultModel,
    )
    setIntegrationsHydrated(true)
  }, [])

  useLayoutEffect(() => {
    const muted = localStorage.getItem("nova-muted") === "true"
    setIsMuted(muted)
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    const sync = window.setTimeout(() => {
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
    const selectedAssetId = backgroundVideoAssetId ?? loadUserSettings().app.customBackgroundVideoAssetId
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
  }, [background, isLight, backgroundVideoAssetId])

  useEffect(() => {
    fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const telegram = Boolean(data?.config?.telegram?.connected)
        const discord = Boolean(data?.config?.discord?.connected)
        const openai = Boolean(data?.config?.openai?.connected)
        const claude = Boolean(data?.config?.claude?.connected)
        const grok = Boolean(data?.config?.grok?.connected)
        const gemini = Boolean(data?.config?.gemini?.connected)
        const gmail = Boolean(data?.config?.gmail?.connected)
        const openaiReady = Boolean(data?.config?.openai?.apiKeyConfigured)
        const claudeReady = Boolean(data?.config?.claude?.apiKeyConfigured)
        const grokReady = Boolean(data?.config?.grok?.apiKeyConfigured)
        const geminiReady = Boolean(data?.config?.gemini?.apiKeyConfigured)
        const gmailReady = Boolean(data?.config?.gmail?.tokenConfigured)
        const provider: LlmProvider =
          data?.config?.activeLlmProvider === "claude"
            ? "claude"
            : data?.config?.activeLlmProvider === "grok"
              ? "grok"
              : data?.config?.activeLlmProvider === "gemini"
                ? "gemini"
              : "openai"
        setTelegramConnected(telegram)
        setDiscordConnected(discord)
        setOpenaiConnected(openai)
        setClaudeConnected(claude)
        setGrokConnected(grok)
        setGeminiConnected(gemini)
        setGmailConnected(gmail)
        setOpenaiConfigured(openaiReady)
        setClaudeConfigured(claudeReady)
        setGrokConfigured(grokReady)
        setGeminiConfigured(geminiReady)
        setGmailTokenConfigured(gmailReady)
        setActiveLlmProvider(provider)
        setActiveLlmModel(
          provider === "claude"
            ? String(data?.config?.claude?.defaultModel || "claude-sonnet-4-20250514")
            : provider === "grok"
              ? String(data?.config?.grok?.defaultModel || "grok-4-0709")
              : provider === "gemini"
                ? String(data?.config?.gemini?.defaultModel || "gemini-2.5-pro")
              : String(data?.config?.openai?.defaultModel || "gpt-4.1"),
        )
        updateTelegramIntegrationSettings({ connected: telegram })
        updateDiscordIntegrationSettings({ connected: discord })
        updateOpenAIIntegrationSettings({ connected: openai })
        updateClaudeIntegrationSettings({ connected: claude })
        updateGrokIntegrationSettings({ connected: grok })
        updateGeminiIntegrationSettings({ connected: gemini })
        updateGmailIntegrationSettings({ connected: gmail, tokenConfigured: gmailReady })
      })
      .catch(() => {})
    refreshNotificationSchedules()
  }, [refreshNotificationSchedules, router])

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setOrbColor(settings.app.orbColor)
      const nextBackground = resolveThemeBackground(isLight)
      setBackground(nextBackground)
      setBackgroundVideoAssetId(settings.app.customBackgroundVideoAssetId)
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
      setGrokConnected(integrations.grok.connected)
      setGeminiConnected(integrations.gemini.connected)
      setGmailConnected(integrations.gmail.connected)
      setOpenaiConfigured(Boolean(integrations.openai.apiKeyConfigured))
      setClaudeConfigured(Boolean(integrations.claude.apiKeyConfigured))
      setGrokConfigured(Boolean(integrations.grok.apiKeyConfigured))
      setGeminiConfigured(Boolean(integrations.gemini.apiKeyConfigured))
      setGmailTokenConfigured(Boolean(integrations.gmail.tokenConfigured))
      setActiveLlmProvider(integrations.activeLlmProvider)
      setActiveLlmModel(
        integrations.activeLlmProvider === "claude"
          ? integrations.claude.defaultModel
        : integrations.activeLlmProvider === "grok"
          ? integrations.grok.defaultModel
          : integrations.activeLlmProvider === "gemini"
            ? integrations.gemini.defaultModel
          : integrations.openai.defaultModel,
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
      // If voice is disabled, skip startup greeting entirely (prevents hello spam).
      if (!settings.app.voiceEnabled) return

      const now = Date.now()
      const lastGreetingAt = Number(localStorage.getItem("nova-last-greeting-at") || "0")
      if (Number.isFinite(lastGreetingAt) && now - lastGreetingAt < GREETING_COOLDOWN_MS) return

      const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      const t = setTimeout(() => {
        localStorage.setItem("nova-last-greeting-at", String(Date.now()))
        sendGreeting(greeting, settings.app.ttsVoice, settings.app.voiceEnabled)
      }, 1500)
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
      setIsMuted(true)
    }
    // Never auto-unmute - only user click should unmute
  }, [novaState])

  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMuted
    setIsMuted(newMuted) // Immediate local update
    localStorage.setItem("nova-muted", String(newMuted)) // Persist
    setMuted(newMuted) // Send to agent
  }, [isMuted, setMuted])

  // Always sync muted state to agent on connect to avoid stale mute state.
  useEffect(() => {
    if (connected) {
      setMuted(isMuted)
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
      persistConversations(next)
      setActiveId(convo.id)
      clearAgentMessages()
      router.push("/chat")
    }
  }, [agentMessages, conversations, persistConversations, clearAgentMessages, router])

  const handleSend = useCallback((finalText: string) => {
    const text = finalText.trim()
    if (!text || !connected) return

    const convo = createConversation()
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: finalText,
      createdAt: new Date().toISOString(),
      source: "agent",
    }
    convo.messages = [userMsg]
    const firstLine = text.split("\n")[0]?.trim() || "New chat"
    convo.title = firstLine.length > 40 ? `${firstLine.slice(0, 40)}...` : firstLine

    const next = [convo, ...conversations]
    persistConversations(next)
    setActiveId(convo.id)
    try {
      sessionStorage.setItem(
        PENDING_CHAT_SESSION_KEY,
        JSON.stringify({
          convoId: convo.id,
          content: finalText,
          createdAt: Date.now(),
        }),
      )
    } catch {}
    router.push("/chat")
  }, [connected, router, conversations, persistConversations])

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
    if (!openaiConnected && !openaiConfigured) return
    const next = !openaiConnected
    setOpenaiConnected(next)
    updateOpenAIIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openai: { connected: next } }),
    }).catch(() => {})
  }, [openaiConnected, openaiConfigured])

  const handleToggleClaudeIntegration = useCallback(() => {
    if (!claudeConnected && !claudeConfigured) return
    const next = !claudeConnected
    setClaudeConnected(next)
    updateClaudeIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claude: { connected: next } }),
    }).catch(() => {})
  }, [claudeConnected, claudeConfigured])

  const handleToggleGrokIntegration = useCallback(() => {
    if (!grokConnected && !grokConfigured) return
    const next = !grokConnected
    setGrokConnected(next)
    updateGrokIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grok: { connected: next } }),
    }).catch(() => {})
  }, [grokConnected, grokConfigured])

  const handleToggleGeminiIntegration = useCallback(() => {
    if (!geminiConnected && !geminiConfigured) return
    const next = !geminiConnected
    setGeminiConnected(next)
    updateGeminiIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gemini: { connected: next } }),
    }).catch(() => {})
  }, [geminiConnected, geminiConfigured])

  const handleToggleGmailIntegration = useCallback(() => {
    if (!gmailConnected && !gmailTokenConfigured) return
    const next = !gmailConnected
    setGmailConnected(next)
    updateGmailIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail: { connected: next } }),
    }).catch(() => {})
  }, [gmailConnected, gmailTokenConfigured])

  const missions = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string
        integration: string
        title: string
        description: string
        priority: "low" | "medium" | "high" | "critical"
        enabledCount: number
        totalCount: number
        times: string[]
        timezone: string
      }
    >()

    for (const schedule of notificationSchedules) {
      const meta = parseMissionWorkflowMeta(schedule.message)
      const title = schedule.label?.trim() || "Scheduled notification"
      const integration = schedule.integration?.trim().toLowerCase() || "unknown"
      const key = `${integration}:${title.toLowerCase()}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: schedule.id,
          integration,
          title,
          description: meta.description,
          priority: meta.priority,
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
      if (!existing.description && meta.description) {
        existing.description = meta.description
      }
      if (priorityRank(meta.priority) > priorityRank(existing.priority)) {
        existing.priority = meta.priority
      }
    }

    return Array.from(grouped.values())
      .map((mission) => ({
        ...mission,
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
  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"
  const runningProvider = latestUsage?.provider ?? activeLlmProvider
  const runningModel = latestUsage?.model ?? activeLlmModel
  const runningLabel = `${runningProvider === "claude" ? "Claude" : runningProvider === "grok" ? "Grok" : runningProvider === "gemini" ? "Gemini" : "OpenAI"} - ${runningModel || "N/A"}`
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

              <div className="relative w-full min-h-32">
                <Composer
                  onSend={handleSend}
                  isStreaming={false}
                disabled={!connected}
                isMuted={isMuted}
                onToggleMute={handleMuteToggle}
                muteHydrated={muteHydrated}
              />
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

                <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto no-scrollbar space-y-1.5 px-1 py-1">
                  {missions.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-40" : "text-slate-500")}>
                      No missions yet. Add one in Mission Settings.
                    </p>
                  )}
                  {missions.map((mission) => (
                    <div key={mission.id} className={cn(`${subPanelClass} p-2 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover mission-spotlight-card`, missionHover)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[13px] leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{mission.title}</p>
                        <div className="flex items-center gap-1 flex-nowrap shrink-0">
                          <span
                            className={cn(
                              "text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap",
                              mission.enabledCount > 0
                                ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                                : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                            )}
                          >
                            {mission.enabledCount > 0 ? "Active" : "Paused"}
                          </span>
                          <span
                            title={`Priority: ${mission.priority}`}
                            aria-label={`Priority ${mission.priority}`}
                            className={cn(
                              "h-2.5 w-2.5 rounded-full shrink-0",
                              mission.priority === "low" && "bg-emerald-400",
                              mission.priority === "medium" && "bg-amber-400",
                              mission.priority === "high" && "bg-orange-400",
                              mission.priority === "critical" && "bg-rose-400",
                            )}
                          />
                        </div>
                      </div>
                      {mission.description ? (
                        <p className={cn("mt-0.5 text-[11px] leading-4 line-clamp-2", isLight ? "text-s-60" : "text-slate-400")}>{mission.description}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {mission.times.map((time, index) => (
                          <span key={`${mission.id}-${time}-${index}`} className={cn("text-[10px] px-1.5 py-0.5 rounded-md border", isLight ? "border-[#d6deea] bg-[#edf2fb] text-s-70" : "border-white/10 bg-white/[0.04] text-slate-300")}>
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
                        integrationBadgeClass(telegramConnected),
                      )}
                      aria-label={telegramConnected ? "Disable Telegram integration" : "Enable Telegram integration"}
                      title={telegramConnected ? "Telegram connected (click to disable)" : "Telegram disconnected (click to enable)"}
                    >
                      <TelegramIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleDiscordIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(discordConnected),
                      )}
                      aria-label={discordConnected ? "Disable Discord integration" : "Enable Discord integration"}
                      title={discordConnected ? "Discord connected (click to disable)" : "Discord disconnected (click to enable)"}
                    >
                      <DiscordIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleToggleOpenAIIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(openaiConnected),
                      )}
                      aria-label={openaiConnected ? "Disable OpenAI integration" : "Enable OpenAI integration"}
                      title={openaiConnected ? "OpenAI connected (click to disable)" : "OpenAI disconnected (click to enable)"}
                    >
                      <OpenAIIcon className="w-[18px] h-[18px]" />
                    </button>
                    <button
                      onClick={handleToggleClaudeIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(claudeConnected),
                      )}
                      aria-label={claudeConnected ? "Disable Claude integration" : "Enable Claude integration"}
                      title={claudeConnected ? "Claude connected (click to disable)" : "Claude disconnected (click to enable)"}
                    >
                      <ClaudeIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleToggleGrokIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(grokConnected),
                      )}
                      aria-label={grokConnected ? "Disable Grok integration" : "Enable Grok integration"}
                      title={grokConnected ? "Grok connected (click to disable)" : "Grok disconnected (click to enable)"}
                    >
                      <XAIIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGeminiIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(geminiConnected),
                      )}
                      aria-label={geminiConnected ? "Disable Gemini integration" : "Enable Gemini integration"}
                      title={geminiConnected ? "Gemini connected (click to disable)" : "Gemini disconnected (click to enable)"}
                    >
                      <GeminiIcon size={16} />
                    </button>
                    <button
                      onClick={handleToggleGmailIntegration}
                      className={cn(
                        "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                        integrationBadgeClass(gmailConnected),
                      )}
                      aria-label={gmailConnected ? "Disable Gmail integration" : "Enable Gmail integration"}
                      title={gmailConnected ? "Gmail connected (click to disable)" : "Gmail disconnected (click to enable)"}
                    >
                      <GmailIcon className="w-[14px] h-[14px]" />
                    </button>
                    {Array.from({ length: 17 }).map((_, index) => (
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
