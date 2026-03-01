"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import FloatingLines from "@/components/effects/FloatingLines"
import { SpaceBackground } from "@/components/background/space-background"
import { useTheme } from "@/lib/context/theme-context"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import {
  ORB_COLORS,
  USER_SETTINGS_UPDATED_EVENT,
  loadUserSettings,
  type OrbColor,
  type ThemeBackgroundType,
} from "@/lib/settings/userSettings"
import {
  getCachedBackgroundVideoObjectUrl,
  isBackgroundAssetImage,
  loadBackgroundVideoObjectUrl,
} from "@/lib/media/backgroundVideoStorage"

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

const PERSISTENT_BACKGROUND_PATHS = ["/home", "/chat", "/missions", "/integrations", "/analytics", "/history", "/dev-logs", "/agents"] as const

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? legacyDark
}

function supportsPersistentBackground(pathname: string | null): boolean {
  if (!pathname) return false
  return PERSISTENT_BACKGROUND_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function AppBackgroundLayer() {
  const pathname = usePathname()
  const showForPath = supportsPersistentBackground(pathname)
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [mounted, setMounted] = useState(false)

  const [orbColor, setOrbColor] = useState<OrbColor>(() => {
    const cached = readShellUiCache().orbColor
    if (cached) return cached
    return loadUserSettings().app.orbColor
  })
  const [background, setBackground] = useState<ThemeBackgroundType>(() => {
    return resolveThemeBackground(isLight)
  })
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(() => {
    const cached = readShellUiCache().backgroundVideoUrl
    if (cached) return cached
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    return getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
  })
  const [customBackgroundAssetId, setCustomBackgroundAssetId] = useState<string | null>(() => {
    return loadUserSettings().app.customBackgroundVideoAssetId ?? null
  })
  const [backgroundMediaIsImage, setBackgroundMediaIsImage] = useState<boolean>(() => {
    const app = loadUserSettings().app
    return isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
  })

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  useEffect(() => {
    const sync = () => {
      const userSettings = loadUserSettings()
      const cached = readShellUiCache()
      const nextOrbColor = cached.orbColor ?? userSettings.app.orbColor
      const nextBackground = resolveThemeBackground(isLight)
      setOrbColor(nextOrbColor)
      setBackground(nextBackground)
      setCustomBackgroundAssetId(userSettings.app.customBackgroundVideoAssetId ?? null)
      setBackgroundMediaIsImage(
        isBackgroundAssetImage(userSettings.app.customBackgroundVideoMimeType, userSettings.app.customBackgroundVideoFileName),
      )
      writeShellUiCache({ orbColor: nextOrbColor, background: nextBackground })
    }

    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, sync as EventListener)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, sync as EventListener)
    }
  }, [isLight])

  useEffect(() => {
    let cancelled = false
    if (!showForPath || isLight || background !== "customVideo") return

    const app = loadUserSettings().app
    const selectedAssetId = customBackgroundAssetId || app.customBackgroundVideoAssetId

    Promise.resolve().then(() => {
      if (cancelled) return
      setBackgroundMediaIsImage(isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName))

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
        if (cancelled || !url) return
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
  }, [background, customBackgroundAssetId, isLight, showForPath])

  useEffect(() => {
    const active = mounted && showForPath && !isLight && background === "space"
    document.documentElement.classList.toggle("nova-bg-space-active", active)
    return () => {
      document.documentElement.classList.remove("nova-bg-space-active")
    }
  }, [background, isLight, mounted, showForPath])

  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo<[string, string]>(
    () => [orbPalette.circle1, orbPalette.circle2],
    [orbPalette.circle1, orbPalette.circle2],
  )

  if (!mounted || !showForPath || isLight || background === "none") return null

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      {background === "floatingLines" && (
        <div className="absolute inset-0">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 48% 46%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.18)} 28%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent 35%)`,
            }}
          />
          <div className="absolute inset-0">
            <div
              className="absolute top-[12%] left-[16%] h-72 w-72 rounded-full blur-[110px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle1, 0.24) }}
            />
            <div
              className="absolute bottom-[8%] right-[14%] h-64 w-64 rounded-full blur-[100px]"
              style={{ backgroundColor: hexToRgba(orbPalette.circle2, 0.22) }}
            />
          </div>
        </div>
      )}
      {background === "space" && <SpaceBackground />}
      {background === "customVideo" && !!backgroundVideoUrl && (
        <div className="absolute inset-0 overflow-hidden">
          {backgroundMediaIsImage ? (
            <Image
              fill
              unoptimized
              sizes="100vw"
              className="object-cover"
              src={backgroundVideoUrl}
              alt=""
              aria-hidden="true"
            />
          ) : (
            <video
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              src={backgroundVideoUrl}
            />
          )}
        </div>
      )}
      {background === "customVideo" && !!backgroundVideoUrl && <div className="absolute inset-0 bg-black/45" />}
    </div>
  )
}
