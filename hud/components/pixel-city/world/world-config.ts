import { DISTRICT_MAP } from "../district/image-plan"

/**
 * Everything the PixiJS world places on the map that is not game data: lit windows, waterfalls, water
 * detection, clouds. Positions are authored on a 2000 x 1504 preview of the map (`TRACE_SIZE`; the source map is 2.5x
 * that) and converted to plan pixels through DISTRICT_MAP, so swapping in the same composition at another resolution
 * needs no change here. A map with a different composition needs these re-traced (look at the map, read the
 * coordinates off the 2000-wide view).
 */
export const TRACE_SIZE = { w: 2000, h: 1504 } as const

/** A point authored in trace space, in plan pixels. */
export function traced(x: number, y: number): { x: number; y: number } {
  return { x: DISTRICT_MAP.x + (x / TRACE_SIZE.w) * DISTRICT_MAP.w, y: DISTRICT_MAP.y + (y / TRACE_SIZE.h) * DISTRICT_MAP.h }
}

/** Plan pixels per trace pixel (the map is uniformly scaled, so one number serves both axes). */
export const TRACE_TO_PLAN = DISTRICT_MAP.w / TRACE_SIZE.w

// ── Night lights ──────────────────────────────────────────────────────────────

export type LightTone = "warm" | "cool" | "pink"

/** Glow colours (additive). */
export const LIGHT_COLORS: Readonly<Record<LightTone, { glow: number; core: number }>> = {
  warm: { glow: 0xffb84a, core: 0xfff0b8 },
  cool: { glow: 0x62d8ff, core: 0xe2faff },
  pink: { glow: 0xff7ac2, core: 0xffe0f0 },
}

export interface WindowLight {
  /** Plan pixels. */
  x: number
  y: number
  /** Glow radius in plan pixels. */
  r: number
  tone: LightTone
}

const lights: Array<[number, number, number, LightTone]> = [
  // U.B Agents HQ: the great round window, the stained glass above it and the doorway.
  [283, 425, 20, "cool"], [252, 288, 12, "cool"], [266, 266, 9, "warm"], [285, 495, 9, "warm"],
  // Arcade (blue spiked hall).
  [622, 494, 12, "cool"], [613, 469, 7, "pink"], [634, 467, 7, "pink"], [665, 467, 7, "cool"], [680, 504, 10, "warm"],
  // Yellow garden houses and the blue shark hall.
  [465, 462, 7, "warm"], [513, 462, 7, "warm"], [509, 596, 7, "warm"], [534, 627, 7, "warm"],
  [661, 660, 8, "warm"], [705, 640, 8, "warm"], [697, 688, 8, "cool"],
  // Telegraph.
  [851, 898, 7, "warm"], [868, 908, 7, "warm"],
  // Gemini Tower, floor by floor.
  [947, 862, 6, "warm"], [975, 884, 7, "cool"], [1004, 889, 7, "warm"], [966, 917, 7, "warm"], [990, 939, 7, "cool"], [1006, 946, 7, "warm"],
  // Lab.
  [1013, 813, 7, "cool"], [1090, 811, 7, "cool"],
  // Cinema.
  [1176, 812, 8, "cool"], [1175, 865, 8, "warm"], [1156, 860, 7, "warm"], [1219, 854, 7, "warm"],
  // Orange domes by the plaza, Town Hall, Studio.
  [873, 948, 7, "cool"], [859, 989, 8, "warm"], [897, 1003, 8, "warm"],
  [1066, 1003, 13, "cool"], [1082, 931, 9, "cool"], [1135, 955, 9, "warm"], [1061, 960, 8, "warm"], [1028, 1027, 8, "pink"],
  [1234, 906, 8, "cool"], [1253, 934, 8, "warm"], [1306, 924, 8, "warm"], [1266, 959, 8, "warm"],
  // Bank: the orb, the tower, the pillars and the gate.
  [1359, 727, 13, "pink"], [1356, 768, 9, "warm"], [1319, 771, 8, "warm"], [1392, 771, 8, "warm"], [1350, 818, 10, "warm"],
  // Power Plant.
  [1581, 809, 11, "cool"], [1584, 840, 11, "cool"], [1600, 877, 9, "warm"],
  // Observatory, Library, the egg house and the lantern gate.
  [732, 293, 10, "warm"], [737, 333, 8, "warm"],
  [1022, 429, 10, "cool"], [1007, 533, 8, "warm"], [1030, 533, 8, "warm"], [993, 520, 7, "warm"],
  [1171, 413, 7, "warm"], [1190, 427, 7, "warm"], [1071, 373, 8, "warm"],
  // The depot ship, its pier and the clock tower.
  [292, 1082, 9, "warm"], [270, 1097, 8, "warm"], [139, 1139, 8, "warm"], [132, 1005, 6, "warm"], [327, 1127, 8, "warm"], [326, 1226, 8, "warm"],
  [516, 1263, 8, "warm"], [508, 1247, 8, "warm"],
  // Cowork's orange arches.
  [987, 1093, 8, "warm"], [1021, 1134, 8, "warm"], [968, 1152, 8, "warm"], [993, 1181, 8, "warm"], [1031, 1171, 8, "warm"],
  [1074, 1124, 8, "warm"], [1081, 1162, 8, "warm"], [1174, 1099, 8, "warm"], [1171, 1152, 8, "warm"], [1156, 1156, 7, "cool"], [1224, 1099, 8, "warm"], [1234, 1143, 8, "warm"],
]

