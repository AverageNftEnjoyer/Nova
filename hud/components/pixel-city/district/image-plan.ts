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

export interface DistrictPlace {
  id: CityPlaceId
  /** What the building is called on screen and in its popup. */
  name: string
  hit: CityRect
  /** The integration that lights this building's sign; civic places are always lit. */
  integration?: CityIntegration
  /** The image's own signs for this building; a disconnected integration's sign flickers like a faulty tube. */
  signs: SignRect[]
}

export const DISTRICT_PLACES: readonly DistrictPlace[] = [
  // Civic places (always open).
  { id: "tasks", name: "Nova HQ", hit: { x: 1150, y: 40, w: 272, h: 632 }, signs: [] },
  { id: "deploy", name: "Depot", hit: { x: 1834, y: 872, w: 246, h: 212 }, signs: [] },
  { id: "analytics", name: "Power Plant", hit: { x: 2300, y: 120, w: 280, h: 560 }, signs: [] },
  { id: "notes", name: "Noticeboard", hit: { x: 880, y: 1135, w: 108, h: 158 }, signs: [] },
  { id: "integrations", name: "Town Hall", hit: { x: 1140, y: 965, w: 360, h: 353 }, signs: [] },
  { id: "chat", name: "Fountain Park", hit: { x: 1780, y: 560, w: 260, h: 200 }, signs: [] },
  { id: "schedule", name: "Post Office", hit: { x: 80, y: 860, w: 420, h: 412 }, integration: "gmail", signs: [{ x: 160, y: 1015, w: 100, h: 75 }] },
  { id: "crypto", name: "Bank", hit: { x: 2080, y: 200, w: 220, h: 330 }, integration: "coinbase", signs: [{ x: 2126, y: 388, w: 54, h: 52 }] },
  {
    id: "polymarket",
    name: "Odds Parlour",
    hit: { x: 1040, y: 370, w: 80, h: 190 },
    integration: "polymarket",
    signs: [{ x: 1046, y: 382, w: 62, h: 48 }],
  },
  {
    id: "youtube",
    name: "Cinema",
    hit: { x: 785, y: 240, w: 157, h: 335 },
    integration: "youtube",
    signs: [{ x: 790, y: 408, w: 104, h: 64 }, { x: 906, y: 346, w: 34, h: 124 }],
  },

  // One building per integration (the rest).
  {
    id: "integration-spotify",
    name: "Records",
    hit: { x: 940, y: 420, w: 100, h: 140 },
    integration: "spotify",
    signs: [{ x: 946, y: 436, w: 96, h: 52 }],
  },
  { id: "integration-discord", name: "Arcade", hit: { x: 544, y: 452, w: 270, h: 260 }, integration: "discord", signs: [{ x: 668, y: 498, w: 132, h: 72 }] },
  { id: "integration-slack", name: "Cowork", hit: { x: 1630, y: 70, w: 240, h: 360 }, integration: "slack", signs: [{ x: 1745, y: 150, w: 124, h: 60 }] },
  { id: "integration-openai", name: "Lab", hit: { x: 1420, y: 140, w: 240, h: 372 }, integration: "openai", signs: [{ x: 1560, y: 252, w: 72, h: 58 }] },
  { id: "integration-claude", name: "Studio", hit: { x: 350, y: 90, w: 300, h: 400 }, integration: "claude", signs: [{ x: 515, y: 312, w: 108, h: 64 }] },
  { id: "integration-grok", name: "Observatory", hit: { x: 0, y: 150, w: 330, h: 320 }, integration: "grok", signs: [{ x: 128, y: 262, w: 180, h: 118 }] },
  { id: "integration-gemini", name: "Gemini Tower", hit: { x: 1452, y: 740, w: 250, h: 516 }, integration: "gemini", signs: [] },
  {
    id: "integration-telegram",
    name: "Telegraph",
    hit: { x: 1870, y: 60, w: 210, h: 420 },
    integration: "telegram",
    signs: [{ x: 1874, y: 310, w: 88, h: 58 }],
  },
  { id: "integration-gmail-calendar", name: "Clock Tower", hit: { x: 1680, y: 486, w: 140, h: 512 }, integration: "gmail-calendar", signs: [] },
  { id: "integration-brave", name: "Library", hit: { x: 2060, y: 1150, w: 180, h: 160 }, integration: "brave", signs: [{ x: 2072, y: 1162, w: 156, h: 50 }] },
  { id: "integration-phantom", name: "Vault", hit: { x: 2310, y: 990, w: 270, h: 320 }, integration: "phantom", signs: [{ x: 2358, y: 1112, w: 114, h: 74 }] },
]

