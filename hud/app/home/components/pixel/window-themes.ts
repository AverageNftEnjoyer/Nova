import type { CSSProperties } from "react"
import type { CityHotspotId, CityRect } from "@/components/pixel-city/types"
import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_SRC, DISTRICT_IMAGE_WIDTH } from "@/components/pixel-city/district/image-plan"

/**
 * Per-building looks for the Home popup windows (PixelWindow). One system, many facades: every window has the same
 * structure (a material frame, a sign board title bar with an emblem and a crop of the building, a plain body), and
 * each place picks the frame material, the sign's neon colour (sampled from that building's sign in the painting),
 * a pixel emblem and the crop. The Depot opens its own modal and has no entry here.
 */

/** A Home place's window, plus the windows that belong to no building. */
export type PixelWindowThemeId = Exclude<CityHotspotId, "deploy"> | "quest" | "agent" | "default"

/** What the frame around the window is built from; each one is a small pixel tile drawn below. */
export type PixelFrameMaterial = "glass-steel" | "hazard" | "brick" | "wood" | "stone" | "airmail" | "marquee" | "hedge"

interface FramePalette {
  /** Main material colour. */
  base: string
  /** Lit edge / highlight pixels. */
  light: string
  /** Shadow pixels (mortar, grain, seams). */
  dark: string
  /** Outline around the frame, the title board and the body. */
  line: string
}

interface SurfacePalette {
  bg: string
  bg2: string
  bg3: string
  border: string
  borderHi: string
  muted: string
}

export interface PixelWindowTheme {
  id: PixelWindowThemeId
  material: PixelFrameMaterial
  /** The building's sign colour: title text, sign tube and the modules' accent inside the window. */
  accent: string
  /** Second colour used by the emblem and the frame's details (bulbs, stripes, rivets). */
  accent2: string
  /** Title board background. */
  sign: string
  frame: FramePalette
  /** Body tints, slightly coloured toward the building; text stays the shared light ink for contrast. */
  surface: SurfacePalette
  /**
   * 9x9 pixel emblem, one string per row: `a` accent, `b` accent2, `w` light ink, `d` frame line, `.` empty.
   */
  emblem: readonly string[]
  /** Crop of the painting shown in the title bar (plan pixels, about 1.4:1). */
  vignette: CityRect
}

const NIGHT_SURFACE: SurfacePalette = {
  bg: "#120f24",
  bg2: "#1b1733",
  bg3: "#251f45",
  border: "#3b3470",
  borderHi: "#7a6fd0",
  muted: "#a9a1d6",
}

/** A body palette in SurfacePalette order: three backgrounds (darkest first), border, hover border, muted text. */
function surface(bg: string, bg2: string, bg3: string, border: string, borderHi: string, muted: string): SurfacePalette {
  return { bg, bg2, bg3, border, borderHi, muted }
}

