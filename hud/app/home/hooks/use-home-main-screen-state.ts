"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "@/lib/context/theme-context"
import { loadUserSettings, normalizeResponseTone } from "@/lib/settings/userSettings"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { pickGreetingForTone } from "../constants"
import { useHomeConversations } from "./use-home-conversations"
import { useHomeDevTools } from "./use-home-dev-tools"
import { useHomeIntegrations } from "./use-home-integrations"
import { useHomeCryptoMarket } from "./use-home-crypto-market"
import { useHomeDayInHistory } from "./use-home-day-in-history"
import { useHomeNewsFeed } from "./use-home-news-feed"
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

  const speakTts = useCallback((text: string) => {
    const settings = loadUserSettings()
    if (!settings.app.voiceEnabled) return
    sendGreeting(text, settings.app.ttsVoice, settings.app.voiceEnabled, settings.personalization.assistantName)
  }, [sendGreeting])

  const integrations = useHomeIntegrations({ latestUsage, speakTts })
  const cryptoMarket = useHomeCryptoMarket()
  const devTools = useHomeDevTools()
  const dayInHistory = useHomeDayInHistory()
  const newsFeed = useHomeNewsFeed({ enabled: integrations.newsConnected })
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
    setMuted(nextMuted, !nextMuted ? visuals.assistantName : undefined)
  }, [isMuted, setMuted, visuals.assistantName])

  useEffect(() => {
    if (connected && muteHydrated) {
      setMuted(isMuted, !isMuted ? visuals.assistantName : undefined)
    }
  }, [connected, isMuted, muteHydrated, setMuted, visuals.assistantName])

  useEffect(() => {
    if (!connected || greetingSentRef.current) return

    greetingSentRef.current = true
    const settings = loadUserSettings()
    setVoicePreference(
      settings.app.ttsVoice,
      settings.app.voiceEnabled,
      settings.personalization.assistantName,
    )
    if (!settings.app.voiceEnabled) return

    const now = Date.now()
    const lastGreetingAt = Number(localStorage.getItem("nova-last-greeting-at") || "0")
    if (Number.isFinite(lastGreetingAt) && now - lastGreetingAt < GREETING_COOLDOWN_MS) return

    const greeting = pickGreetingForTone(normalizeResponseTone(settings.personalization?.tone))
    const timer = window.setTimeout(() => {
      localStorage.setItem("nova-last-greeting-at", String(Date.now()))
      sendGreeting(
        greeting,
        settings.app.ttsVoice,
        settings.app.voiceEnabled,
        settings.personalization.assistantName,
      )
    }, 1500)

    return () => window.clearTimeout(timer)
  }, [connected, sendGreeting, setVoicePreference])

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const handleSidebarToggle = useCallback(() => setSidebarOpen((prev) => !prev), [])

  const goToBootup = useCallback(() => router.push("/boot-right"), [router])
  const openMissions = useCallback(() => router.push("/missions"), [router])
  const openCalendar = useCallback(() => router.push("/missions/calendar"), [router])
  const openIntegrations = useCallback(() => router.push("/integrations"), [router])
  const openDevLogs = useCallback(() => router.push("/dev-logs"), [router])
  const openAgents = useCallback(() => router.push("/agents"), [router])

  const liveActivity = [
    { id: "evt-openai", service: "OpenAI", action: "Reasoning turn completed", timeAgo: "14s", status: "success" as const },
    { id: "evt-spotify", service: "Spotify", action: "Playback sync refreshed", timeAgo: "49s", status: "success" as const },
    { id: "evt-discord", service: "Discord", action: "Webhook retry succeeded", timeAgo: "2m", status: "warning" as const },
    { id: "evt-nova", service: "Nova Runtime", action: "Background task queued", timeAgo: "3m", status: "success" as const },
  ]

  return {
    isLight,
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
    assistantName: visuals.assistantName,
    orbPalette: visuals.orbPalette,
    welcomeMessage: visuals.welcomeMessage,
    handleSend: conversationState.handleSend,
    isMuted,
    handleMuteToggle,
    muteHydrated,
    homeShellRef: visuals.homeShellRef,
    pipelineSectionRef: visuals.pipelineSectionRef,
    scheduleSectionRef: visuals.scheduleSectionRef,
    analyticsSectionRef: visuals.analyticsSectionRef,
    devToolsSectionRef: visuals.devToolsSectionRef,
    integrationsSectionRef: visuals.integrationsSectionRef,
    spotifyModuleSectionRef: visuals.spotifyModuleSectionRef,
    newsModuleSectionRef: visuals.newsModuleSectionRef,
    agentModuleSectionRef: visuals.agentModuleSectionRef,
    panelStyle: visuals.panelStyle,
    panelClass: visuals.panelClass,
    subPanelClass: visuals.subPanelClass,
    missionHover: visuals.missionHover,
    missions: integrations.missions,
    cryptoAssets: cryptoMarket.cryptoAssets,
    cryptoRange: cryptoMarket.cryptoRange,
    setCryptoRange: cryptoMarket.setCryptoRange,
    cryptoLoading: cryptoMarket.cryptoLoading,
    cryptoError: cryptoMarket.cryptoError,
    refreshCryptoMarket: cryptoMarket.refreshCryptoMarket,
    openMissions,
    openCalendar,
    openIntegrations,
    openDevLogs,
    openAgents,
    liveActivity,
    devToolsMetrics: devTools.devToolsMetrics,
    integrationBadgeClass: integrations.integrationBadgeClass,
    goToIntegrations: integrations.goToIntegrations,
    telegramConnected: integrations.telegramConnected,
    discordConnected: integrations.discordConnected,
    braveConnected: integrations.braveConnected,
    newsConnected: integrations.newsConnected,
    coinbaseConnected: integrations.coinbaseConnected,
    openaiConnected: integrations.openaiConnected,
    claudeConnected: integrations.claudeConnected,
    grokConnected: integrations.grokConnected,
    geminiConnected: integrations.geminiConnected,
    spotifyConnected: integrations.spotifyConnected,
    spotifyNowPlaying: integrations.spotifyNowPlaying,
    spotifyLoading: integrations.spotifyLoading,
    spotifyError: integrations.spotifyError,
    spotifyBusyAction: integrations.spotifyBusyAction,
    refreshSpotifyNowPlaying: integrations.refreshSpotifyNowPlaying,
    toggleSpotifyPlayback: integrations.toggleSpotifyPlayback,
    spotifyNextTrack: integrations.spotifyNextTrack,
    spotifyPreviousTrack: integrations.spotifyPreviousTrack,
    spotifyPlaySmart: integrations.spotifyPlaySmart,
    seekSpotify: integrations.seekSpotify,
    gmailConnected: integrations.gmailConnected,
    gcalendarConnected: integrations.gcalendarConnected,
    newsTopics: newsFeed.newsTopics,
    selectedNewsTopic: newsFeed.selectedNewsTopic,
    setSelectedNewsTopic: newsFeed.setSelectedNewsTopic,
    newsArticles: newsFeed.newsArticles,
    newsLoading: newsFeed.newsLoading,
    newsError: newsFeed.newsError,
    newsStale: newsFeed.newsStale,
    newsFetchedAt: newsFeed.newsFetchedAt,
    refreshNewsFeed: newsFeed.refreshNewsFeed,
    dayInHistoryEvents: dayInHistory.events,
    dayInHistoryLoading: dayInHistory.loading,
    dayInHistoryError: dayInHistory.error,
  }
}
