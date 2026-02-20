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

    const setupSectionSpotlight = (section: HTMLElement, options?: { enableGlow?: boolean; showSpotlightCore?: boolean }) => {
      const enableGlow = options?.enableGlow ?? true
      const showSpotlightCore = options?.showSpotlightCore ?? true
      const spotlight = enableGlow && showSpotlightCore ? document.createElement("div") : null
      if (spotlight) {
        spotlight.className = "home-global-spotlight"
        section.appendChild(spotlight)
      }
      let liveStars = 0
      let suppressSpotlightUntil = 0
      let suppressResetTimer: number | null = null
      let rafId: number | null = null
      let pendingEvent: MouseEvent | null = null
      const cards = Array.from(section.querySelectorAll<HTMLElement>(".home-spotlight-card"))

      const clearSpotlightState = () => {
        if (spotlight) spotlight.style.opacity = "0"
        cards.forEach((card) => {
          card.style.setProperty("--glow-intensity", "0")
          const stars = card.querySelectorAll(".fx-star-particle")
          stars.forEach((star) => star.remove())
        })
        liveStars = 0
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
        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const inside =
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
          if (effectiveDistance <= proximity) glowIntensity = 1
          else if (effectiveDistance <= fadeDistance) glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)

          if (enableGlow) {
            const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
            const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
            card.style.setProperty("--glow-x", `${relativeX}%`)
            card.style.setProperty("--glow-y", `${relativeY}%`)
            card.style.setProperty("--glow-intensity", glowIntensity.toString())
            card.style.setProperty("--glow-radius", "88px")
          } else {
            card.style.setProperty("--glow-intensity", "0")
          }

          const shouldSpawnStar = enableGlow ? glowIntensity > 0.2 : true
          const spawnRate = enableGlow ? 0.05 : 0.03
          if (inside && shouldSpawnStar && Math.random() <= spawnRate && liveStars < 12) {
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

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        section.removeEventListener("scroll", handleScroll, true)
        section.removeEventListener("wheel", handleScroll, true)
        section.removeEventListener("touchmove", handleScroll, true)
        window.removeEventListener("wheel", handleScroll)
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
