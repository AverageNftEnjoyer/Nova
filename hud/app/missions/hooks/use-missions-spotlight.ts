"use client"

import { useEffect } from "react"
import type { RefObject } from "react"

interface UseMissionsSpotlightInput {
  spotlightEnabled: boolean
  builderOpen: boolean
  createSectionRef: RefObject<HTMLElement | null>
  listSectionRef: RefObject<HTMLElement | null>
  headerActionsRef: RefObject<HTMLDivElement | null>
  builderBodyRef: RefObject<HTMLDivElement | null>
  builderFooterRef: RefObject<HTMLDivElement | null>
  loading?: boolean
}

export function useMissionsSpotlight({
  spotlightEnabled,
  builderOpen,
  createSectionRef,
  listSectionRef,
  headerActionsRef,
  builderBodyRef,
  builderFooterRef,
  loading,
}: UseMissionsSpotlightInput) {
  useEffect(() => {
    if (!spotlightEnabled) return
    if (loading) return

    const setupSectionSpotlight = (
      section: HTMLElement,
      options?: { enableGlow?: boolean; showSpotlightCore?: boolean; directHoverOnly?: boolean },
    ) => {
      const enableGlow = options?.enableGlow ?? true
      const showSpotlightCore = options?.showSpotlightCore ?? false
      const directHoverOnly = options?.directHoverOnly ?? true
      const spotlight = enableGlow && showSpotlightCore ? document.createElement("div") : null
      if (spotlight) {
        spotlight.className = "home-global-spotlight"
        section.appendChild(spotlight)
      }
      let suppressSpotlightUntil = 0
      let suppressResetTimer: number | null = null
      let rafId: number | null = null
      let pendingEvent: MouseEvent | null = null
      const getCards = () => Array.from(section.querySelectorAll<HTMLElement>(".home-spotlight-card"))
      const clampPct = (value: number) => Math.max(0, Math.min(100, value))

      const clearSpotlightState = () => {
        if (spotlight) spotlight.style.opacity = "0"
        getCards().forEach((card) => {
          card.style.setProperty("--glow-intensity", "0")
        })
      }

      const renderFrame = (e: MouseEvent) => {
        if (Date.now() < suppressSpotlightUntil) return
        if (spotlight) {
          const rect = section.getBoundingClientRect()
          spotlight.style.left = `${e.clientX - rect.left}px`
          spotlight.style.top = `${e.clientY - rect.top}px`
          spotlight.style.opacity = "1"
        }

        const proximity = 70
        const fadeDistance = 140
        const hoveredElement = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const hoveredCandidate = hoveredElement?.closest(".home-spotlight-card") as HTMLElement | null
        const hoveredCard = hoveredCandidate && section.contains(hoveredCandidate) ? hoveredCandidate : null
        getCards().forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          if (cardRect.width <= 1 || cardRect.height <= 1) {
            card.style.setProperty("--glow-intensity", "0")
            return
          }
          const isHoveredCard = hoveredCard === card
          if (directHoverOnly && !isHoveredCard) {
            card.style.setProperty("--glow-intensity", "0")
            return
          }
          const centerX = cardRect.left + cardRect.width / 2
          const centerY = cardRect.top + cardRect.height / 2
          const distance =
            Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
          const effectiveDistance = Math.max(0, distance)

          let glowIntensity = 0
          if (directHoverOnly) glowIntensity = 1
          else if (effectiveDistance <= proximity) glowIntensity = 1
          else if (effectiveDistance <= fadeDistance) glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)

          if (enableGlow) {
            const relativeX = clampPct(((e.clientX - cardRect.left) / cardRect.width) * 100)
            const relativeY = clampPct(((e.clientY - cardRect.top) / cardRect.height) * 100)
            card.style.setProperty("--glow-x", `${relativeX}%`)
            card.style.setProperty("--glow-y", `${relativeY}%`)
            card.style.setProperty("--glow-intensity", glowIntensity.toString())
            card.style.setProperty("--glow-radius", "88px")
          } else {
            card.style.setProperty("--glow-intensity", "0")
          }
        })
      }

      const handleMouseMove = (e: MouseEvent) => {
        pendingEvent = e
        if (rafId !== null) return
        rafId = window.requestAnimationFrame(() => {
          const nextEvent = pendingEvent
          pendingEvent = null
          rafId = null
          if (nextEvent) renderFrame(nextEvent)
        })
      }

      const handleMouseLeave = () => {
        clearSpotlightState()
      }
      const handleWindowBlur = () => {
        clearSpotlightState()
      }

      const handleScroll = () => {
        suppressSpotlightUntil = Date.now() + 180
        if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer)
        suppressResetTimer = window.setTimeout(() => {
          suppressSpotlightUntil = 0
          suppressResetTimer = null
        }, 180)
        clearSpotlightState()
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)
      section.addEventListener("scroll", handleScroll, true)
      section.addEventListener("wheel", handleScroll, { passive: true, capture: true })
      section.addEventListener("touchmove", handleScroll, { passive: true, capture: true })
      window.addEventListener("wheel", handleScroll, { passive: true })
      window.addEventListener("blur", handleWindowBlur)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        section.removeEventListener("scroll", handleScroll, true)
        section.removeEventListener("wheel", handleScroll, true)
        section.removeEventListener("touchmove", handleScroll, true)
        window.removeEventListener("wheel", handleScroll)
        window.removeEventListener("blur", handleWindowBlur)
        if (rafId !== null) window.cancelAnimationFrame(rafId)
        if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer)
        clearSpotlightState()
        spotlight?.remove()
      }
    }

    const cleanups: Array<() => void> = []
    if (createSectionRef.current) cleanups.push(setupSectionSpotlight(createSectionRef.current))
    if (listSectionRef.current) cleanups.push(setupSectionSpotlight(listSectionRef.current))
    if (headerActionsRef.current) cleanups.push(setupSectionSpotlight(headerActionsRef.current, { showSpotlightCore: false }))
    if (builderOpen && builderBodyRef.current) cleanups.push(setupSectionSpotlight(builderBodyRef.current, { enableGlow: false }))
    if (builderOpen && builderFooterRef.current) cleanups.push(setupSectionSpotlight(builderFooterRef.current, { showSpotlightCore: false }))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [builderBodyRef, builderFooterRef, builderOpen, createSectionRef, headerActionsRef, listSectionRef, spotlightEnabled, loading])
}
