import type { SettingsSectionId } from "@/components/settings/settings-nav"

/** Window events the app shell listens for, so any page or component can drive it without a context. */
export const OPEN_SETTINGS_EVENT = "nova:shell-open-settings"
export const OPEN_COMMAND_PALETTE_EVENT = "nova:shell-open-command-palette"

export interface OpenSettingsDetail {
  section?: SettingsSectionId
}

/** Opens the Settings dialog, optionally on one section (e.g. `openSettings("agent-budgets")`). */
export function openSettings(section?: SettingsSectionId): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<OpenSettingsDetail>(OPEN_SETTINGS_EVENT, { detail: { section } }))
}

/** Opens the command palette (same as Ctrl K). */
export function openCommandPalette(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
}
