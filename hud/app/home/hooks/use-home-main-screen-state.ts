"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "@/lib/context/theme-context"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { readVoiceMuted } from "@/lib/chat/voice-mode"
import { useHomeConversations } from "./use-home-conversations"
import { useHomeIntegrations } from "./use-home-integrations"
import { useHomeCryptoMarket } from "./use-home-crypto-market"
import { useHomeWeather } from "./use-home-weather"

export function useHomeMainScreenState() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"

  const nova = useNovaState()
  const {
    state: novaState,
    connected,
    sendGreeting,
    setVoicePreference,
    setMuted,
    agentMessages,
    latestUsage,
    clearAgentMessages,
  } = nova

  const [assistantName, setAssistantName] = useState("U.B Agents")
  useEffect(() => {
    const sync = () => setAssistantName(String(loadUserSettings().personalization?.assistantName || "").trim() || "U.B Agents")
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  const speakTts = useCallback((text: string) => {
    // Voice mode is opt-in: never speak while muted.
    if (readVoiceMuted()) return
    const settings = loadUserSettings()
    if (!settings.app.voiceEnabled) return
    // `sendGreeting` is useNovaState's legacy name: it is the generic spoken-TTS announcement sender.
    sendGreeting(text, settings.app.ttsVoice, settings.app.voiceEnabled, settings.personalization.assistantName)
  }, [sendGreeting])

  const integrations = useHomeIntegrations({ latestUsage, speakTts })
  const cryptoMarket = useHomeCryptoMarket()
  const weather = useHomeWeather()
  const conversationState = useHomeConversations({ connected, agentMessages, clearAgentMessages })

  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const voicePreferenceSyncedRef = useRef(false)

  useLayoutEffect(() => {
    setIsMuted(readVoiceMuted())
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    if (novaState === "muted") {
      setIsMuted(true)
    }
  }, [novaState])

  useEffect(() => {
    if (connected && muteHydrated) {
      setMuted(isMuted, !isMuted ? assistantName : undefined)
    }
  }, [connected, isMuted, muteHydrated, setMuted, assistantName])

  // Sync the saved voice preference once per connection. The home screen never speaks on its own:
  // there is no auto-greeting, and spoken replies only happen in voice mode (see speakTts).
  useEffect(() => {
    if (!connected || voicePreferenceSyncedRef.current) return

    voicePreferenceSyncedRef.current = true
    const settings = loadUserSettings()
    setVoicePreference(
      settings.app.ttsVoice,
      settings.app.voiceEnabled,
      settings.personalization.assistantName,
    )
  }, [connected, setVoicePreference])

  const openMissions = useCallback(() => router.push("/deployments"), [router])
  const openCalendar = useCallback(() => router.push("/missions/calendar"), [router])
  const openIntegrations = useCallback(() => router.push("/integrations"), [router])
  const openDevLogs = useCallback(() => router.push("/dev-logs"), [router])
  const openChat = useCallback(() => router.push("/chat"), [router])
  const openAnalytics = useCallback(() => router.push("/analytics"), [router])

  return {
    isLight,
    conversations: conversationState.conversations,
    handleSelectConvo: conversationState.handleSelectConvo,
    handleNewChat: conversationState.handleNewChat,
    handleDeleteConvo: conversationState.handleDeleteConvo,
    handleRenameConvo: conversationState.handleRenameConvo,
    handleArchiveConvo: conversationState.handleArchiveConvo,
    novaState,
    connected,
    assistantName,
    muteHydrated,
    cryptoAssets: cryptoMarket.cryptoAssets,
    cryptoRange: cryptoMarket.cryptoRange,
    setCryptoRange: cryptoMarket.setCryptoRange,
    openMissions,
    nova,
    openCalendar,
    openIntegrations,
    openDevLogs,
    openChat,
    openAnalytics,
    goToIntegrations: integrations.goToIntegrations,
    telegramConnected: integrations.telegramConnected,
    discordConnected: integrations.discordConnected,
    slackConnected: integrations.slackConnected,
    braveConnected: integrations.braveConnected,
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
    spotifyConnecting: integrations.spotifyConnecting,
    spotifyError: integrations.spotifyError,
    spotifyBusyAction: integrations.spotifyBusyAction,
    connectSpotify: integrations.connectSpotify,
    toggleSpotifyPlayback: integrations.toggleSpotifyPlayback,
    spotifyNextTrack: integrations.spotifyNextTrack,
    spotifyPreviousTrack: integrations.spotifyPreviousTrack,
    spotifyPlaySmart: integrations.spotifyPlaySmart,
    seekSpotify: integrations.seekSpotify,
    gmailConnected: integrations.gmailConnected,
    gcalendarConnected: integrations.gcalendarConnected,
    preferredWeatherCity: weather.preferredCity,
    homeWeather: weather.weather,
    homeWeatherLoading: weather.weatherLoading,
    homeWeatherError: weather.weatherError,
    refreshHomeWeather: weather.refreshWeather,
  }
}
