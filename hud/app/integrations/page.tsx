"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Blocks, Save, Send, Eye, EyeOff } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type BackgroundType, type OrbColor } from "@/lib/userSettings"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations"
import { ChatSidebar } from "@/components/chat-sidebar"
import { useNovaState } from "@/lib/useNovaState"
import {
  loadConversations,
  saveConversations,
  setActiveId,
  type Conversation,
} from "@/lib/conversations"
import FloatingLines from "@/components/FloatingLines"
import { DiscordIcon } from "@/components/discord-icon"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import "@/components/FloatingLines.css"

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }
const INITIAL_INTEGRATIONS_SETTINGS: IntegrationsSettings = {
  telegram: {
    connected: true,
    botToken: "",
    chatIds: "",
  },
  discord: {
    connected: false,
    webhookUrls: "",
  },
  updatedAt: "",
}

export default function IntegrationsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [settings, setSettings] = useState<IntegrationsSettings>(INITIAL_INTEGRATIONS_SETTINGS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [botToken, setBotToken] = useState("")
  const [chatIds, setChatIds] = useState("")
  const [discordWebhookUrls, setDiscordWebhookUrls] = useState("")
  const [showBotToken, setShowBotToken] = useState(false)
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<BackgroundType>("default")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [activeSetup, setActiveSetup] = useState<"telegram" | "discord">("telegram")
  const [isSavingTarget, setIsSavingTarget] = useState<null | "telegram" | "discord">(null)
  const [saveStatus, setSaveStatus] = useState<null | { type: "success" | "error"; message: string }>(null)
  const connectivitySectionRef = useRef<HTMLElement | null>(null)
  const telegramSetupSectionRef = useRef<HTMLElement | null>(null)
  const discordSetupSectionRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const local = loadIntegrationsSettings()
    setSettings(local)
    setBotToken(local.telegram.botToken)
    setChatIds(local.telegram.chatIds)
    setDiscordWebhookUrls(local.discord.webhookUrls)

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
  }, [])

  useEffect(() => {
    let cancelled = false

    fetch("/api/integrations/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const config = data?.config as IntegrationsSettings | undefined
        if (!config) {
          const fallback = loadIntegrationsSettings()
          setSettings(fallback)
          setBotToken(fallback.telegram.botToken)
          setChatIds(fallback.telegram.chatIds)
          return
        }
        const normalized: IntegrationsSettings = {
          telegram: {
            connected: Boolean(config.telegram?.connected),
            botToken: config.telegram?.botToken || "",
            chatIds: Array.isArray(config.telegram?.chatIds)
              ? config.telegram.chatIds.join(",")
              : typeof config.telegram?.chatIds === "string"
                ? config.telegram.chatIds
                : "",
          },
          discord: {
            connected: Boolean(config.discord?.connected),
            webhookUrls: Array.isArray(config.discord?.webhookUrls)
              ? config.discord.webhookUrls.join(",")
              : typeof config.discord?.webhookUrls === "string"
                ? config.discord.webhookUrls
                : "",
          },
          updatedAt: config.updatedAt || new Date().toISOString(),
        }
        setSettings(normalized)
        setBotToken(normalized.telegram.botToken)
        setChatIds(normalized.telegram.chatIds)
        setDiscordWebhookUrls(normalized.discord.webhookUrls)
        saveIntegrationsSettings(normalized)
      })
      .catch(() => {
        if (cancelled) return
        const fallback = loadIntegrationsSettings()
        setSettings(fallback)
        setBotToken(fallback.telegram.botToken)
        setChatIds(fallback.telegram.chatIds)
        setDiscordWebhookUrls(fallback.discord.webhookUrls)
      })

    return () => {
      cancelled = true
    }
  }, [])

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
    if (connectivitySectionRef.current) cleanups.push(setupSectionSpotlight(connectivitySectionRef.current))
    if (telegramSetupSectionRef.current) cleanups.push(setupSectionSpotlight(telegramSetupSectionRef.current))
    if (discordSetupSectionRef.current) cleanups.push(setupSectionSpotlight(discordSetupSectionRef.current))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [spotlightEnabled])

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

  const toggleTelegram = useCallback(async () => {
    const next = {
      ...settings,
      telegram: {
        ...settings.telegram,
        connected: !settings.telegram.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("telegram")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram: { connected: next.telegram.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Telegram status")
      setSaveStatus({
        type: "success",
        message: `Telegram ${next.telegram.connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Telegram status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const toggleDiscord = useCallback(async () => {
    const next = {
      ...settings,
      discord: {
        ...settings.discord,
        connected: !settings.discord.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("discord")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord: { connected: next.discord.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Discord status")
      setSaveStatus({
        type: "success",
        message: `Discord ${next.discord.connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Discord status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const saveTelegramConfig = useCallback(async () => {
    const next = {
      ...settings,
      telegram: {
        ...settings.telegram,
        botToken: botToken.trim(),
        chatIds: chatIds.trim(),
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("telegram")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram: {
            botToken: next.telegram.botToken,
            chatIds: next.telegram.chatIds,
          },
        }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Telegram configuration")

      const testRes = await fetch("/api/integrations/test-telegram", {
        method: "POST",
      })
      const testData = await testRes.json().catch(() => ({}))
      if (!testRes.ok || !testData?.ok) {
        const fallbackResultError =
          Array.isArray(testData?.results) && testData.results.length > 0
            ? testData.results.find((r: { ok?: boolean; error?: string }) => !r?.ok)?.error
            : undefined
        throw new Error(testData?.error || fallbackResultError || "Saved, but Telegram verification failed.")
      }

      setSaveStatus({
        type: "success",
        message: "Telegram saved and verified.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Telegram configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [botToken, chatIds, settings])

  const saveDiscordConfig = useCallback(async () => {
    const next = {
      ...settings,
      discord: {
        ...settings.discord,
        webhookUrls: discordWebhookUrls.trim(),
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("discord")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discord: {
            webhookUrls: next.discord.webhookUrls,
          },
        }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Discord configuration")

      const testRes = await fetch("/api/integrations/test-discord", {
        method: "POST",
      })
      const testData = await testRes.json().catch(() => ({}))
      if (!testRes.ok || !testData?.ok) {
        const fallbackResultError =
          Array.isArray(testData?.results) && testData.results.length > 0
            ? testData.results.find((r: { ok?: boolean; error?: string }) => !r?.ok)?.error
            : undefined
        throw new Error(testData?.error || fallbackResultError || "Saved, but Discord verification failed.")
      }

      setSaveStatus({
        type: "success",
        message: "Discord saved and verified.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Discord configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [discordWebhookUrls, settings])

  const persistConversations = useCallback((next: Conversation[]) => {
    setConversations(next)
    saveConversations(next)
    writeShellUiCache({ conversations: next })
  }, [])

  const handleSelectConvo = useCallback(
    (id: string) => {
      setActiveId(id)
      router.push("/chat")
    },
    [router],
  )

  const handleNewChat = useCallback(() => {
    router.push("/home")
  }, [router])

  const handleDeleteConvo = useCallback(
    (id: string) => {
      persistConversations(conversations.filter((c) => c.id !== id))
    },
    [conversations, persistConversations],
  )

  const handleRenameConvo = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const next = conversations.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: new Date().toISOString() } : c,
      )
      persistConversations(next)
    },
    [conversations, persistConversations],
  )

  const handleArchiveConvo = useCallback(
    (id: string, archived: boolean) => {
      const next = conversations.map((c) =>
        c.id === id ? { ...c, archived, updatedAt: new Date().toISOString() } : c,
      )
      persistConversations(next)
    },
    [conversations, persistConversations],
  )

  const handlePinConvo = useCallback(
    (id: string, pinned: boolean) => {
      const next = conversations.map((c) => (c.id === id ? { ...c, pinned } : c))
      persistConversations(next)
    },
    [conversations, persistConversations],
  )

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

      <div
        className="relative z-10 flex-1 h-dvh overflow-y-auto transition-all duration-200"
      >
      <div className="mx-auto flex min-h-full w-full items-center justify-center px-4 py-6 sm:px-6">
        <div className="w-full">
          <div className="mb-5 flex items-center justify-center">
            <h1 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Integrations</h1>
          </div>

          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section ref={connectivitySectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4`}>
            <div className="flex items-center gap-2 text-s-80">
              <Blocks className="w-4 h-4 text-accent" />
              <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Nova Integrations</h2>
            </div>
            <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>

            <div className={cn("mt-3 p-2 rounded-lg", subPanelClass)}>
              <div className="grid grid-cols-6 gap-1">
                <button
                  onClick={() => setActiveSetup("telegram")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                    settings.telegram.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "telegram" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Telegram setup"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveSetup("discord")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                    settings.discord.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "discord" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Discord setup"
                >
                  <DiscordIcon className="w-3.5 h-3.5 text-white" />
                </button>
                {Array.from({ length: 22 }).map((_, index) => (
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

            <div className="mt-2 flex items-center gap-2">
              <div
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  settings.telegram.connected
                    ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                    : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                )}
              >
                Telegram: {settings.telegram.connected ? "Connected" : "Disabled"}
              </div>
              <div
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  settings.discord.connected
                    ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                    : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                )}
              >
                Discord: {settings.discord.connected ? "Connected" : "Disabled"}
              </div>
            </div>
          </section>

          <div className="space-y-4">
            <div className="min-h-8">
              {saveStatus && (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    saveStatus.type === "success"
                      ? isLight
                        ? "border-emerald-300/40 bg-emerald-500/12 text-emerald-700"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                      : isLight
                        ? "border-rose-300/40 bg-rose-500/12 text-rose-700"
                        : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                  )}
                >
                  {saveStatus.message}
                </div>
              )}
            </div>

            {activeSetup === "telegram" && (
            <section ref={telegramSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 h-[620px] flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Telegram Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Telegram credentials and destination IDs for workflows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleTelegram}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.telegram.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.telegram.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveTelegramConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "telegram" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Bot Token</p>
                  <div className="relative">
                    <input
                      type={showBotToken ? "text" : "password"}
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder="1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowBotToken((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showBotToken ? "Hide token" : "Show token"}
                      title={showBotToken ? "Hide token" : "Show token"}
                    >
                      {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Chat IDs</p>
                  <input
                    value={chatIds}
                    onChange={(e) => setChatIds(e.target.value)}
                    placeholder="123456789,-100987654321"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated IDs for multi-device delivery targets.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Bot Token</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open Telegram and message <span className="font-mono">@BotFather</span>.</li>
                        <li>2. Run <span className="font-mono">/newbot</span> (or <span className="font-mono">/token</span> for existing bot).</li>
                        <li>3. Copy the token and paste it into <span className="font-mono">Bot Token</span> above.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Chat ID</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open your bot chat, press <span className="font-mono">Start</span>, send <span className="font-mono">hello</span>.</li>
                        <li>2. Open <span className="font-mono">/getUpdates</span> with your bot token.</li>
                        <li>3. Copy <span className="font-mono">message.chat.id</span> into <span className="font-mono">Chat IDs</span>.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "discord" && (
            <section ref={discordSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 h-[620px] flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Discord Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Discord webhooks for mission and notification delivery.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleDiscord}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.discord.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.discord.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveDiscordConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "discord" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Webhook URLs</p>
                  <input
                    value={discordWebhookUrls}
                    onChange={(e) => setDiscordWebhookUrls(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/... , https://discord.com/api/webhooks/..."
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated webhook URLs for multi-channel delivery.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow home-spotlight-card--hover")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div
                    className={cn(
                      "rounded-md border p-2.5 home-spotlight-card home-border-glow home-spotlight-card--hover",
                      isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                    )}
                  >
                    <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Discord Webhook URL</p>
                    <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                      <li>1. Open Discord server settings and go to <span className="font-mono">Integrations</span> then <span className="font-mono">Webhooks</span>.</li>
                      <li>2. Create or select a webhook and copy its webhook URL.</li>
                      <li>3. Paste one or more URLs into <span className="font-mono">Webhook URLs</span>, then Save.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </section>
            )}
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  )
}
