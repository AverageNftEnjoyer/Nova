"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { loadUserSettings, updateAppSettings, ACCENT_COLORS, type AccentColor } from "@/lib/settings/userSettings"

interface AccentContextValue {
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void
}

const AccentContext = createContext<AccentContextValue>({
  accentColor: "violet",
  setAccentColor: () => {},
})

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColorState] = useState<AccentColor>(() => loadUserSettings().app.accentColor)

  // Apply accent color CSS variables to document
  const applyAccentColor = useCallback((color: AccentColor) => {
    if (typeof document === "undefined") return

    const { primary, secondary } = ACCENT_COLORS[color]
    const root = document.documentElement

    // Parse hex to RGB for rgba() usage
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      return result
        ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
        : "139, 92, 246"
    }

    root.style.setProperty("--accent-primary", primary)
    root.style.setProperty("--accent-secondary", secondary)
    root.style.setProperty("--accent-rgb", hexToRgb(primary))
  }, [])

  // Keep document CSS vars synced with current accent color.
  useEffect(() => {
    applyAccentColor(accentColor)
  }, [accentColor, applyAccentColor])

  // Update accent color
  const setAccentColor = (color: AccentColor) => {
    setAccentColorState(color)
    applyAccentColor(color)
    updateAppSettings({ accentColor: color })
  }

  return (
    <AccentContext.Provider value={{ accentColor, setAccentColor }}>
      {children}
    </AccentContext.Provider>
  )
}

export function useAccent() {
  return useContext(AccentContext)
}
