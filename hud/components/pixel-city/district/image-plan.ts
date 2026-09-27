import type { CityIntegration, CityPlaceId, CityRect, CityWorkplace } from "../types"

/**
 * The District is one painted night image (`/pixel-city/town/district-night.png`). This file maps it: which
 * building is which Nova place or integration, where the signs are, and where people can walk and cars can drive.
 * Every number is an image pixel. The renderer paints the image, then the live layer on top of it.
 */

export const DISTRICT_IMAGE_SRC = "/pixel-city/town/district-night.png"
export const DISTRICT_IMAGE_WIDTH = 1376
export const DISTRICT_IMAGE_HEIGHT = 768

export interface SignRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A sign whose lettering in the image was wrong. The renderer repaints it in the image's own style: the board and
 * letter colours are sampled from the original sign, the letters get the same neon glow.
 */
export interface PaintedSign {
  rect: SignRect
  text: string
  /** Letters stacked top to bottom (hanging banners). */
  vertical?: boolean
}

export interface DistrictPlace {
  id: CityPlaceId
  /** What the building is called on screen and in its popup. */
  name: string
  hit: CityRect
  /** The integration that lights this building's sign; civic places are always lit. */
  integration?: CityIntegration
  /** The image's own signs for this building; they go dark while the integration is disconnected. */
  signs: SignRect[]
  painted?: PaintedSign
}

export const DISTRICT_PLACES: readonly DistrictPlace[] = [
  // Civic places (always open).
  { id: "tasks", name: "Nova HQ", hit: { x: 540, y: 104, w: 300, h: 196, markerX: 690, markerY: 104 }, signs: [] },
  { id: "deploy", name: "Bus Depot", hit: { x: 1140, y: 284, w: 136, h: 104 }, signs: [] },
  {
    id: "analytics",
    name: "Power Plant",
    hit: { x: 1106, y: 64, w: 128, h: 236 },
    signs: [],
    painted: { rect: { x: 1140, y: 216, w: 58, h: 28 }, text: "POWER" },
  },
  {
    id: "notes",
    name: "Noticeboard",
    hit: { x: 650, y: 604, w: 78, h: 66 },
    signs: [],
    painted: { rect: { x: 662, y: 609, w: 58, h: 12 }, text: "NOTES" },
  },
  { id: "integrations", name: "Town Hall", hit: { x: 776, y: 530, w: 140, h: 118 }, signs: [{ x: 846, y: 568, w: 68, h: 46 }] },
  { id: "chat", name: "Fountain Park", hit: { x: 1000, y: 392, w: 156, h: 112 }, signs: [] },
  { id: "schedule", name: "Post Office", hit: { x: 0, y: 482, w: 250, h: 218 }, integration: "gmail", signs: [{ x: 102, y: 528, w: 58, h: 46 }] },
  {
    id: "crypto",
    name: "Bank",
    hit: { x: 996, y: 182, w: 112, h: 140 },
    integration: "coinbase",
    signs: [],
    painted: { rect: { x: 1103, y: 252, w: 48, h: 26 }, text: "BANK" },
  },
  { id: "polymarket", name: "Odds Parlour", hit: { x: 690, y: 330, w: 78, h: 150 }, integration: "polymarket", signs: [{ x: 694, y: 346, w: 60, h: 32 }] },
  { id: "youtube", name: "Cinema", hit: { x: 608, y: 306, w: 88, h: 80 }, integration: "youtube", signs: [{ x: 616, y: 346, w: 68, h: 40 }] },

  // One building per integration (the rest).
  { id: "integration-spotify", name: "Records", hit: { x: 608, y: 386, w: 88, h: 98 }, integration: "spotify", signs: [{ x: 618, y: 386, w: 72, h: 28 }] },
  { id: "integration-discord", name: "Arcade", hit: { x: 445, y: 286, w: 150, h: 160 }, integration: "discord", signs: [{ x: 450, y: 350, w: 56, h: 32 }] },
  { id: "integration-slack", name: "Cowork", hit: { x: 780, y: 362, w: 150, h: 104 }, integration: "slack", signs: [{ x: 864, y: 364, w: 64, h: 34 }, { x: 788, y: 376, w: 58, h: 36 }] },
  { id: "integration-openai", name: "Lab", hit: { x: 800, y: 270, w: 106, h: 92 }, integration: "openai", signs: [{ x: 862, y: 284, w: 40, h: 34 }] },
  { id: "integration-claude", name: "Studio", hit: { x: 118, y: 146, w: 146, h: 164 }, integration: "claude", signs: [{ x: 198, y: 220, w: 56, h: 40 }] },
  { id: "integration-grok", name: "Observatory", hit: { x: 0, y: 116, w: 108, h: 190 }, integration: "grok", signs: [{ x: 26, y: 208, w: 84, h: 48 }] },
  {
    id: "integration-gemini",
    name: "Gemini Tower",
    hit: { x: 300, y: 100, w: 160, h: 250 },
    integration: "gemini",
    signs: [],
  },
  { id: "integration-telegram", name: "Telegraph", hit: { x: 882, y: 150, w: 118, h: 158 }, integration: "telegram", signs: [{ x: 886, y: 212, w: 72, h: 50 }] },
  { id: "integration-gmail-calendar", name: "Clock Tower", hit: { x: 1238, y: 140, w: 96, h: 184 }, integration: "gmail-calendar", signs: [] },
  {
    id: "integration-brave",
    name: "Library",
    hit: { x: 950, y: 300, w: 92, h: 66 },
    integration: "brave",
    signs: [],
    painted: { rect: { x: 953, y: 309, w: 84, h: 44 }, text: "LIBRARY" },
  },
  {
    id: "integration-phantom",
    name: "Vault",
    hit: { x: 1180, y: 430, w: 196, h: 240 },
    integration: "phantom",
    signs: [{ x: 1266, y: 498, w: 74, h: 88 }],
    painted: { rect: { x: 1210, y: 448, w: 26, h: 82 }, text: "VAULT", vertical: true },
  },
]

