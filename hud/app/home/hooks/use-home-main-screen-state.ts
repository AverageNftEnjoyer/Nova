"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getActiveUserId } from "@/lib/auth/active-user"
import { useTheme } from "@/lib/context/theme-context"
import { loadUserSettings, normalizeResponseTone } from "@/lib/settings/userSettings"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { pickGreetingForTone } from "../constants"
import { useHomeConversations } from "./use-home-conversations"
import { useHomeDevTools } from "./use-home-dev-tools"
import { useHomeIntegrations } from "./use-home-integrations"
import { useHomeCryptoMarket } from "./use-home-crypto-market"
import { useHomeNewsFeed } from "./use-home-news-feed"
import { useHomeVisuals } from "./use-home-visuals"
import { useHomeWeather } from "./use-home-weather"

const GREETING_COOLDOWN_MS = 60_000
const HOME_COMMAND_CONVERSATION_ID = "home-command-surface"

function buildHomeCommandSessionKey(userId: string): string {
  const normalizedUserId = String(userId || "").trim()
  if (!normalizedUserId) return ""
  return `agent:nova:hud:user:${normalizedUserId}:dm:${HOME_COMMAND_CONVERSATION_ID}`
}

export function useHomeMainScreenState() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"

  const {
    state: novaState,
    thinkingStatus,
    connected,
    sendToAgent,
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
  const newsFeed = useHomeNewsFeed({ enabled: integrations.newsConnected })
  const weather = useHomeWeather()
  const conversationState = useHomeConversations({ connected, agentMessages, clearAgentMessages })

  const latestHomeCommandReply = (() => {
    for (let idx = agentMessages.length - 1; idx >= 0; idx -= 1) {
      const message = agentMessages[idx]
      if (message.role !== "assistant") continue
      if (String(message.conversationId || "").trim() !== HOME_COMMAND_CONVERSATION_ID) continue
      const content = String(message.content || "").trim()
      if (!content) continue
      return {
        content,
        ts: Number.isFinite(Number(message.ts)) ? Number(message.ts) : 0,
      }
    }
    return null
  })()

  const handleSendHomeCommand = useCallback((finalText: string) => {
    const text = finalText.trim()
    if (!text || !connected) return

    const userId = String(getActiveUserId() || "").trim()
    if (!userId) return

    const settings = loadUserSettings()
    const sessionKey = buildHomeCommandSessionKey(userId)

    sendToAgent(text, settings.app.voiceEnabled, settings.app.ttsVoice, {
      conversationId: HOME_COMMAND_CONVERSATION_ID,
      sender: "hud-user",
      ...(sessionKey ? { sessionKey } : {}),
      userId,
      assistantName: settings.personalization.assistantName,
      communicationStyle: settings.personalization.communicationStyle,
      tone: settings.personalization.tone,
      customInstructions: settings.personalization.customInstructions,
      proactivity: settings.personalization.proactivity,
      humor_level: settings.personalization.humor_level,
      risk_tolerance: settings.personalization.risk_tolerance,
      structure_preference: settings.personalization.structure_preference,
      challenge_level: settings.personalization.challenge_level,
    })
  }, [connected, sendToAgent])

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
  const openChat = useCallback(() => router.push("/chat"), [router])

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
    handleSendToChat: conversationState.handleSendToChat,
    handleSendHomeCommand,
    isMuted,
    handleMuteToggle,
    muteHydrated,
    thinkingStatus,
    latestHomeCommandReply: latestHomeCommandReply?.content || "",
    latestHomeCommandReplyTs: latestHomeCommandReply?.ts || 0,
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
    openChat,
    liveActivity,
    devToolsMetrics: devTools.devToolsMetrics,
    integrationBadgeClass: integrations.integrationBadgeClass,
    goToIntegrations: integrations.goToIntegrations,
    telegramConnected: integrations.telegramConnected,
    discordConnected: integrations.discordConnected,
    slackConnected: integrations.slackConnected,
    braveConnected: integrations.braveConnected,
    newsConnected: integrations.newsConnected,
    coinbaseConnected: integrations.coinbaseConnected,
    phantomConnected: integrations.phantomConnected,
    polymarketConnected: integrations.polymarketConnected,
    openaiConnected: integrations.openaiConnected,
    claudeConnected: integrations.claudeConnected,
    grokConnected: integrations.grokConnected,
    geminiConnected: integrations.geminiConnected,
    spotifyConnected: integrations.spotifyConnected,
    youtubeConnected: integrations.youtubeConnected,
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
    selectedNewsTopics: newsFeed.selectedNewsTopics,
    setSelectedNewsTopics: newsFeed.setSelectedNewsTopics,
    newsArticles: newsFeed.newsArticles,
    newsLoading: newsFeed.newsLoading,
    newsError: newsFeed.newsError,
    newsStale: newsFeed.newsStale,
    newsFetchedAt: newsFeed.newsFetchedAt,
    refreshNewsFeed: newsFeed.refreshNewsFeed,
    preferredWeatherCity: weather.preferredCity,
    homeWeather: weather.weather,
    homeWeatherLoading: weather.weatherLoading,
    homeWeatherError: weather.weatherError,
    refreshHomeWeather: weather.refreshWeather,
  }
}
