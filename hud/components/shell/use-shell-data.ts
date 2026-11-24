"use client"

import { useEffect, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/store/client-store"
import { loadUserSettings, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"

export interface ShellProfile {
  name: string
  avatar: string | null
}

/** Name and avatar from the user settings (mirrored from nova.db); updates when Settings saves. */
export function useShellProfile(): ShellProfile | null {
  const [profile, setProfile] = useState<ShellProfile | null>(null)

  useEffect(() => {
    const sync = () => {
      const { name, avatar } = loadUserSettings().profile
      setProfile({ name: String(name || "").trim(), avatar: avatar || null })
    }
    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, sync)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, sync)
    }
  }, [])

  return profile
}

/** Up to two initials from a display name ("Ada Lovelace" -> "AL"). */
export function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  const first = parts[0][0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : ""
  return (first + last).toUpperCase()
}

/**
 * True when the Polymarket integration is connected (it gets a nav item only then). The browser cache gives a first
 * value; `/api/integrations/config` (nova.db) is authoritative and is re-read when integrations change or the
 * window regains focus.
 */
export function usePolymarketConnected(): boolean {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let disposed = false
    const fromServer = async () => {
      try {
        const response = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
        if (!response.ok) return
        const data = (await response.json()) as { config?: { polymarket?: { connected?: unknown } } }
        if (!disposed && data.config) setConnected(data.config.polymarket?.connected === true)
      } catch {
        // Keep the cached value when the server cannot be reached.
      }
    }
    const sync = () => {
      setConnected(Boolean(loadIntegrationsSettings().polymarket?.connected))
      void fromServer()
    }
    sync()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, sync)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, sync)
    window.addEventListener("focus", sync)
    return () => {
      disposed = true
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, sync)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, sync)
      window.removeEventListener("focus", sync)
    }
  }, [])

  return connected
}
