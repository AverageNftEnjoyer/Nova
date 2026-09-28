import type { CityIntegration, CityPlaceId, CityRect, CityWorkplace } from "../types"

/**
 * The District is one painted night image of Nova City (`/pixel-city/town/background.png`, 2580x1440). This file
 * maps it: which building is which Nova place or integration, where the signs are, and where people walk and cars
 * drive. Coordinates are image pixels ("plan pixels"); the renderer draws the image and everything live on top.
 */

export const DISTRICT_IMAGE_SRC = "/pixel-city/town/background.png"
export const DISTRICT_IMAGE_WIDTH = 2580
export const DISTRICT_IMAGE_HEIGHT = 1440

export interface SignRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A sign whose lettering in the image is wrong. The renderer repaints it in the image's own style: the board and
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
  /** The image's own signs for this building; a disconnected integration's sign flickers like a faulty tube. */
  signs: SignRect[]
  /** Signs whose lettering the renderer repaints (the painting spelled them wrong). */
  painted?: PaintedSign[]
}

export const DISTRICT_PLACES: readonly DistrictPlace[] = [
  // Civic places (always open).
  { id: "tasks", name: "Nova HQ", hit: { x: 1160, y: 90, w: 270, h: 560 }, signs: [] },
  { id: "deploy", name: "Depot", hit: { x: 1840, y: 880, w: 240, h: 170 }, signs: [] },
  { id: "analytics", name: "Power Plant", hit: { x: 2300, y: 120, w: 280, h: 560 }, signs: [] },
  { id: "notes", name: "Noticeboard", hit: { x: 875, y: 1160, w: 115, h: 110 }, signs: [] },
  { id: "integrations", name: "Town Hall", hit: { x: 1150, y: 980, w: 250, h: 320 }, signs: [] },
  { id: "chat", name: "Fountain Park", hit: { x: 1780, y: 560, w: 260, h: 200 }, signs: [] },
  { id: "schedule", name: "Post Office", hit: { x: 75, y: 940, w: 420, h: 360 }, integration: "gmail", signs: [{ x: 160, y: 1015, w: 100, h: 75 }] },
  { id: "crypto", name: "Bank", hit: { x: 2080, y: 200, w: 220, h: 330 }, integration: "coinbase", signs: [{ x: 2080, y: 350, w: 100, h: 80 }] },
  {
    id: "polymarket",
    name: "Odds Parlour",
    hit: { x: 1040, y: 370, w: 80, h: 190 },
    integration: "polymarket",
    signs: [],
    painted: [{ rect: { x: 1046, y: 382, w: 62, h: 48 }, text: "ODDS" }],
  },
  {
    id: "youtube",
    name: "Cinema",
    hit: { x: 790, y: 330, w: 150, h: 230 },
    integration: "youtube",
    signs: [{ x: 790, y: 408, w: 104, h: 64 }],
    painted: [{ rect: { x: 906, y: 356, w: 32, h: 136 }, text: "CINEMA", vertical: true }],
  },

  // One building per integration (the rest).
  {
    id: "integration-spotify",
    name: "Records",
    hit: { x: 940, y: 420, w: 100, h: 140 },
    integration: "spotify",
    signs: [],
    painted: [{ rect: { x: 946, y: 436, w: 96, h: 52 }, text: "RECORDS" }],
  },
  { id: "integration-discord", name: "Arcade", hit: { x: 545, y: 460, w: 260, h: 240 }, integration: "discord", signs: [{ x: 668, y: 498, w: 132, h: 72 }] },
  { id: "integration-slack", name: "Cowork", hit: { x: 1630, y: 90, w: 300, h: 330 }, integration: "slack", signs: [{ x: 1745, y: 150, w: 124, h: 60 }] },
  { id: "integration-openai", name: "Lab", hit: { x: 1430, y: 140, w: 200, h: 340 }, integration: "openai", signs: [{ x: 1560, y: 252, w: 72, h: 58 }] },
  { id: "integration-claude", name: "Studio", hit: { x: 350, y: 130, w: 300, h: 340 }, integration: "claude", signs: [{ x: 515, y: 312, w: 108, h: 64 }] },
  { id: "integration-grok", name: "Observatory", hit: { x: 0, y: 150, w: 330, h: 320 }, integration: "grok", signs: [{ x: 128, y: 262, w: 180, h: 118 }] },
  { id: "integration-gemini", name: "Gemini Tower", hit: { x: 1400, y: 780, w: 300, h: 400 }, integration: "gemini", signs: [] },
  {
    id: "integration-telegram",
    name: "Telegraph",
    hit: { x: 1870, y: 60, w: 210, h: 420 },
    integration: "telegram",
    signs: [],
    painted: [{ rect: { x: 1872, y: 330, w: 92, h: 34 }, text: "TELEGRAPH" }],
  },
  { id: "integration-gmail-calendar", name: "Clock Tower", hit: { x: 1680, y: 530, w: 130, h: 470 }, integration: "gmail-calendar", signs: [] },
  { id: "integration-brave", name: "Library", hit: { x: 2060, y: 1150, w: 180, h: 160 }, integration: "brave", signs: [{ x: 2072, y: 1162, w: 156, h: 50 }] },
  { id: "integration-phantom", name: "Vault", hit: { x: 2310, y: 990, w: 270, h: 320 }, integration: "phantom", signs: [{ x: 2358, y: 1112, w: 114, h: 74 }] },
]