// ── Walkways ────────────────────────────────────────────────────────────────

export type WalkNodeId = string

/**
 * Walkable points (feet positions) on open paving: the cobbled streets, the round plaza, boardwalks, stairs, the park
 * loop and the sidewalks. A walker's body rises about 63 px above its feet, so every node and every straight run
 * between two nodes keeps the feet on paving that is visible in the painting, in front of the building being passed
 * (never on a roof, never inside a footprint). Where a run passes behind something (the NOVA arch, the clock tower,
 * a tree, the viaduct), an entry in DISTRICT_OCCLUDERS redraws that structure over the walker.
 */
export const WALK_NODES: Readonly<Record<WalkNodeId, readonly [number, number]>> = {
  // North-west: the Observatory and Studio street, then the stairs down beside the Arcade.
  obs: [282, 500], // foot of the Observatory steps
  nw1: [410, 515], // cobbled street
  stu: [548, 480], // Studio door
  stT: [515, 578], // top of the stairs beside the Arcade
  stM: [575, 646], // halfway down (the terrace joins here)
  stB: [628, 706], // foot of the stairs, at the Arcade's corner
  wUp: [440, 702], // terrace walk in front of the corner shop
  shop: [272, 802], // corner shop (awning and vending machine)
  wW1: [350, 925], // west boardwalk, behind the Post Office
  wW2: [480, 1000],
  // The Arcade square, the Cinema block and the NOVA arch.
  arc: [748, 702], // Arcade door
  m1: [848, 700], // lane between the Arcade and the Cinema
  cin: [922, 592], // Cinema door (Records next to it)
  odd: [1075, 532], // Odds Parlour door
  pw0: [1150, 610], // west of Nova HQ, above the arch sign
  sq: [885, 845], // lower cobbled square
  as: [1050, 865], // under the NOVA arch, square side
  an: [1120, 790], // under the NOVA arch, on the plaza stairs
  // The round plaza and Nova HQ.
  g: [1228, 682], // Nova HQ's door
  pw: [1225, 745], // round plaza, west
  p3: [1390, 800], // round plaza, south
  p2: [1462, 690], // round plaza, east
  // The lantern deck (Lab, Cowork, Telegraph) and the Bank / Power Plant sidewalk.
  e1: [1500, 612], // foot of the deck stairs
  e2: [1560, 555], // top of the deck stairs
  lab: [1592, 524], // Lab door
  dk1: [1712, 470], // lantern deck
  cow: [1790, 440], // Cowork door
  tel: [1992, 458], // Telegraph door
  dkS: [2062, 515], // deck corner above the park stairs
  bnk: [2158, 532], // Bank steps
  pd: [2262, 578], // sidewalk between the Bank and the Power Plant
  pwr: [2365, 630], // Power Plant door
  // The park: stairs down from the deck, the dirt ring round the fountain, the path south to the Depot.
  pkB: [2028, 600], // foot of the park stairs
  kN: [1925, 598], // ring, north (by Nova's bench)
  kE: [1995, 665], // ring, east
  kS: [1905, 786], // ring, south
  kNW: [1830, 618], // ring, north-west (under the clock tower's eaves)
  kW: [1836, 700], // ring, west (beside the clock tower)
  kSW: [1842, 775], // ring, south-west
  kD1: [1845, 830], // path south
  kD2: [1860, 905],
  kD3: [1822, 1010], // between the clock tower and the Depot
  pl1: [1852, 1110], // platform, west end
  dep: [1985, 1052], // Depot platform
  // South of the plaza: the deck and stairs down behind the Town Hall, then the square's stairs to the street.
  pS1: [1400, 845], // deck below the plaza
  pS2: [1295, 952], // foot of the deck stairs
  th1: [1200, 995], // boardwalk behind the Town Hall
  tB: [1112, 1040], // top of the square's stairs
  bB: [1030, 1185], // foot of the square's stairs
  // The elevated walkway to the west and the street below it.
  wk1: [815, 930], // walkway, square end
  wk2: [700, 985],
  wk3: [585, 1052], // walkway, top of the street stairs
  fA: [635, 1212], // foot of the street stairs
  sw0: [455, 1305], // bus stop
  pst: [222, 1246], // Post Office door
  xw: [668, 1300], // crossing to the noticeboard corner
  nts: [948, 1298], // in front of the noticeboard
  // The south sidewalk: Town Hall, Gemini Tower, under the viaduct to the Library and the Vault.
  th: [1165, 1302], // foot of the Town Hall steps
  s1: [1420, 1334],
  gem: [1630, 1278], // Gemini Tower door
  v2: [1840, 1338], // sidewalk past the viaduct
  lib: [2150, 1318], // Library board
  vlt: [2398, 1295], // Vault door
}

