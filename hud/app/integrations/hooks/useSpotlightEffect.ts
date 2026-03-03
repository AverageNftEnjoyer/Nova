import { useEffect, type RefObject } from "react"

export interface SpotlightSectionRef {
  ref: RefObject<HTMLElement | null>
  showSpotlightCore?: boolean
  enableParticles?: boolean
  directHoverOnly?: boolean
}

/**
 * Sets up card spotlight/glow effects across sections.
 * Defaults are tuned for stable UX: no moving core dot, no particles, direct hovered-card glow only.
 */
export function useSpotlightEffect(
  enabled: boolean,
  sections: SpotlightSectionRef[],
  dependencies: unknown[] = []
) {
  useEffect(() => {
    if (!enabled) return
    const clampPct = (value: number) => Math.max(0, Math.min(100, value))

    const setupSectionSpotlight = (
      section: HTMLElement,
      options?: { showSpotlightCore?: boolean; enableParticles?: boolean; directHoverOnly?: boolean }
    ) => {
      const showSpotlightCore = options?.showSpotlightCore ?? false
      const enableParticles = options?.enableParticles ?? false
      const directHoverOnly = options?.directHoverOnly ?? true
      const spotlight = showSpotlightCore ? document.createElement("div") : null
      if (spotlight) {
        spotlight.className = "home-global-spotlight"
        section.appendChild(spotlight)
      }
      let liveStars = 0
      const cards = Array.from(section.querySelectorAll<HTMLElement>(".home-spotlight-card"))
      let rafId: number | null = null
      let pendingEvent: MouseEvent | null = null

      const renderFrame = (e: MouseEvent) => {
        const rect = section.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        if (spotlight) {
          spotlight.style.left = `${mouseX}px`
          spotlight.style.top = `${mouseY}px`
          spotlight.style.opacity = "1"
        }

        const proximity = 70
        const fadeDistance = 140
        const hoveredElement = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const hoveredCandidate = hoveredElement?.closest(".home-spotlight-card") as HTMLElement | null
        const hoveredCard = hoveredCandidate && section.contains(hoveredCandidate) ? hoveredCandidate : null

        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          if (cardRect.width <= 1 || cardRect.height <= 1) {
            card.style.setProperty("--glow-intensity", "0")
            return
          }
          const isHoveredCard = hoveredCard === card
          const isInsideCard =
            e.clientX >= cardRect.left &&
            e.clientX <= cardRect.right &&
            e.clientY >= cardRect.top &&
            e.clientY <= cardRect.bottom
          if (directHoverOnly && !isHoveredCard) {
            card.style.setProperty("--glow-intensity", "0")
            return
          }
          const centerX = cardRect.left + cardRect.width / 2
          const centerY = cardRect.top + cardRect.height / 2
          const distance =
            Math.hypot(e.clientX - centerX, e.clientY - centerY) -
            Math.max(cardRect.width, cardRect.height) / 2
          const effectiveDistance = Math.max(0, distance)

          let glowIntensity = 0
          if (directHoverOnly) {
            glowIntensity = 1
          } else if (effectiveDistance <= proximity) {
            glowIntensity = 1
          } else if (effectiveDistance <= fadeDistance) {
            glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
          }

          const relativeX = clampPct(((e.clientX - cardRect.left) / cardRect.width) * 100)
          const relativeY = clampPct(((e.clientY - cardRect.top) / cardRect.height) * 100)
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-intensity", glowIntensity.toString())
          card.style.setProperty("--glow-radius", "120px")

          if (enableParticles && isInsideCard && glowIntensity > 0.3 && Math.random() <= 0.015 && liveStars < 4) {
            liveStars += 1
            const star = document.createElement("span")
            star.className = "fx-star-particle"
            star.style.left = `${e.clientX - cardRect.left}px`
            star.style.top = `${e.clientY - cardRect.top}px`
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
              { once: true }
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
        // Cancel any pending RAF so a stale in-flight frame can't re-show the
        // spotlight after the cursor has already left this section.
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId)
          rafId = null
        }
        pendingEvent = null
        if (spotlight) spotlight.style.opacity = "0"
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }
      const handleWindowBlur = () => {
        if (spotlight) spotlight.style.opacity = "0"
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)
      window.addEventListener("blur", handleWindowBlur)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        window.removeEventListener("blur", handleWindowBlur)
        if (rafId !== null) window.cancelAnimationFrame(rafId)
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
        spotlight?.remove()
      }
    }

    const cleanups: Array<() => void> = []
    for (const { ref, showSpotlightCore, enableParticles, directHoverOnly } of sections) {
      if (ref.current) {
        cleanups.push(
          setupSectionSpotlight(ref.current, {
            showSpotlightCore: showSpotlightCore ?? false,
            enableParticles: enableParticles ?? false,
            directHoverOnly: directHoverOnly ?? true,
          })
        )
      }
    }

    return () => cleanups.forEach((cleanup) => cleanup())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...dependencies])
}
