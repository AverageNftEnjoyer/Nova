"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { Switch, Tooltip } from "@/components/ui"
import { SegmentedControl, SettingRow, SettingsGroup, playClickSound } from "@/components/settings/settings-primitives"
import { ACCENT_COLORS, type AccentColor, type UserSettings } from "@/lib/settings/userSettings"
import { useTheme } from "@/lib/context/theme-context"
import { useAccent } from "@/lib/context/accent-context"
import { cn } from "@/lib/shared/utils"

interface Props {
  settings: UserSettings
  setSettings: Dispatch<SetStateAction<UserSettings | null>>
  updateApp: (key: string, value: boolean | string | null) => void
}

type ThemeSetting = UserSettings["app"]["theme"]
type FontSize = UserSettings["app"]["fontSize"]

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden /> },
  { value: "system", label: "System", icon: <Monitor aria-hidden /> },
] as const satisfies ReadonlyArray<{ value: ThemeSetting; label: string; icon: React.ReactNode }>

const FONT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Default" },
  { value: "large", label: "Large" },
] as const satisfies ReadonlyArray<{ value: FontSize; label: string }>

/** Accent order in the picker: neutral first, then the hues around the wheel. */
const ACCENT_ORDER: AccentColor[] = ["white", "black", "violet", "blue", "cyan", "emerald", "amber", "orange", "rose", "pastelPink"]
const ACCENT_LABELS: Record<AccentColor, string> = {
  white: "Neutral",
  black: "Graphite",
  violet: "Violet",
  blue: "Blue",
  cyan: "Cyan",
  emerald: "Emerald",
  amber: "Amber",
  orange: "Orange",
  rose: "Rose",
  pastelPink: "Pink",
}

/**
 * The --accent value theme.css defines for each option in the current theme, read from the loaded stylesheet so
 * the swatches match what the app will actually show. Falls back to the stored base colour if a sheet is unreadable.
 */
function readAccentSwatches(theme: "dark" | "light"): Record<AccentColor, string> {
  const found: Partial<Record<AccentColor, string>> = {}
  const base = theme === "dark" ? ".dark" : ":root, .light"
  const prefix = theme === "dark" ? ".dark[data-accent=" : ":root[data-accent="
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      const value = rule.style.getPropertyValue("--accent").trim()
      if (!value) continue
      const selector = rule.selectorText.replace(/\s+/g, " ").trim()
      if (selector === base) found.white = value
      else if (selector.startsWith(prefix)) {
        const key = selector.slice(prefix.length).replace(/["\]]/g, "") as AccentColor
        if (key in ACCENT_COLORS) found[key] = value
      }
    }
  }
  const result = {} as Record<AccentColor, string>
  for (const color of ACCENT_ORDER) result[color] = found[color] ?? ACCENT_COLORS[color].primary
  return result
}

export function SettingsAppearancePanel({ settings, setSettings, updateApp }: Props) {
  const { setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()
  const [swatches, setSwatches] = useState<Record<AccentColor, string> | null>(null)
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null)

  useEffect(() => {
    // Re-read after the theme class flips so the swatches show this theme's tuned hues.
    const read = () => setSwatches(readAccentSwatches(document.documentElement.classList.contains("dark") ? "dark" : "light"))
    const frame = window.requestAnimationFrame(read)
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getAutoLaunch) return
    let cancelled = false
    api
      .getAutoLaunch()
      .then((result) => {
        if (!cancelled && result.success) setAutoLaunch(result.enabled ?? false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const changeAutoLaunch = async (enabled: boolean) => {
    const result = await window.electronAPI?.setAutoLaunch(enabled).catch(() => null)
    if (result?.success) {
      setAutoLaunch(enabled)
      playClickSound()
    }
  }

  const changeTheme = (value: ThemeSetting) => {
    playClickSound()
    setThemeSetting(value)
    setSettings((prev) => (prev ? { ...prev, app: { ...prev.app, theme: value } } : prev))
  }

  const changeAccent = (color: AccentColor) => {
    playClickSound()
    setAccentColor(color)
    setSettings((prev) => (prev ? { ...prev, app: { ...prev.app, accentColor: color } } : prev))
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="Look">
        <SettingRow label="Theme" hint="System follows your Windows setting.">
          <SegmentedControl aria-label="Theme" value={settings.app.theme} options={THEME_OPTIONS} onValueChange={changeTheme} />
        </SettingRow>
        <SettingRow label="Accent colour" hint="Used for primary buttons, focus and selection.">
          <div role="radiogroup" aria-label="Accent colour" className="grid grid-cols-5 gap-1.5">
            {ACCENT_ORDER.map((color) => {
              const selected = settings.app.accentColor === color
              return (
                <Tooltip key={color} content={ACCENT_LABELS[color]}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={ACCENT_LABELS[color]}
                    onClick={() => changeAccent(color)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md border transition-[border-color,box-shadow] duration-150 ease-out",
                      selected ? "border-fg shadow-[inset_0_0_0_2px_var(--surface)]" : "border-border hover:border-border-strong",
                    )}
                    style={swatches ? { backgroundColor: swatches[color] } : undefined}
                  >
                    {selected ? (
                      <span className="flex size-4 items-center justify-center rounded-full bg-surface text-fg">
                        <Check aria-hidden className="size-3" />
                      </span>
                    ) : null}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        </SettingRow>
        <SettingRow label="Text size" hint="Scales all text and spacing in the app.">
          <SegmentedControl
            aria-label="Text size"
            value={settings.app.fontSize}
            options={FONT_SIZE_OPTIONS}
            onValueChange={(value) => {
              playClickSound()
              updateApp("fontSize", value)
            }}
          />
        </SettingRow>
        <SettingRow label="Compact chat" hint="Tighter spacing between chat messages.">
          <Switch
            checked={settings.app.compactMode}
            onCheckedChange={(value) => {
              playClickSound()
              updateApp("compactMode", value)
            }}
          />
        </SettingRow>
      </SettingsGroup>

      {autoLaunch !== null ? (
        <SettingsGroup title="Startup">
          <SettingRow label="Open Nova when Windows starts" hint="Starts Nova each time you sign in to Windows.">
            <Switch checked={autoLaunch} onCheckedChange={(value) => void changeAutoLaunch(value)} />
          </SettingRow>
        </SettingsGroup>
      ) : null}
    </div>
  )
}
