"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { loadUserSettings, updateAppSettings, USER_SETTINGS_UPDATED_EVENT } from "./userSettings"

type Theme = "dark" | "light"
type ThemeSetting = "dark" | "light" | "system"
type FontSizeSetting = "small" | "medium" | "large"

interface ThemeContextValue {
  theme: Theme
  themeSetting: ThemeSetting
  setThemeSetting: (setting: ThemeSetting) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  themeSetting: "dark",
  setThemeSetting: () => {},
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark")
  const [themeSetting, setThemeSettingState] = useState<ThemeSetting>("dark")
  const [fontSizeSetting, setFontSizeSetting] = useState<FontSizeSetting>("medium")
  const [mounted, setMounted] = useState(false)

  const applyFontScale = (setting: FontSizeSetting) => {
    if (typeof window === "undefined") return

    // Medium is the responsive baseline based on viewport width.
    const basePx = Math.max(14, Math.min(18, window.innerWidth / 90))
    const multiplier = setting === "small" ? 0.92 : setting === "large" ? 1.12 : 1
    const sizePx = basePx * multiplier

    document.documentElement.style.fontSize = `${sizePx.toFixed(2)}px`
  }

  // Resolve the actual theme from setting (handles "system")
  const resolveTheme = (setting: ThemeSetting): Theme => {
    if (setting === "system") {
      if (typeof window !== "undefined") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      }
      return "dark"
    }
    return setting
  }

  // Read persisted theme on mount from user settings
  useEffect(() => {
    const settings = loadUserSettings()
    setThemeSettingState(settings.app.theme)
    setTheme(resolveTheme(settings.app.theme))
    setFontSizeSetting(settings.app.fontSize)
    applyFontScale(settings.app.fontSize)
    setMounted(true)
  }, [])

  // Listen for system theme changes when using "system" setting
  useEffect(() => {
    if (themeSetting !== "system") return

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "dark" : "light")
    }

    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  }, [themeSetting])

  // Apply theme class to <html>
  useEffect(() => {
    if (!mounted) return
    const html = document.documentElement
    if (theme === "dark") {
      html.classList.add("dark")
      html.classList.remove("light")
    } else {
      html.classList.remove("dark")
      html.classList.add("light")
    }
  }, [theme, mounted])

  // Keep global font scale synced with setting and viewport changes.
  useEffect(() => {
    if (!mounted) return

    const syncFromSettings = () => {
      const next = loadUserSettings().app.fontSize
      setFontSizeSetting(next)
      applyFontScale(next)
    }

    const handleResize = () => applyFontScale(fontSizeSetting)

    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
      window.removeEventListener("resize", handleResize)
    }
  }, [mounted, fontSizeSetting])

  // Update theme setting (called from settings modal)
  const setThemeSetting = (setting: ThemeSetting) => {
    setThemeSettingState(setting)
    setTheme(resolveTheme(setting))
    updateAppSettings({ theme: setting })
  }

  // Quick toggle (for theme toggle button)
  const toggleTheme = () => {
    const newSetting = theme === "dark" ? "light" : "dark"
    setThemeSetting(newSetting)
  }

  return (
    <ThemeContext.Provider value={{ theme, themeSetting, setThemeSetting, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
