"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import FloatingLines from "@/components/effects/FloatingLines"
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

const PERSISTENT_BACKGROUND_PATHS = ["/login", "/home", "/chat", "/missions", "/integrations", "/history", "/dev-logs", "/agents"] as const

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const fallbackDark = settings.app.background === "none" ? "none" : "black"
  return settings.app.darkModeBackground ?? fallbackDark
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

function mixHex(baseHex: string, mixHexColor: string, ratio: number): string {
  const toRgb = (hex: string) => {
    const clean = hex.replace("#", "")
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
    const num = Number.parseInt(full, 16)
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
  }
  const base = toRgb(baseHex)
  const mix = toRgb(mixHexColor)
  const t = Math.max(0, Math.min(1, ratio))
  const r = Math.round(base.r * (1 - t) + mix.r * t)
  const g = Math.round(base.g * (1 - t) + mix.g * t)
  const b = Math.round(base.b * (1 - t) + mix.b * t)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
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

  const orbPalette = ORB_COLORS[orbColor]
  const blackModeCore = useMemo(() => mixHex("#020204", orbPalette.bg, 0.35), [orbPalette.bg])
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
        </div>
      )}
      {background === "black" && (
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(120% 95% at 50% 58%, ${hexToRgba(blackModeCore, 0.84)} 0%, rgba(5, 5, 7, 0.96) 56%, ${blackModeCore} 100%),
                linear-gradient(175deg, ${hexToRgba(orbPalette.circle1, 0.045)} 0%, rgba(0,0,0,0) 36%)
              `,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(0deg, ${hexToRgba(orbPalette.circle2, 0.09)} 1px, transparent 1px),
                linear-gradient(90deg, ${hexToRgba(orbPalette.circle1, 0.08)} 1px, transparent 1px)
              `,
              backgroundSize: "44px 44px, 44px 44px",
              backgroundPosition: "0 0, 0 0",
              opacity: 0.22,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(0deg, ${hexToRgba(orbPalette.circle2, 0.11)} 1px, transparent 1px),
                linear-gradient(90deg, ${hexToRgba(orbPalette.circle1, 0.1)} 1px, transparent 1px)
              `,
              backgroundSize: "5px 5px, 5px 5px",
              backgroundRepeat: "repeat, repeat",
              backgroundPosition: "0 0, 0 0",
              opacity: 0.16,
            }}
          />
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${hexToRgba(orbPalette.circle1, 0.06)} 36%, rgba(0,0,0,0.58) 100%)` }} />
        </div>
      )}
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
