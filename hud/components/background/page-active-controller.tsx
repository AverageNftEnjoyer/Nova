"use client"

import { useEffect } from "react"
import { usePageActive } from "@/lib/hooks/use-page-active"

/** Delay before a blur flips the page inactive, so quick alt-tabs do not flicker. */
const INACTIVE_DEBOUNCE_MS = 250

/**
 * Single source of truth for "is the window visibly active".
 * Mirrors usePageActive() onto <html data-page-active="true|false"> so global CSS
 * (see utilities.css) can pause every running animation while the window is
 * hidden or unfocused, and non-React consumers (e.g. the background video) can react.
 */
export function PageActiveController() {
  const active = usePageActive()

  useEffect(() => {
    const root = document.documentElement
    if (active) {
      root.dataset.pageActive = "true"
      return
    }
    const timer = window.setTimeout(() => {
      root.dataset.pageActive = "false"
    }, INACTIVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [active])

  return null
}
