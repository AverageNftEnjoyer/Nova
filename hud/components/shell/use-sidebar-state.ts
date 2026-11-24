"use client"

import { useCallback, useEffect, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId } from "@/lib/auth/active-user"

const STORAGE_PREFIX = "nova_shell_sidebar_collapsed"
/** Below this width the sidebar is an icon rail; expanding it opens it over the content. */
export const SIDEBAR_AUTO_COLLAPSE_PX = 1200

function storageKey(): string {
  return `${STORAGE_PREFIX}:${getActiveUserId() || "local-user"}`
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(storageKey()) === "1"
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(storageKey(), value ? "1" : "0")
  } catch {
    // Storage blocked: the choice still holds for this session.
  }
}

export interface SidebarState {
  /** Rendered as the 56px icon rail. */
  collapsed: boolean
  /** Narrow window: the sidebar is a rail by default and opens as an overlay. */
  narrow: boolean
  /** Narrow window with the overlay open. */
  overlayOpen: boolean
  toggle: () => void
  closeOverlay: () => void
}

/**
 * Wide windows: collapsed/expanded is the user's choice, remembered per user.
 * Narrow windows (< 1200px): always a rail; toggling opens the full sidebar over the content without changing the
 * remembered choice.
 */
export function useSidebarState(): SidebarState {
  const [preferCollapsed, setPreferCollapsed] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_PX - 0.02}px)`)
    const sync = () => {
      setNarrow(query.matches)
      setOverlayOpen(false)
    }
    const syncUser = () => setPreferCollapsed(readCollapsed())
    sync()
    syncUser()
    query.addEventListener("change", sync)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, syncUser)
    return () => {
      query.removeEventListener("change", sync)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, syncUser)
    }
  }, [])

  const toggle = useCallback(() => {
    if (narrow) {
      setOverlayOpen((open) => !open)
      return
    }
    const next = !preferCollapsed
    writeCollapsed(next)
    setPreferCollapsed(next)
  }, [narrow, preferCollapsed])

  const closeOverlay = useCallback(() => setOverlayOpen(false), [])

  return { collapsed: narrow ? !overlayOpen : preferCollapsed, narrow, overlayOpen, toggle, closeOverlay }
}
