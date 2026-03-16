"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "@/lib/context/theme-context"
import {
  ORB_COLORS,
  USER_SETTINGS_UPDATED_EVENT,
  loadUserSettings,
  type OrbColor,
} from "@/lib/settings/userSettings"

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((value) => value + value).join("") : clean
  const parsed = Number.parseInt(full, 16)
  const red = (parsed >> 16) & 255
  const green = (parsed >> 8) & 255
  const blue = parsed & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function LoginBackgroundLayer() {
  const pathname = usePathname()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const [mounted, setMounted] = useState(false)
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  useEffect(() => {
    const sync = () => {
      const next = loadUserSettings().app.orbColor
      setOrbColor(next in ORB_COLORS ? next : "violet")
    }

    sync()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, sync as EventListener)
  }, [])

  const palette = ORB_COLORS[orbColor]

  if (!mounted || pathname !== "/login") return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? `
                radial-gradient(120% 90% at 18% 12%, ${hexToRgba(palette.circle4, 0.22)} 0%, transparent 46%),
                radial-gradient(110% 88% at 84% 16%, ${hexToRgba(palette.circle2, 0.16)} 0%, transparent 44%),
                linear-gradient(180deg, rgba(244,247,252,0.96) 0%, rgba(234,239,247,0.88) 52%, rgba(244,247,252,0.98) 100%)
              `
            : `
                radial-gradient(120% 90% at 18% 12%, ${hexToRgba(palette.circle4, 0.16)} 0%, transparent 42%),
                radial-gradient(110% 84% at 84% 18%, ${hexToRgba(palette.circle2, 0.12)} 0%, transparent 40%),
                linear-gradient(180deg, rgba(4,6,10,0.9) 0%, rgba(3,4,8,0.95) 52%, rgba(2,3,6,0.98) 100%)
              `,
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage: isLight
            ? `
                linear-gradient(${hexToRgba(palette.circle2, 0.1)} 1px, transparent 1px),
                linear-gradient(90deg, ${hexToRgba(palette.circle1, 0.08)} 1px, transparent 1px)
              `
            : `
                linear-gradient(${hexToRgba(palette.circle2, 0.08)} 1px, transparent 1px),
                linear-gradient(90deg, ${hexToRgba(palette.circle1, 0.08)} 1px, transparent 1px)
              `,
          backgroundSize: "42px 42px, 42px 42px",
          backgroundPosition: "0 0, 0 0",
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: `radial-gradient(${hexToRgba(isLight ? palette.circle2 : palette.circle4, 0.3)} 0.8px, transparent 0.8px)`,
          backgroundSize: "18px 18px",
        }}
      />

      <div
        className="absolute inset-x-0 top-0 h-[46vh]"
        style={{
          background: isLight
            ? `linear-gradient(180deg, ${hexToRgba(palette.circle1, 0.15)} 0%, transparent 72%)`
            : `linear-gradient(180deg, ${hexToRgba(palette.circle1, 0.12)} 0%, transparent 72%)`,
        }}
      />

      <div
        className="absolute -left-24 top-[12vh] h-80 w-80 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${hexToRgba(palette.circle4, isLight ? 0.16 : 0.13)} 0%, transparent 72%)` }}
      />
      <div
        className="absolute right-[-7rem] top-[22vh] h-96 w-96 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${hexToRgba(palette.circle2, isLight ? 0.14 : 0.12)} 0%, transparent 74%)` }}
      />
      <div
        className="absolute bottom-[-7rem] left-[18vw] h-80 w-80 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${hexToRgba(palette.circle1, isLight ? 0.12 : 0.1)} 0%, transparent 76%)` }}
      />

      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 22%, transparent 78%, rgba(255,255,255,0.1) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 22%, transparent 78%, rgba(255,255,255,0.04) 100%)",
        }}
      />
    </div>
  )
}