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
  const analyticsSectionRef = useRef<HTMLElement | null>(null)
  const devToolsSectionRef = useRef<HTMLElement | null>(null)
  const integrationsSectionRef = useRef<HTMLElement | null>(null)

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
    if (analyticsSectionRef.current) cleanups.push(setupSectionSpotlight(analyticsSectionRef.current))
    if (devToolsSectionRef.current) cleanups.push(setupSectionSpotlight(devToolsSectionRef.current))
    if (integrationsSectionRef.current) cleanups.push(setupSectionSpotlight(integrationsSectionRef.current))

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [spotlightEnabled])

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
    analyticsSectionRef,
    devToolsSectionRef,
    integrationsSectionRef,
  }
}
