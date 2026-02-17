"use client"

import { useState, useEffect, useMemo } from "react"
import { useTheme } from "@/lib/theme-context"
import { loadUserSettings, ORB_COLORS, type OrbColor, type ThemeBackgroundType, USER_SETTINGS_UPDATED_EVENT } from "@/lib/userSettings"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import { getCachedBackgroundVideoObjectUrl, isBackgroundAssetImage, loadBackgroundVideoObjectUrl } from "@/lib/media/backgroundVideoStorage"

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? (isLight ? "none" : legacyDark)
}

function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
export const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
export const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
export const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
export const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
export const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export interface UseChatBackgroundReturn {
  isLight: boolean
  orbColor: OrbColor
  orbPalette: typeof ORB_COLORS[OrbColor]
  background: ThemeBackgroundType
  backgroundVideoUrl: string | null
  backgroundMediaIsImage: boolean
  spotlightEnabled: boolean
  floatingLinesGradient: [string, string]
}

export function useChatBackground(): UseChatBackgroundReturn {
  const { theme } = useTheme()
  const isLight = theme === "light"

  const [appSettings, setAppSettings] = useState(() => loadUserSettings().app)
  const [background, setBackground] = useState<ThemeBackgroundType>(() => normalizeCachedBackground(readShellUiCache().background) ?? resolveThemeBackground(isLight))
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(() => {
    const cached = readShellUiCache().backgroundVideoUrl
    if (cached) return cached
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    return getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
  })
  const orbColor: OrbColor = appSettings.orbColor
  const backgroundVideoAssetId = appSettings.customBackgroundVideoAssetId || null
  const backgroundMediaIsImage = isBackgroundAssetImage(appSettings.customBackgroundVideoMimeType, appSettings.customBackgroundVideoFileName)
  const spotlightEnabled = appSettings.spotlightEnabled ?? true

  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo<[string, string]>(
    () => [orbPalette.circle1, orbPalette.circle2],
    [orbPalette.circle1, orbPalette.circle2],
  )

  // Listen for settings updates
  useEffect(() => {
    const refresh = () => {
      const settings = loadUserSettings()
      const nextBackground = resolveThemeBackground(isLight)
      setAppSettings(settings.app)
      Promise.resolve().then(() => {
        setBackground(nextBackground)
        writeShellUiCache({ background: nextBackground, orbColor: settings.app.orbColor })
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [isLight])

  // Update background on theme change
  useEffect(() => {
    const nextBackground = resolveThemeBackground(isLight)
    Promise.resolve().then(() => {
      setBackground(nextBackground)
      writeShellUiCache({ background: nextBackground })
    })
  }, [isLight])

  // Load custom video background
  useEffect(() => {
    let cancelled = false
    if (isLight || background !== "customVideo") return

    const selectedAssetId = backgroundVideoAssetId
    Promise.resolve().then(() => {
      if (cancelled) return
      const uiCached = readShellUiCache().backgroundVideoUrl
      if (uiCached) setBackgroundVideoUrl(uiCached)
      const cached = getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
      if (cached) {
        setBackgroundVideoUrl(cached)
        writeShellUiCache({ backgroundVideoUrl: cached })
      }
    })
    void loadBackgroundVideoObjectUrl(selectedAssetId || undefined)
      .then((url) => {
        if (cancelled) return
        setBackgroundVideoUrl(url)
        writeShellUiCache({ backgroundVideoUrl: url })
      })
      .catch(() => {
        if (cancelled) return
        const fallback = readShellUiCache().backgroundVideoUrl
        if (!fallback) setBackgroundVideoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [background, isLight, backgroundVideoAssetId])

  return {
    isLight,
    orbColor,
    orbPalette,
    background,
    backgroundVideoUrl,
    backgroundMediaIsImage,
    spotlightEnabled,
    floatingLinesGradient,
  }
}
