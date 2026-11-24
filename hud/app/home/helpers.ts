import { loadUserSettings, type ThemeBackgroundType } from "@/lib/settings/userSettings"
import { isBackgroundAssetImage } from "@/lib/media/backgroundVideoStorage"

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  const fallbackDark = settings.app.background === "none" ? "none" : "black"
  return settings.app.darkModeBackground ?? (isLight ? "none" : fallbackDark)
}


export function resolveCustomBackgroundIsImage() {
  const app = loadUserSettings().app
  return isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
}