export const WALK_EDGES: ReadonlyArray<readonly [WalkNodeId, WalkNodeId]> = [
  ["obs", "nw1"], ["nw1", "stu"], ["nw1", "stT"], ["stu", "stT"], ["stT", "stM"], ["stM", "stB"], ["stM", "wUp"],
  ["wUp", "shop"], ["shop", "wW1"], ["wW1", "wW2"], ["wW2", "wk3"],
  ["stB", "arc"], ["arc", "m1"], ["arc", "sq"], ["m1", "sq"], ["m1", "cin"], ["cin", "odd"], ["odd", "pw0"], ["pw0", "g"],
  ["sq", "as"], ["as", "an"], ["an", "pw"], ["pw", "g"], ["pw", "p3"], ["p3", "p2"],
  ["p2", "e1"], ["e1", "e2"], ["e2", "lab"], ["lab", "dk1"], ["dk1", "cow"], ["cow", "tel"], ["tel", "dkS"], ["dkS", "bnk"],
  ["bnk", "pd"], ["pd", "pwr"],
  ["dkS", "pkB"], ["pkB", "kN"], ["pkB", "kE"], ["kN", "kNW"], ["kNW", "kW"], ["kW", "kSW"], ["kSW", "kS"], ["kS", "kE"],
  ["kSW", "kD1"], ["kD1", "kD2"],
  ["kD2", "kD3"], ["kD3", "pl1"], ["pl1", "dep"],
  ["p3", "pS1"], ["pS1", "pS2"], ["pS2", "th1"], ["th1", "tB"], ["tB", "as"], ["tB", "bB"], ["bB", "nts"],
  ["sq", "wk1"], ["wk1", "wk2"], ["wk2", "wk3"], ["wk3", "fA"], ["fA", "sw0"], ["sw0", "pst"], ["fA", "xw"], ["xw", "nts"],
  ["nts", "th"], ["th", "s1"], ["s1", "gem"], ["s1", "v2"], ["gem", "v2"], ["v2", "lib"], ["lib", "vlt"],
]

/** Where agents report for work at each workplace: the node in front of that building's door. */
export const WORKPLACE_DOOR: Readonly<Record<CityWorkplace, WalkNodeId>> = {
  hq: "g",
  lab: "lab",
  comms: "tel",
  post: "pst",
  bank: "bnk",
  parlour: "odd",
  cinema: "cin",
  library: "lib",
  power: "pwr",
  depot: "dep",
}

