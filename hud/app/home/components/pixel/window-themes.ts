import type { CityHotspotId } from "@/components/pixel-city/types"
import type { CSSProperties } from "react"

/**
 * Per-building looks for the Home popup windows (PixelWindow). Every window shares one slate stone frame and the Day
 * palette (docs/frontend/nova-city-day-ui.md); a building only picks its sign colour (the title plaque's rim, the
 * emblem and the accent the module inside uses) and a 9x9 pixel emblem. The Depot opens its own modal and has no
 * entry here.
 */

/** A Home place's window, plus the windows that belong to no building. */
export type PixelWindowThemeId = Exclude<CityHotspotId, "deploy"> | "quest" | "agent" | "default"

export interface PixelWindowTheme {
  id: PixelWindowThemeId
  /** The building's sign colour: plaque rim, emblem and the modules' accent inside the window (bright on --px-bg). */
  accent: string
  /** Second emblem colour. */
  accent2: string
  /**
   * 9x9 pixel emblem, one string per row: `a` accent, `b` accent2, `w` white, `d` outline ink, `.` empty.
   */
  emblem: readonly string[]
}

export const PIXEL_WINDOW_THEMES: Readonly<Record<PixelWindowThemeId, PixelWindowTheme>> = {
  // Nova HQ: the glass tower with the cyan N.
  tasks: { id: "tasks", accent: "#4fe0ee", accent2: "#c8f8ff", emblem: ["aaaaaaaaa", "a.......a", "a.b...b.a", "a.bb..b.a", "a.b.b.b.a", "a.b..bb.a", "a.b...b.a", "a.......a", "aaaaaaaaa"] },
  // Power Plant: red POWER neon.
  analytics: { id: "analytics", accent: "#ff8a6a", accent2: "#ffd34d", emblem: [".....aa..", "....aa...", "...aa....", "..aaaaaa.", "....aa...", "...aa....", "..aa.....", ".aa......", "a........"] },
  // Noticeboard: paper and pins.
  notes: { id: "notes", accent: "#ffd86a", accent2: "#ff7a6a", emblem: ["...b.....", "..bbb....", ".wwbwwww.", ".wwwwwww.", ".wddddww.", ".wwwwwww.", ".wdddddw.", ".wwwwwww.", "........."] },
  // Town Hall: columns, slate roof and the blue flag.
  integrations: { id: "integrations", accent: "#9cbcff", accent2: "#ffd98a", emblem: ["....a....", "...aaa...", "..aaaaa..", ".aaaaaaa.", ".w.w.w.w.", ".w.w.w.w.", ".w.w.w.w.", "aaaaaaaaa", "........."] },
  // Fountain Park: hedges round the fountain.
  chat: { id: "chat", accent: "#8aea72", accent2: "#7fdcff", emblem: ["....b....", "...b.b...", "..b.b.b..", "....b....", "....a....", ".aaaaaaa.", ".abbbbba.", "..aaaaa..", "........."] },
  // Post Office: the gold POST plaque.
  schedule: { id: "schedule", accent: "#ffd479", accent2: "#ff7a6a", emblem: ["aaaaaaaaa", "aa.....aa", "a.a...a.a", "a..a.a..a", "a...b...a", "a.......a", "aaaaaaaaa", ".........", "........."] },
  // Bank: red brick, gold sign.
  crypto: { id: "crypto", accent: "#ffc24a", accent2: "#6ff09a", emblem: ["..aaaaa..", ".a.....a.", "a...a...a", "a..aaa..a", "a..aa...a", "a...aa..a", "a..aaa..a", ".a..a..a.", "..aaaaa.."] },
  // Odds Parlour: the green ODDS neon.
  polymarket: { id: "polymarket", accent: "#5ff09c", accent2: "#ffd98a", emblem: [".........", ".wwwwwww.", ".wd...dw.", ".w.....w.", ".w..d..w.", ".w.....w.", ".wd...dw.", ".wwwwwww.", "........."] },
  // Cinema: the pink CINEMA neon.
  youtube: { id: "youtube", accent: "#ff80c4", accent2: "#ffb04a", emblem: ["aaaaaaaaa", "a.a.a.a.a", "aaaaaaaaa", "a.......a", "a..bb...a", "a..bbb..a", "a..bb...a", "aaaaaaaaa", "a.a.a.a.a"] },
  // Quest log: the Town Hall's guild board, a gold star.
  quest: { id: "quest", accent: "#ffcf4a", accent2: "#9cbcff", emblem: ["....a....", "....a....", "...aaa...", "aaaaaaaaa", ".aaaaaaa.", "..aaaaa..", "..aa.aa..", ".aa...aa.", "........."] },
  // An agent's card: Nova HQ's cyan visor.
  agent: { id: "agent", accent: "#4fe0ee", accent2: "#ffffff", emblem: ["..wwwww..", ".wwwwwww.", "wwaaaaaww", "wabbbbbaw", "wwaaaaaww", ".wwwwwww.", "..wwwww..", ".ww...ww.", "........."] },
  // Anything else: under the NOVA arch.
  default: { id: "default", accent: "#ffcf4a", accent2: "#27c4c4", emblem: [".........", "....a....", "...aba...", "..abbba..", ".abbbbba.", "..abbba..", "...aba...", "....a....", "........."] },
}

type ThemeStyle = CSSProperties & Record<`--${string}`, string>

const styleCache = new Map<PixelWindowThemeId, ThemeStyle>()

/**
 * CSS custom properties for a themed window: `--pw-*` drive the plaque and emblem (pixel-ui.css, "Popup windows"), and
 * `--px-accent` tints the module inside so its accents match the building.
 */
export function windowThemeStyle(id: PixelWindowThemeId): ThemeStyle {
  const cached = styleCache.get(id)
  if (cached) return cached
  const theme = PIXEL_WINDOW_THEMES[id]
  const style: ThemeStyle = {
    "--pw-accent": theme.accent,
    "--pw-accent-2": theme.accent2,
    "--px-accent": theme.accent,
  }
  styleCache.set(id, style)
  return style
}
