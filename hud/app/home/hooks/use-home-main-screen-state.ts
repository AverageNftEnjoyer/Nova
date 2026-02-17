"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "@/lib/theme-context"
import { loadUserSettings } from "@/lib/userSettings"
import { useNovaState } from "@/lib/useNovaState"
import { GREETINGS } from "../constants"
import { useHomeConversations } from "./use-home-conversations"
import { useHomeIntegrations } from "./use-home-integrations"
import { useHomeVisuals } from "./use-home-visuals"

const GREETING_COOLDOWN_MS = 60_000

export function useHomeMainScreenState() {
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

  const visuals = useHomeVisuals({ isLight })
  const integrations = useHomeIntegrations({ latestUsage })
  const conversationState = useHomeConversations({ connected, agentMessages, clearAgentMessages })

  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const greetingSentRef = useRef(false)

  useLayoutEffect(() => {
    const storedMuted = localStorage.getItem("nova-muted")
    const muted = storedMuted === null ? true : storedMuted === "true"
    setIsMuted(muted)
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    if (novaState === "muted") {
      setIsMuted(true)
    }
  }, [novaState])

  const handleMuteToggle = useCallback(() => {
    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    localStorage.setItem("nova-muted", String(nextMuted))
    setMuted(nextMuted)
  }, [isMuted, setMuted])

  useEffect(() => {
    if (connected && muteHydrated) {
      setMuted(isMuted)
    }
  }, [connected, isMuted, muteHydrated, setMuted])

  useEffect(() => {
    if (!connected || greetingSentRef.current) return

    greetingSentRef.current = true
    const settings = loadUserSettings()
    setVoicePreference(settings.app.ttsVoice, settings.app.voiceEnabled)
    if (!settings.app.voiceEnabled) return

    const now = Date.now()
    const lastGreetingAt = Number(localStorage.getItem("nova-last-greeting-at") || "0")
    if (Number.isFinite(lastGreetingAt) && now - lastGreetingAt < GREETING_COOLDOWN_MS) return

    const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
    const timer = window.setTimeout(() => {
      localStorage.setItem("nova-last-greeting-at", String(Date.now()))
      sendGreeting(greeting, settings.app.ttsVoice, settings.app.voiceEnabled)
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [connected, sendGreeting, setVoicePreference])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const handleSidebarToggle = useCallback(() => setSidebarOpen((prev) => !prev), [])

  const goToBootup = useCallback(() => router.push("/boot-right"), [router])
  const openMissions = useCallback(() => router.push("/missions"), [router])
  const openIntegrations = useCallback(() => router.push("/integrations"), [router])

  return {
    isLight,
    background: visuals.background,
    backgroundVideoUrl: visuals.backgroundVideoUrl,
    backgroundMediaIsImage: visuals.backgroundMediaIsImage,
    conversations: conversationState.conversations,
    sidebarOpen,
    toggleSidebar: handleSidebarToggle,
    runningLabel: integrations.runningLabel,
    handleSelectConvo: conversationState.handleSelectConvo,
    handleNewChat: conversationState.handleNewChat,
    handleDeleteConvo: conversationState.handleDeleteConvo,
    handleRenameConvo: conversationState.handleRenameConvo,
    handleArchiveConvo: conversationState.handleArchiveConvo,
    handlePinConvo: conversationState.handlePinConvo,
    goToBootup,
    novaState,
    connected,
    hasAnimated: visuals.hasAnimated,
    orbPalette: visuals.orbPalette,
    welcomeMessage: visuals.welcomeMessage,
    handleSend: conversationState.handleSend,
    isMuted,
    handleMuteToggle,
    muteHydrated,
    pipelineSectionRef: visuals.pipelineSectionRef,
    integrationsSectionRef: visuals.integrationsSectionRef,
    panelStyle: visuals.panelStyle,
    panelClass: visuals.panelClass,
    subPanelClass: visuals.subPanelClass,
    missionHover: visuals.missionHover,
    missions: integrations.missions,
    openMissions,
    openIntegrations,
    handleToggleTelegramIntegration: integrations.handleToggleTelegramIntegration,
    handleToggleDiscordIntegration: integrations.handleToggleDiscordIntegration,
    handleToggleBraveIntegration: integrations.handleToggleBraveIntegration,
    handleToggleOpenAIIntegration: integrations.handleToggleOpenAIIntegration,
    handleToggleClaudeIntegration: integrations.handleToggleClaudeIntegration,
    handleToggleGrokIntegration: integrations.handleToggleGrokIntegration,
    handleToggleGeminiIntegration: integrations.handleToggleGeminiIntegration,
    handleToggleGmailIntegration: integrations.handleToggleGmailIntegration,
    integrationBadgeClass: integrations.integrationBadgeClass,
    telegramConnected: integrations.telegramConnected,
    discordConnected: integrations.discordConnected,
    braveConnected: integrations.braveConnected,
    openaiConnected: integrations.openaiConnected,
    claudeConnected: integrations.claudeConnected,
    grokConnected: integrations.grokConnected,
    geminiConnected: integrations.geminiConnected,
    gmailConnected: integrations.gmailConnected,
    floatingLinesGradient: visuals.floatingLinesGradient,
  }
}