export const WINDOW_LIGHTS: readonly WindowLight[] = lights.map(([x, y, r, tone]) => ({ ...traced(x, y), r, tone }))

// ── Water ─────────────────────────────────────────────────────────────────────

/**
 * Where water is: read from the map's own pixels (open water is the saturated cyan-blue; the blues of buildings are
 * duller), so the shimmer follows the art. The map is sampled on a grid of `cell` source pixels; a water cell whose
 * four neighbours are not all water is dropped, which removes speckle from blue windows and roofs.
 */
export const WATER_MASK = {
  hueMin: 180,
  hueMax: 212,
  minSaturation: 0.6,
  minValue: 0.6,
  cell: 8,
  maxGlints: 260,
} as const

// ── Waterfalls ────────────────────────────────────────────────────────────────

export interface Waterfall {
  /** Centre line and extent of the falling water (plan pixels). */
  x: number
  top: number
  bottom: number
  halfWidth: number
  /** How strong the spray / mist is (1 = the big fall). */
  power: number
}

const fall = (x: number, top: number, bottom: number, halfWidth: number, power: number): Waterfall => {
  const a = traced(x - halfWidth, top)
  const b = traced(x + halfWidth, bottom)
  return { x: (a.x + b.x) / 2, top: a.y, bottom: b.y, halfWidth: (b.x - a.x) / 2, power }
}

export const WATERFALLS: readonly Waterfall[] = [
  fall(1503, 250, 445, 13, 1), // the big fall into the north-east pool
  fall(680, 66, 108, 8, 0.45), // the two small falls on the plateau
  fall(1465, 66, 108, 8, 0.45),
]

/** Total particle budgets (shared across falls). */
export const PARTICLE_CAPS = { spray: 54, mist: 18 } as const

// ── Clouds ────────────────────────────────────────────────────────────────────

export const CLOUDS = {
  count: 6,
  /** Plan pixels per second. */
  speedMin: 5,
  speedMax: 9,
  widthMin: 420,
  widthMax: 760,
  heightMin: 170,
  heightMax: 300,
  color: 0x0f2650,
  alpha: 0.1,
  /** Fraction of the camera's offset from the map centre by which the cloud layer lags behind (depth). */
  parallax: 0.06,
} as const
