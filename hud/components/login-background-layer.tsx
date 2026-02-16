"use client"

import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import FloatingLines from "@/components/FloatingLines"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, type OrbColor, loadUserSettings } from "@/lib/userSettings"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export function LoginBackgroundLayer() {
  const pathname = usePathname()
  const [orbColor, setOrbColor] = useState<OrbColor>(() => {
    const cached = readShellUiCache().orbColor
    if (cached) return cached
    if (typeof window === "undefined") return "violet"
    return loadUserSettings().app.orbColor
  })

  useLayoutEffect(() => {
    const cached = readShellUiCache().orbColor
    const next = cached ?? loadUserSettings().app.orbColor
    setOrbColor(next)
    writeShellUiCache({ orbColor: next })
  }, [])

  useEffect(() => {
    const refresh = () => {
      const next = loadUserSettings().app.orbColor
      setOrbColor(next)
      writeShellUiCache({ orbColor: next })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])
  const palette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(() => [palette.circle1, palette.circle2], [palette.circle1, palette.circle2])

  if (pathname !== "/login") return null

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <div className="absolute inset-0">
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
    </div>
  )
}