/** Where an integration's worker stands: the walk node in front of that integration's own building. */
export const INTEGRATION_DOOR: Readonly<Record<CityIntegration, WalkNodeId>> = {
  telegram: "tel",
  discord: "arc",
  slack: "cow",
  openai: "lab",
  claude: "stu",
  grok: "obs",
  gemini: "gem",
  spotify: "cin", // Records stands next to the Cinema's door
  youtube: "cin",
  gmail: "pst",
  "gmail-calendar": "kW", // beside the clock tower
  brave: "lib",
  coinbase: "bnk",
  phantom: "vlt",
  polymarket: "odd",
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

// ── Depth ────────────────────────────────────────────────────────────────────

export type PlanPoint = readonly [number, number]

/**
 * A structure that stands in front of some walkable paving. Walkers are drawn over the painting, so a walker whose
 * feet are behind the structure (above its `base` line on screen) gets the structure redrawn from the painting over
 * it, clipped to `shapes`: people pass behind the arch legs, the clock tower, trees and the viaduct instead of
 * walking across them.
 */
export interface DistrictOccluder {
  id: string
  /** Outlines traced from the painting, in plan pixels (several for a structure with separate parts). */
  shapes: ReadonlyArray<ReadonlyArray<PlanPoint>>
  /**
   * The structure's front edge on the ground, west to east (x increasing). A walker whose feet are above it at the
   * walker's x is behind the structure; past either end the nearest end point's y applies.
   */
  base: ReadonlyArray<PlanPoint>
}

export const DISTRICT_OCCLUDERS: readonly DistrictOccluder[] = [
  {
    id: "arcade",
    shapes: [[[544, 522], [678, 454], [765, 500], [808, 496], [812, 545], [812, 668], [770, 672], [684, 710], [548, 590]]],
    base: [[548, 590], [684, 710], [812, 669]],
  },
  {
    id: "nova-arch",
    shapes: [
      [
        [964, 600], [1060, 603], [1115, 616], [1165, 643], [1205, 678], [1220, 712], [1220, 895], [1175, 895], [1176, 775],
        [1152, 734], [1100, 698], [1040, 670], [1014, 667], [1014, 792], [964, 792],
      ],
    ],
    base: [[990, 790], [1197, 893]],
  },
  {
    id: "clock-tower",
    shapes: [
      [
        [1747, 488], [1810, 612], [1805, 640], [1818, 678], [1818, 720], [1808, 745], [1818, 800], [1808, 815], [1805, 977],
        [1747, 998], [1700, 977], [1698, 815], [1683, 800], [1685, 745], [1683, 680], [1697, 640], [1690, 612],
      ],
    ],
    base: [[1700, 977], [1747, 998], [1805, 977]],
  },
  {
    id: "viaduct",
    shapes: [
      [
        [1319, 1440], [1500, 1364], [1712, 1275], [1716, 1205], [1920, 1090], [2160, 975], [2336, 892], [2580, 770], [2580, 844],
        [2184, 1062], [1978, 1172], [1772, 1288], [1500, 1438], [1497, 1440],
      ],
      [[1756, 1286], [1788, 1286], [1788, 1354], [1756, 1354]],
      [[1960, 1170], [1996, 1170], [1996, 1270], [1960, 1270]],
      [[2168, 1058], [2200, 1058], [2200, 1158], [2168, 1158]],
      [[1540, 1400], [1580, 1400], [1580, 1440], [1540, 1440]],
    ],
    base: [[1300, 1545], [1560, 1440], [1772, 1352], [1978, 1268], [2184, 1156], [2580, 942]],
  },
  {
    id: "bus-shelter",
    shapes: [[[398, 1238], [484, 1200], [502, 1208], [502, 1283], [428, 1313], [416, 1313], [397, 1300]]],
    base: [[397, 1305], [420, 1313], [500, 1283]],
  },
  {
    id: "crane",
    shapes: [
      [[550, 662], [725, 735], [727, 778], [694, 778], [548, 690]],
      [[650, 722], [682, 722], [684, 892], [648, 892]],
    ],
    base: [[600, 892], [700, 892]],
  },
  {
    id: "depot",
    shapes: [[[1834, 972], [2040, 874], [2078, 912], [2066, 925], [2064, 1000], [1904, 1084], [1842, 1052], [1840, 985]]],
    base: [[1842, 1050], [1903, 1083], [2064, 998]],
  },
  {
    id: "noticeboard",
    shapes: [[[884, 1195], [886, 1180], [906, 1168], [968, 1137], [984, 1137], [984, 1250], [966, 1252], [906, 1262], [906, 1290], [884, 1290]]],
    base: [[884, 1288], [984, 1248]],
  },
  {
    id: "deck-tree",
    shapes: [
      [
        [1868, 378], [1898, 378], [1904, 402], [1920, 420], [1928, 450], [1925, 480], [1910, 494], [1895, 496], [1895, 530],
        [1878, 530], [1878, 496], [1860, 490], [1852, 470], [1854, 430], [1864, 405],
      ],
    ],
    base: [[1850, 530], [1930, 530]],
  },
  // Street furniture that stands beside a path: lamp posts, the lantern-string posts, the traffic sign.
  lamp("lamp-odds", [1090, 497, 1108, 528], [1095, 1107], 606),
  lamp("lamp-lab", [1569, 526, 1593, 551], [1576, 1586], 641),
  lamp("lamp-plaza-east", [1479, 628, 1521, 671], [1496, 1507], 743),
  lamp("lamp-plaza-south", [1311, 695, 1357, 741], [1328, 1343], 811),
  lamp("lamp-post-office", [316, 1244, 338, 1262], [320, 332], 1350),
  lamp("post-deck-west", [1681, 458, 1692, 470], [1682, 1691], 521),
  lamp("post-deck-mid", [1842, 400, 1854, 412], [1843, 1853], 536),
  lamp("post-deck-east", [1923, 450, 1935, 462], [1924, 1934], 577),
  {
    id: "post-office-boards",
    shapes: [
      [[299, 1262], [322, 1262], [322, 1308], [299, 1308]],
      [[331, 1258], [361, 1258], [361, 1290], [331, 1290]],
    ],
    base: [[299, 1308], [361, 1292]],
  },
  lamp("traffic-sign", [684, 1221, 711, 1255], [692, 703], 1325),
  lamp("parking-meter", [736, 1260, 756, 1300], [739, 754], 1358),
]

/**
 * A post with a head: `head` is the lamp's box [x0, y0, x1, y1], `pole` its pole's [x0, x1] down to `foot` (the ground
 * line). The pole is widened a pixel at the foot for the base plate.
 */
function lamp(id: string, head: readonly [number, number, number, number], pole: readonly [number, number], foot: number): DistrictOccluder {
  const [x0, y0, x1, y1] = head
  const [p0, p1] = pole
  return {
    id,
    shapes: [
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      [[p0, y1], [p1, y1], [p1 + 2, foot], [p0 - 2, foot]],
    ],
    base: [[p0 - 2, foot], [p1 + 2, foot]],
  }
}

/** Car lanes (polylines, drawn as moving cars in both directions). */
export const ROADS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // The street along the Post Office's front: its centre, below the curb, out past the bottom edge.
  [[0, 1318], [560, 1440]],
  // The diagonal street under the walkway, from the bus-stop corner up to where it passes under the square's stairs.
  [[300, 1426], [990, 1102]],
]