export const PIXEL_WINDOW_THEMES: Readonly<Record<PixelWindowThemeId, PixelWindowTheme>> = {
  // Nova HQ: the glass tower with the cyan N.
  tasks: {
    id: "tasks",
    material: "glass-steel",
    accent: "#5fe3ff",
    accent2: "#b8f4ff",
    sign: "#071822",
    frame: { base: "#2c4a5c", light: "#6fa9c4", dark: "#17283a", line: "#08121c" },
    surface: surface("#0d1424", "#131d33", "#1b2945", "#2c4466", "#5fa6d0", "#9fbad6"),
    emblem: ["aaaaaaaaa", "a.......a", "a.b...b.a", "a.bb..b.a", "a.b.b.b.a", "a.b..bb.a", "a.b...b.a", "a.......a", "aaaaaaaaa"],
    vignette: { x: 1170, y: 230, w: 240, h: 170 },
  },
  // Power Plant: steel plates with hazard stripes, red POWER neon.
  analytics: {
    id: "analytics",
    material: "hazard",
    accent: "#ff6a52",
    accent2: "#ffd34d",
    sign: "#1c0b0a",
    frame: { base: "#3a3640", light: "#ffd34d", dark: "#16141a", line: "#0c0a0e" },
    surface: surface("#16101a", "#211723", "#2d1f2c", "#523447", "#c0607a", "#c4a6b4"),
    emblem: [".....aa..", "....aa...", "...aa....", "..aaaaaa.", "....aa...", "...aa....", "..aa.....", ".aa......", "a........"],
    vignette: { x: 2310, y: 170, w: 260, h: 186 },
  },
  // Noticeboard: wooden board, paper and pins.
  notes: {
    id: "notes",
    material: "wood",
    accent: "#ffd98a",
    accent2: "#ff6a5a",
    sign: "#1d130b",
    frame: { base: "#6b4528", light: "#9a6a3e", dark: "#3e2615", line: "#1a0f07" },
    surface: surface("#16110f", "#211a16", "#2e241d", "#55402e", "#b08856", "#c8b49c"),
    emblem: ["...b.....", "..bbb....", ".wwbwwww.", ".wwwwwww.", ".wddddww.", ".wwwwwww.", ".wdddddw.", ".wwwwwww.", "........."],
    vignette: { x: 884, y: 1140, w: 104, h: 74 },
  },
  // Town Hall: stone columns, slate roof and the blue flag.
  integrations: {
    id: "integrations",
    material: "stone",
    accent: "#8db4ff",
    accent2: "#ffd98a",
    sign: "#0c1222",
    frame: { base: "#6b6a74", light: "#9a98a2", dark: "#45444e", line: "#15141c" },
    surface: surface("#10121f", "#171a2c", "#20253c", "#363f62", "#7f97d8", "#a7b0d2"),
    emblem: ["....a....", "...aaa...", "..aaaaa..", ".aaaaaaa.", ".w.w.w.w.", ".w.w.w.w.", ".w.w.w.w.", "aaaaaaaaa", "........."],
    vignette: { x: 1160, y: 975, w: 320, h: 228 },
  },
  // Fountain Park: hedges round the fountain.
  chat: {
    id: "chat",
    material: "hedge",
    accent: "#9be870",
    accent2: "#6fd3ff",
    sign: "#0b170c",
    frame: { base: "#2f6a32", light: "#56a046", dark: "#1a4220", line: "#0a1a0c" },
    surface: surface("#0e1419", "#141e22", "#1c2a2c", "#2f4a44", "#6fb08a", "#a4c2b4"),
    emblem: ["....b....", "...b.b...", "..b.b.b..", "....b....", "....a....", ".aaaaaaa.", ".abbbbba.", "..aaaaa..", "........."],
    vignette: { x: 1830, y: 575, w: 160, h: 114 },
  },
  // Post Office: airmail stripes round the stone front and its gold POST plaque.
  schedule: {
    id: "schedule",
    material: "airmail",
    accent: "#ffd479",
    accent2: "#ff5a5a",
    sign: "#1a140a",
    frame: { base: "#efe6d2", light: "#ff5a5a", dark: "#3f6fd8", line: "#16121c" },
    surface: surface("#13111f", "#1c192c", "#27223a", "#463e5e", "#b49ad0", "#b3a9c8"),
    emblem: ["aaaaaaaaa", "aa.....aa", "a.a...a.a", "a..a.a..a", "a...b...a", "a.......a", "aaaaaaaaa", ".........", "........."],
    vignette: { x: 150, y: 960, w: 300, h: 214 },
  },
  // Bank: red brick with stone columns and a gold sign.
  crypto: {
    id: "crypto",
    material: "brick",
    accent: "#ffc94d",
    accent2: "#58f08c",
    sign: "#1d1208",
    frame: { base: "#8a3b2c", light: "#b0583f", dark: "#3c1a16", line: "#160908" },
    surface: surface("#16100f", "#211716", "#2e201d", "#573a2f", "#c48a52", "#c8ae9c"),
    emblem: ["..aaaaa..", ".a.....a.", "a...a...a", "a..aaa..a", "a..aa...a", "a...aa..a", "a..aaa..a", ".a..a..a.", "..aaaaa.."],
    vignette: { x: 2090, y: 330, w: 200, h: 143 },
  },
  // Odds Parlour: dark wood and the green ODDS neon.
  polymarket: {
    id: "polymarket",
    material: "wood",
    accent: "#56f294",
    accent2: "#ffd98a",
    sign: "#07170e",
    frame: { base: "#4a2a1c", light: "#6e4128", dark: "#2a160e", line: "#100804" },
    surface: surface("#0d1512", "#13201a", "#1a2c23", "#2c4a3a", "#5fbf88", "#a2c4b2"),
    emblem: [".........", ".wwwwwww.", ".wd...dw.", ".w.....w.", ".w..d..w.", ".w.....w.", ".wd...dw.", ".wwwwwww.", "........."],
    vignette: { x: 1040, y: 372, w: 80, h: 57 },
  },
  // Cinema: a marquee of bulbs round the pink CINEMA neon.
  youtube: {
    id: "youtube",
    material: "marquee",
    accent: "#ff6cb8",
    accent2: "#ffb04a",
    sign: "#1c0a18",
    frame: { base: "#2a1236", light: "#4a2660", dark: "#14081c", line: "#0a040e" },
    surface: surface("#140d1e", "#1e132b", "#2a1a3b", "#4a2d63", "#c06ad8", "#bea6d0"),
    emblem: ["aaaaaaaaa", "a.a.a.a.a", "aaaaaaaaa", "a.......a", "a..bb...a", "a..bbb..a", "a..bb...a", "aaaaaaaaa", "a.a.a.a.a"],
    vignette: { x: 786, y: 392, w: 156, h: 111 },
  },
  // Quest log: the Town Hall's guild board, stone with a gold star.
  quest: {
    id: "quest",
    material: "stone",
    accent: "#ffcf6a",
    accent2: "#8db4ff",
    sign: "#1a1408",
    frame: { base: "#5e5a66", light: "#8c8896", dark: "#3c3944", line: "#13111a" },
    surface: NIGHT_SURFACE,
    emblem: ["....a....", "....a....", "...aaa...", "aaaaaaaaa", ".aaaaaaa.", "..aaaaa..", "..aa.aa..", ".aa...aa.", "........."],
    vignette: { x: 1220, y: 975, w: 200, h: 143 },
  },
  // An agent's card: Nova HQ's glass, the agent's cyan visor.
  agent: {
    id: "agent",
    material: "glass-steel",
    accent: "#5fe3ff",
    accent2: "#f1ecff",
    sign: "#071822",
    frame: { base: "#34405a", light: "#7c90b8", dark: "#1a2234", line: "#090d18" },
    surface: surface("#0e1224", "#151b33", "#1e2645", "#334066", "#6f8fd8", "#a4b0d6"),
    emblem: ["..wwwww..", ".wwwwwww.", "wwaaaaaww", "wabbbbbaw", "wwaaaaaww", ".wwwwwww.", "..wwwww..", ".ww...ww.", "........."],
    vignette: { x: 1170, y: 520, w: 230, h: 164 },
  },
  // Anything else: under the NOVA arch.
  default: {
    id: "default",
    material: "stone",
    accent: "#ffcf6a",
    accent2: "#3ff2ff",
    sign: "#140f22",
    frame: { base: "#3b3470", light: "#7a6fd0", dark: "#251f45", line: "#0a0816" },
    surface: NIGHT_SURFACE,
    emblem: [".........", "....a....", "...aba...", "..abbba..", ".abbbbba.", "..abbba..", "...aba...", "....a....", "........."],
    vignette: { x: 955, y: 590, w: 216, h: 154 },
  },
}

