"use client"

import { useState, useEffect } from "react"
import { useTheme } from "@/lib/context/theme-context"
import { loadUserSettings, ORB_COLORS, type OrbColor, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"

export interface UseChatBackgroundReturn {
  isLight: boolean
  orbColor: OrbColor
  orbPalette: typeof ORB_COLORS[OrbColor]
  spotlightEnabled: boolean
}

export function useChatBackground(): UseChatBackgroundReturn {
  const { theme } = useTheme()
  const isLight = theme === "light"

  const [appSettings, setAppSettings] = useState(() => loadUserSettings().app)
  const orbColor: OrbColor = appSettings.orbColor
  const spotlightEnabled = appSettings.spotlightEnabled ?? true

  const orbPalette = ORB_COLORS[orbColor]

  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      setAppSettings(settings.app)
    }

    refresh()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  return {
    isLight,
    orbColor,
    orbPalette,
    spotlightEnabled,
  }
}