// ── Walkways ────────────────────────────────────────────────────────────────

export type WalkNodeId = string

/** Walkable points on the decks, stairs, plaza and park paths. */
export const WALK_NODES: Readonly<Record<WalkNodeId, readonly [number, number]>> = {
  a: [230, 455], // upper-left walkway
  b: [330, 415],
  c: [430, 398],
  d: [520, 437], // in front of the Arcade
  e: [610, 478], // in front of the Cinema and Records
  f: [665, 502], // Nova HQ plaza
  g: [740, 462], // in front of the Odds Parlour
  h: [815, 452], // in front of the Lab and Cowork
  st: [585, 505], // top of the left stairs
  j: [480, 604], // bottom of the left stairs
  k: [330, 590],
  l: [230, 575], // Post Office steps
  m: [600, 650], // plaza
  n: [690, 700],
  o: [770, 660], // noticeboard
  p: [900, 640], // Town Hall door
  w: [900, 425],
  q: [960, 300], // Telegraph door
  r: [1000, 370], // Library and Bank
  s: [1040, 420], // park gate
  t: [1050, 478], // fountain
  u: [1110, 420], // park bench
  v: [1090, 505],
  y: [1120, 360], // Depot and Power Plant
}

export const WALK_EDGES: ReadonlyArray<readonly [WalkNodeId, WalkNodeId]> = [
  ["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "f"], ["f", "g"], ["g", "h"],
  ["e", "st"], ["st", "j"], ["j", "k"], ["k", "l"], ["j", "m"], ["m", "n"], ["n", "o"], ["o", "p"],
  ["h", "w"], ["w", "s"], ["q", "r"], ["r", "s"], ["s", "t"], ["s", "u"], ["t", "v"], ["r", "y"],
]

/** Where agents report for work at each workplace. */
export const WORKPLACE_DOOR: Readonly<Record<CityWorkplace, WalkNodeId>> = {
  hq: "f",
  lab: "h",
  comms: "q",
  post: "l",
  bank: "r",
  parlour: "g",
  cinema: "e",
  library: "r",
  power: "y",
  depot: "y",
}

export const WORKPLACE_NAME: Readonly<Record<CityWorkplace, string>> = {
  hq: "Nova HQ",
  lab: "Lab",
  comms: "Telegraph",
  post: "Post Office",
  bank: "Bank",
  parlour: "Odds Parlour",
  cinema: "Cinema",
  library: "Library",
  power: "Power Plant",
  depot: "Bus Depot",
}

/** Car lanes (polylines, drawn as moving cars in both directions). */
export const ROADS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[160, 590], [620, 768]],
  [[760, 768], [1376, 470]],
]

// ── Live details ─────────────────────────────────────────────────────────────

/** Five task floors: glass bands on either side of the HQ emblem, top floor first. */
export const HQ_FLOORS: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 598, y: 214 + i * 16, w: 34, h: 5 }))
export const HQ_FLOORS_RIGHT: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 760, y: 214 + i * 16, w: 30, h: 5 }))
export const HQ_SIGN: SignRect = { x: 540, y: 116, w: 298, h: 94 }

/** The blank billboard at the bottom right: live crypto ticker. */
export const TICKER_BOARD: SignRect = { x: 1126, y: 672, w: 58, h: 12 }
/** Noticeboard face: one paper per note. */
export const NOTICE_FACE: SignRect = { x: 664, y: 626, w: 54, h: 30 }
export const FOUNTAIN = { x: 1057, y: 418, basinY: 455 }
export const CAT_SPOT = { x: 1123, y: 414 }
export const LAMPS: ReadonlyArray<readonly [number, number]> = [
  [340, 622],
  [428, 690],
  [905, 700],
]
