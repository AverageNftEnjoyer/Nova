"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { loadUserSettings, updateAppSettings, type AccentColor } from "@/lib/settings/userSettings"

interface AccentContextValue {
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void
}

const AccentContext = createContext<AccentContextValue>({
  accentColor: "white",
  setAccentColor: () => {},
})

/**
 * Mirrors the accent setting onto <html data-accent="...">. The colours themselves live in
 * app/styles/theme.css, tuned per theme, so --accent / --accent-fg / --accent-text / --ring stay readable in
 * light and dark. Read the resolved colour in JS with getComputedStyle(document.documentElement).getPropertyValue("--accent").
 */
export function AccentProvider({ children }: { children: ReactNode }) {
  const [accentColor, setAccentColorState] = useState<AccentColor>(() => loadUserSettings().app.accentColor)

  const applyAccentColor = useCallback((color: AccentColor) => {
    if (typeof document === "undefined") return
    document.documentElement.dataset.accent = color
  }, [])

  useEffect(() => {
    applyAccentColor(accentColor)
  }, [accentColor, applyAccentColor])

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
