import { loadUserSettings, type ThemeBackgroundType } from "@/lib/settings/userSettings"
import { isBackgroundAssetImage } from "@/lib/media/backgroundVideoStorage"
import { resolveTimezone } from "@/lib/shared/timezone"

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function formatDailyTime(time: string, timezone: string): string {
  const parts = /^(\d{2}):(\d{2})$/.exec(time)
  if (!parts) return time
  const hour = Number(parts[1])
  const minute = Number(parts[2])
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: resolveTimezone(timezone),
  }).format(date)
}

function priorityRank(priority: "low" | "medium" | "high" | "critical"): number {
  if (priority === "low") return 0
  if (priority === "medium") return 1
  if (priority === "high") return 2
  return 3
}

export function compareMissionPriority(left: "low" | "medium" | "high" | "critical", right: "low" | "medium" | "high" | "critical"): number {
  return priorityRank(left) - priorityRank(right)
}

export function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? (isLight ? "none" : legacyDark)
}

export function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "space" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

export function resolveCustomBackgroundIsImage() {
  const app = loadUserSettings().app
  return isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
}
