"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
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

function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `${r}, ${g}, ${b}`
}

export function useHomeVisuals({ isLight }: UseHomeVisualsInput) {
  const [hasAnimated, setHasAnimated] = useState(false)
  const [tone, setTone] = useState<ResponseTone>("neutral")
  const [welcomeMessage, setWelcomeMessage] = useState(GREETINGS_BY_TONE.neutral[0])
  const [assistantName, setAssistantName] = useState("Nova")
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)

  const homeShellRef = useRef<HTMLDivElement | null>(null)
  const pipelineSectionRef = useRef<HTMLElement | null>(null)
  const scheduleSectionRef = useRef<HTMLElement | null>(null)
  const analyticsSectionRef = useRef<HTMLElement | null>(null)
  const devToolsSectionRef = useRef<HTMLElement | null>(null)
  const integrationsSectionRef = useRef<HTMLElement | null>(null)
  const spotifyModuleSectionRef = useRef<HTMLElement | null>(null)
  const newsModuleSectionRef = useRef<HTMLElement | null>(null)
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
      { ref: homeShellRef, showSpotlightCore: false, enableParticles: false, directHoverOnly: true },
    ],
    [isLight],
  )

  const orbPalette = ORB_COLORS[orbColor]
  const panelStyle = {
    "--home-orb-rgb-primary": hexToRgbTriplet(orbPalette.circle1),
    "--home-orb-rgb-secondary": hexToRgbTriplet(orbPalette.circle2),
    "--home-orb-rgb-bg": hexToRgbTriplet(orbPalette.bg),
  } as CSSProperties
  const panelClass =
    isLight
      ? "home-module-surface home-module-surface--light rounded-md border border-[#d9e0ea] bg-white shadow-none"
      : "home-module-surface rounded-md border backdrop-blur-xl"
  const subPanelClass = isLight
    ? "rounded-sm border border-[#d5dce8] bg-[#f4f7fd]"
    : "home-subpanel-surface rounded-sm border backdrop-blur-md"
  const missionHover = isLight
    ? "hover:bg-[#eef3fb] hover:border-[#d5dce8]"
    : ""

  return {
    hasAnimated,
    welcomeMessage,
    assistantName,
    panelClass,
    panelStyle,
    subPanelClass,
    missionHover,
    orbPalette,
    homeShellRef,
    pipelineSectionRef,
    scheduleSectionRef,
    analyticsSectionRef,
    devToolsSectionRef,
    integrationsSectionRef,
    spotifyModuleSectionRef,
    newsModuleSectionRef,
    agentModuleSectionRef,
  }
}
