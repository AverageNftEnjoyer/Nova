import { useEffect, type RefObject } from "react"

export interface SpotlightSectionRef {
  ref: RefObject<HTMLElement | null>
  showSpotlightCore?: boolean
}

/**
 * Sets up a spotlight/glow effect that follows the mouse cursor across sections.
 * Creates particle effects when hovering over cards with the "home-spotlight-card" class.
 */
export function useSpotlightEffect(
  enabled: boolean,
  sections: SpotlightSectionRef[],
  dependencies: unknown[] = []
) {
  useEffect(() => {
    if (!enabled) return

    const setupSectionSpotlight = (
      section: HTMLElement,
      options?: { showSpotlightCore?: boolean }
    ) => {
      const showSpotlightCore = options?.showSpotlightCore ?? true
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
            Math.hypot(e.clientX - centerX, e.clientY - centerY) -
            Math.max(cardRect.width, cardRect.height) / 2
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

          if (isInsideCard && glowIntensity > 0.2 && Math.random() <= 0.05 && liveStars < 12) {
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

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        if (rafId !== null) window.cancelAnimationFrame(rafId)
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
        spotlight?.remove()
      }
    }

    const cleanups: Array<() => void> = []
    for (const { ref, showSpotlightCore } of sections) {
      if (ref.current) {
        cleanups.push(
          setupSectionSpotlight(ref.current, { showSpotlightCore: showSpotlightCore ?? true })
        )
      }
    }

    return () => cleanups.forEach((cleanup) => cleanup())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...dependencies])
}