// ── Frame tiles ─────────────────────────────────────────────────────────────

/** One frame tile pixel is this many CSS pixels: chunky enough to read as pixel art next to the painting. */
const TILE_PIXEL = 2

interface Tile {
  w: number
  h: number
  /** Fills the tile pixel at (x, y) with a colour, or leaves it the base colour (null). */
  pixel: (x: number, y: number) => string | null
}

function materialTile(theme: PixelWindowTheme): Tile {
  const { light, dark } = theme.frame
  switch (theme.material) {
    case "brick":
      // Running bond: 8x4 bricks, 1px mortar, a lit top edge on each brick.
      return {
        w: 16,
        h: 8,
        pixel: (x, y) => {
          const row = y < 4 ? 0 : 1
          const joint = row === 0 ? 0 : 8
          if (y === 0 || y === 4 || x === joint) return dark
          if (y === 1 || y === 5) return light
          return null
        },
      }
    case "wood":
      // Vertical planks with grain streaks and a dark seam.
      return {
        w: 8,
        h: 16,
        pixel: (x, y) => {
          if (x === 7) return dark
          if (x === 0) return light
          if ((x === 3 && y >= 2 && y <= 9) || (x === 5 && y >= 8 && y <= 14)) return dark
          if (x === 2 && y === 12) return light
          return null
        },
      }
    case "stone":
      // Ashlar blocks with a speckle in each.
      return {
        w: 12,
        h: 12,
        pixel: (x, y) => {
          if (y === 0 || y === 6) return dark
          if ((y < 6 && x === 0) || (y > 6 && x === 6)) return dark
          if (y === 1 || y === 7) return light
          if ((x === 4 && y === 3) || (x === 9 && y === 9)) return dark
          return null
        },
      }
    case "glass-steel":
      // Steel panels with a rivet in each corner of the tile.
      return {
        w: 10,
        h: 10,
        pixel: (x, y) => {
          if (x === 1 && y === 1) return theme.accent2
          if ((x === 2 && y === 1) || (x === 1 && y === 2)) return dark
          if (y === 9 || x === 9) return dark
          if (y === 0 || x === 0) return light
          return null
        },
      }
    case "hazard":
      // Diagonal yellow / black warning stripes.
      return { w: 8, h: 8, pixel: (x, y) => ((x + y) % 8 < 4 ? light : dark) }
    case "airmail":
      // Red / paper / blue / paper airmail envelope border.
      return {
        w: 16,
        h: 16,
        pixel: (x, y) => {
          const band = (x + y) % 16
          if (band < 4) return light
          if (band >= 8 && band < 12) return dark
          return null
        },
      }
    case "marquee":
      // Dark board with marquee bulbs in two colours.
      return {
        w: 12,
        h: 12,
        pixel: (x, y) => {
          const inBulb = (cx: number, cy: number) => (x === cx || x === cx + 1) && (y === cy || y === cy + 1)
          if (inBulb(2, 2)) return theme.accent2
          if (inBulb(8, 8)) return theme.accent
          if (y === 11 || x === 11) return dark
          return null
        },
      }
    case "hedge":
      // Clipped hedge leaves in three greens.
      return {
        w: 8,
        h: 8,
        pixel: (x, y) => {
          const n = (x * 5 + y * 3 + x * y) % 7
          if (n === 0 || n === 3) return light
          if (n === 5) return dark
          return null
        },
      }
    default: {
      const exhaustive: never = theme.material
      return exhaustive
    }
  }
}

