"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { loadUserSettings, updateAppSettings } from "./userSettings"

type Theme = "dark" | "light"
type ThemeSetting = "dark" | "light" | "system"

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
  const [mounted, setMounted] = useState(false)

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
    const setting = settings.app.theme
    setThemeSettingState(setting)
    setTheme(resolveTheme(setting))
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
