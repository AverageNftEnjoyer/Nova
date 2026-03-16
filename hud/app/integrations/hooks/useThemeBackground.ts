import { loadUserSettings, type ThemeBackgroundType } from "@/lib/settings/userSettings"
import { isBackgroundAssetImage } from "@/lib/media/backgroundVideoStorage"

/**
 * Resolves the current theme background type based on light/dark mode settings.
 */
export function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const fallbackDark = settings.app.background === "none" ? "none" : "black"
  return settings.app.darkModeBackground ?? fallbackDark
}

/**
 * Normalizes a cached background value to a valid ThemeBackgroundType.
 */

/**
 * Checks if the current custom background is an image (vs. video).
 */
export function resolveCustomBackgroundIsImage(): boolean {
  const app = loadUserSettings().app
  return isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName)
}
