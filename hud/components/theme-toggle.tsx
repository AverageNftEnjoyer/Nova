"use client"

import { Sun, Moon } from "lucide-react"
import { useTheme } from "@/lib/theme-context"

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className={`p-2 rounded-full transition-colors bg-s-5 hover:bg-s-10 ${className ?? ""}`}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4 text-s-60" />
      ) : (
        <Moon className="w-4 h-4 text-s-60" />
      )}
    </button>
  )
}