/** The frame tile as an SVG data URI (one rect per non-base pixel, crisp edges). */
function frameTileUri(theme: PixelWindowTheme): string {
  const tile = materialTile(theme)
  const rects: string[] = [`<rect width='${tile.w}' height='${tile.h}' fill='${theme.frame.base}'/>`]
  for (let y = 0; y < tile.h; y += 1) {
    for (let x = 0; x < tile.w; x += 1) {
      const color = tile.pixel(x, y)
      if (color) rects.push(`<rect x='${x}' y='${y}' width='1' height='1' fill='${color}'/>`)
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile.w}' height='${tile.h}' shape-rendering='crispEdges'>${rects.join("")}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

type ThemeStyle = CSSProperties & Record<`--${string}`, string>

const styleCache = new Map<PixelWindowThemeId, ThemeStyle>()

/**
 * CSS custom properties for a themed window: `--pw-*` drive the frame and the sign board (pixel-ui.css, "Themed
 * popup windows"), and the `--px-*` overrides tint the modules inside so their accents match the building.
 */
export function windowThemeStyle(id: PixelWindowThemeId): ThemeStyle {
  const cached = styleCache.get(id)
  if (cached) return cached
  const theme = PIXEL_WINDOW_THEMES[id]
  const tile = materialTile(theme)
  const style: ThemeStyle = {
    "--pw-accent": theme.accent,
    "--pw-accent-2": theme.accent2,
    "--pw-sign": theme.sign,
    "--pw-frame-base": theme.frame.base,
    "--pw-frame-light": theme.frame.light,
    "--pw-frame-dark": theme.frame.dark,
    "--pw-line": theme.frame.line,
    "--pw-frame-tile": frameTileUri(theme),
    "--pw-frame-tile-size": `${tile.w * TILE_PIXEL}px ${tile.h * TILE_PIXEL}px`,
    "--px-accent": theme.accent,
    "--px-bg": theme.surface.bg,
    "--px-bg-2": theme.surface.bg2,
    "--px-bg-3": theme.surface.bg3,
    "--px-border": theme.surface.border,
    "--px-border-hi": theme.surface.borderHi,
    "--px-muted": theme.surface.muted,
  }
  styleCache.set(id, style)
  return style
}

/** Height of the title bar's building crop, in CSS pixels. */
export const VIGNETTE_HEIGHT = 44

/** Background properties that show `rect` of the painting in a VIGNETTE_HEIGHT-tall box. */
export function vignetteStyle(rect: CityRect): CSSProperties {
  const scale = VIGNETTE_HEIGHT / rect.h
  return {
    width: Math.round(rect.w * scale),
    height: VIGNETTE_HEIGHT,
    backgroundImage: `url(${DISTRICT_IMAGE_SRC})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${DISTRICT_IMAGE_WIDTH * scale}px ${DISTRICT_IMAGE_HEIGHT * scale}px`,
    backgroundPosition: `${-rect.x * scale}px ${-rect.y * scale}px`,
  }
}