// ── Live details ─────────────────────────────────────────────────────────────

/** Five task floors: glass bands on Nova HQ's two faces, below the N emblem, top floor first. */
export const HQ_FLOORS: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 1180, y: 340 + i * 30, w: 90, h: 7 }))
export const HQ_FLOORS_RIGHT: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 1312, y: 340 + i * 30, w: 84, h: 7 }))
/** The NOVA arch sign: it breathes while an agent is working. */
export const HQ_SIGN: SignRect = { x: 955, y: 590, w: 215, h: 110 }

/**
 * Live crypto ticker: a strip lying on the bus shelter's roof. The roof slopes, so the strip's left end rests on the
 * roof's back edge and the rest lies across the roof.
 */
export const TICKER_BOARD: SignRect = { x: 424, y: 1214, w: 64, h: 12 }
/** Noticeboard face, below its NOTES header and between its posts: one paper per note. */
export const NOTICE_FACE: SignRect = { x: 910, y: 1190, w: 58, h: 40 }
export const FOUNTAIN = { x: 1902, y: 628, basinY: 668 }
/** Nova the cat's bench in the park. */
export const CAT_SPOT = { x: 1885, y: 574 }
/** Lantern centres of the plaza and deck lamps; their glow breathes. */
export const LAMPS: ReadonlyArray<readonly [number, number]> = [
  [1099, 510],
  [1577, 537],
  [1496, 650],
  [1334, 712],
]