// ── Walkways ────────────────────────────────────────────────────────────────

export type WalkNodeId = string

/** Walkable points on the plaza, cobbled streets, boardwalks, stairs, park loop and sidewalks. */
export const WALK_NODES: Readonly<Record<WalkNodeId, readonly [number, number]>> = {
  g: [1300, 668], // Nova HQ's door
  p1: [1130, 730], // plaza, under the NOVA arch
  p2: [1480, 670], // plaza, east
  p3: [1350, 770], // plaza, south
  c1: [990, 640], // cobbled street
  cin: [900, 570], // Cinema, Records and Odds doors
  arc: [735, 700], // Arcade door
  s1: [640, 470],
  stu: [540, 470], // Studio door
  obs: [300, 455], // Observatory steps
  bw1: [1010, 830], // boardwalk
  bw2: [800, 940],
  bw3: [610, 1030], // top of the stairs
  str1: [560, 1170], // bottom of the stairs
  sw1: [720, 1240], // sidewalk
  nts: [930, 1270], // noticeboard
  th: [1190, 1250], // Town Hall steps
  gem: [1450, 1270], // Gemini Tower
  sw0: [420, 1300], // bus stop
  pst: [260, 1270], // Post Office door
  e1: [1560, 580], // deck stairs
  lab: [1570, 470], // Lab door
  cow: [1760, 440], // Cowork door
  deck: [1880, 470], // lantern deck
  tel: [1980, 440], // Telegraph door
  bnk: [2170, 490], // Bank door
  pwr: [2390, 640], // Power Plant door
  k0: [1820, 560], // park loop
  k1: [1790, 660],
  k2: [1950, 580],
  k3: [2040, 700],
  k4: [1880, 780],
  fnt: [1905, 700], // by the fountain
  pk5: [1880, 880],
  dep: [1960, 1030], // Depot platform
  g2: [2250, 1080], // under the viaduct
  vlt: [2410, 1235], // Vault door
  lib: [2150, 1300], // Library board
}

export const WALK_EDGES: ReadonlyArray<readonly [WalkNodeId, WalkNodeId]> = [
  ["g", "p1"], ["g", "p2"], ["p1", "p3"], ["p2", "p3"],
  ["p1", "c1"], ["c1", "cin"], ["cin", "s1"], ["c1", "arc"], ["s1", "stu"], ["stu", "obs"],
  ["p1", "bw1"], ["bw1", "bw2"], ["bw2", "bw3"], ["bw3", "str1"], ["str1", "sw1"], ["sw1", "nts"], ["nts", "th"], ["th", "gem"], ["str1", "sw0"], ["sw0", "pst"],
  ["p2", "e1"], ["e1", "lab"], ["e1", "k0"], ["lab", "cow"], ["cow", "deck"], ["deck", "tel"], ["deck", "k0"], ["tel", "bnk"], ["bnk", "pwr"],
  ["k0", "k1"], ["k0", "k2"], ["k1", "k4"], ["k2", "k3"], ["k3", "k4"], ["k1", "fnt"], ["k4", "pk5"], ["pk5", "dep"], ["dep", "g2"], ["g2", "vlt"], ["g2", "lib"],
]

/** Where agents report for work at each workplace. */
export const WORKPLACE_DOOR: Readonly<Record<CityWorkplace, WalkNodeId>> = {
  hq: "g",
  lab: "lab",
  comms: "tel",
  post: "pst",
  bank: "bnk",
  parlour: "cin",
  cinema: "cin",
  library: "lib",
  power: "pwr",
  depot: "dep",
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
  depot: "Depot",
}

/** Car lanes (polylines, drawn as moving cars in both directions). */
export const ROADS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 1290], [640, 1440]],
  [[600, 1390], [1130, 1200]],
]

// ── Live details ─────────────────────────────────────────────────────────────

/** Five task floors: glass bands on Nova HQ's two faces, below the N emblem, top floor first. */
export const HQ_FLOORS: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 1180, y: 340 + i * 30, w: 90, h: 7 }))
export const HQ_FLOORS_RIGHT: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 1312, y: 340 + i * 30, w: 84, h: 7 }))
/** The NOVA arch sign: it breathes while an agent is working. */
export const HQ_SIGN: SignRect = { x: 955, y: 590, w: 215, h: 110 }

/** The bus shelter's roof strip: live crypto ticker. */
export const TICKER_BOARD: SignRect = { x: 402, y: 1208, w: 76, h: 14 }
/** Noticeboard face: one paper per note. */
export const NOTICE_FACE: SignRect = { x: 898, y: 1205, w: 68, h: 40 }
export const FOUNTAIN = { x: 1902, y: 628, basinY: 668 }
/** Nova the cat's bench in the park. */
export const CAT_SPOT = { x: 1885, y: 574 }
export const LAMPS: ReadonlyArray<readonly [number, number]> = [
  [1100, 525],
  [1577, 537],
  [1496, 650],
  [1330, 700],
]
