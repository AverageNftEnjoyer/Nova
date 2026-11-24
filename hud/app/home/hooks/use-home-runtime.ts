"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { readVoiceMuted } from "@/lib/chat/voice-mode"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { useHomeConversations } from "./use-home-conversations"

/**
 * Home's runtime connection. Mounting useNovaState here keeps what Home relied on before: agent-task budget events
 * reach useAgentTasks (useNovaState re-dispatches them as window events), the saved voice preference and mute state
 * sync once per connection, and a voice conversation started while Home is open is handed to /chat.
 */
export function useHomeRuntime() {
  const nova = useNovaState()
  const { state: novaState, connected, setVoicePreference, setMuted, agentMessages, clearAgentMessages } = nova

  const [assistantName, setAssistantName] = useState("Nova")
  useEffect(() => {
    const sync = () => setAssistantName(String(loadUserSettings().personalization?.assistantName || "").trim() || "Nova")
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  const [isMuted, setIsMuted] = useState(true)
  const [muteHydrated, setMuteHydrated] = useState(false)
  const voicePreferenceSyncedRef = useRef(false)

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the mute flag lives in localStorage (client only)
    setIsMuted(readVoiceMuted())
    setMuteHydrated(true)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the runtime's muted state
    if (novaState === "muted") setIsMuted(true)
  }, [novaState])

  useEffect(() => {
    if (connected && muteHydrated) setMuted(isMuted, !isMuted ? assistantName : undefined)
  }, [connected, isMuted, muteHydrated, setMuted, assistantName])

  // Home never speaks on its own: no greeting; it only sends the saved voice preference once per connection.
  useEffect(() => {
    if (!connected || voicePreferenceSyncedRef.current) return
    voicePreferenceSyncedRef.current = true
    const settings = loadUserSettings()
    setVoicePreference(settings.app.ttsVoice, settings.app.voiceEnabled, settings.personalization.assistantName)
  }, [connected, setVoicePreference])

  const { conversations } = useHomeConversations({ agentMessages, clearAgentMessages })

  return { connected, conversations }
}
