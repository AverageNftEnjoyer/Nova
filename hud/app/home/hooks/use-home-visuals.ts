"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  loadUserSettings,
  normalizeResponseTone,
  ORB_COLORS,
  type OrbColor,
  type ResponseTone,
  USER_SETTINGS_UPDATED_EVENT,
} from "@/lib/settings/userSettings"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { useSpotlightEffect } from "@/app/integrations/hooks"
import { GREETINGS_BY_TONE, pickGreetingForTone } from "../constants"

interface UseHomeVisualsInput {
  isLight: boolean
}

export function useHomeVisuals({ isLight }: UseHomeVisualsInput) {
  const [hasAnimated, setHasAnimated] = useState(false)
  const [tone, setTone] = useState<ResponseTone>("neutral")
  const [welcomeMessage, setWelcomeMessage] = useState(GREETINGS_BY_TONE.neutral[0])
  const [assistantName, setAssistantName] = useState("Nova")
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)

  const pipelineSectionRef = useRef<HTMLElement | null>(null)
  const scheduleSectionRef = useRef<HTMLElement | null>(null)
  const analyticsSectionRef = useRef<HTMLElement | null>(null)
  const devToolsSectionRef = useRef<HTMLElement | null>(null)
  const integrationsSectionRef = useRef<HTMLElement | null>(null)
  const spotifyModuleSectionRef = useRef<HTMLElement | null>(null)
  const agentModuleSectionRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const settings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? settings.app.orbColor
    const nextSpotlight = cached.spotlightEnabled ?? (settings.app.spotlightEnabled ?? true)
    const nextAssistantName = String(settings.personalization?.assistantName || "").trim() || "Nova"
    const nextTone = normalizeResponseTone(settings.personalization?.tone)
    setOrbColor(nextOrbColor)
    setSpotlightEnabled(nextSpotlight)
    setAssistantName(nextAssistantName)
    setTone(nextTone)
    setWelcomeMessage(pickGreetingForTone(nextTone))
    writeShellUiCache({
      orbColor: nextOrbColor,
      spotlightEnabled: nextSpotlight,
    })
  }, [isLight])

  useEffect(() => {
    const sync = window.setTimeout(() => {
      const shouldAnimateIntro = sessionStorage.getItem("nova-home-intro-pending") === "true"
      if (shouldAnimateIntro) {
        sessionStorage.removeItem("nova-home-intro-pending")
        setHasAnimated(true)
      }
    }, 0)

    return () => window.clearTimeout(sync)
  }, [tone])

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setOrbColor(settings.app.orbColor)
      setSpotlightEnabled(settings.app.spotlightEnabled ?? true)
      setAssistantName(String(settings.personalization?.assistantName || "").trim() || "Nova")
      const nextTone = normalizeResponseTone(settings.personalization?.tone)
      setTone(nextTone)
      setWelcomeMessage(pickGreetingForTone(nextTone))
      writeShellUiCache({
        orbColor: settings.app.orbColor,
        spotlightEnabled: settings.app.spotlightEnabled ?? true,
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [isLight])

  useSpotlightEffect(
    spotlightEnabled,
    [
      { ref: pipelineSectionRef },
      { ref: scheduleSectionRef },
      { ref: analyticsSectionRef },
      { ref: devToolsSectionRef },
      { ref: integrationsSectionRef },
      { ref: spotifyModuleSectionRef },
      { ref: agentModuleSectionRef },
    ],
    [isLight],
  )

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
    : ""
  const orbPalette = ORB_COLORS[orbColor]

  return {
    hasAnimated,
    welcomeMessage,
    assistantName,
    panelClass,
    panelStyle,
    subPanelClass,
    missionHover,
    orbPalette,
    pipelineSectionRef,
    scheduleSectionRef,
    analyticsSectionRef,
    devToolsSectionRef,
    integrationsSectionRef,
    spotifyModuleSectionRef,
    agentModuleSectionRef,
  }
}
