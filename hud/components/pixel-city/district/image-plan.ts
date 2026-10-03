import type { CityIntegration, CityPlaceId, CityRect, CityWorkplace } from "../types"

/**
 * The District is one painted daytime image of U.B Agents City (`/pixel-city/town/background.webp`, 1536x1024): a bright
 * isometric island with tan paved streets, canals, a harbour and colourful domed buildings. This file maps it: which
 * building is which U.B Agents place or integration, where the status badges sit, and where people walk. Coordinates are
 * image pixels ("plan pixels"); the renderer draws the image and everything live on top.
 */

export const DISTRICT_IMAGE_SRC = "/pixel-city/town/background.webp"
export const DISTRICT_IMAGE_WIDTH = 1536
export const DISTRICT_IMAGE_HEIGHT = 1024
/** The map's open water (sampled from the bay): painted behind the map so a sub-pixel gap at an edge reads as sea. */
export const DISTRICT_SEA_COLOR = "#01a5d4"

/**
 * The high-resolution map the city actually draws (`raw/map-5000x3760.png`, served as `map.webp`). It contains the
 * 1536x1024 painting above at 3.02x and adds mountains and sea around it, so every coordinate in this file stays in
 * the painting's plan pixels and the map's rect starts left of and above the plan origin. The camera never shows
 * past this rect.
 */
const MAP_SCALE = 3.02
export const DISTRICT_MAP = {
  src: "/pixel-city/town/map.webp",
  x: -158 / MAP_SCALE,
  y: -552 / MAP_SCALE,
  w: 5000 / MAP_SCALE,
  h: 3760 / MAP_SCALE,
} as const

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
  /** The integration whose connection this building shows; civic places are always open. */
  integration?: CityIntegration
  /**
   * Where the building's status badge sits (an integration building only): a small lamp that is lit while the
   * integration is connected and dark while it is not. Also the point the Integrations page crops around.
   */
  signs: SignRect[]
}

/** The badge's size in plan pixels. */
const BADGE = 9

/** A status badge centred on (cx, cy). */
const badge = (cx: number, cy: number): SignRect => ({ x: Math.round(cx - BADGE / 2), y: Math.round(cy - BADGE / 2), w: BADGE, h: BADGE })

export const DISTRICT_PLACES: readonly DistrictPlace[] = [
  // Civic places (always open).
  { id: "tasks", name: "U.B Agents HQ", hit: { x: 82, y: 0, w: 150, h: 250 }, signs: [] }, // the great arched gate
  { id: "deploy", name: "Depot", hit: { x: 12, y: 640, w: 135, h: 130 }, signs: [] }, // the harbour office on the pier
  { id: "analytics", name: "Power Plant", hit: { x: 1218, y: 422, w: 112, h: 140 }, signs: [] }, // the rocket tower
  { id: "notes", name: "Noticeboard", hit: { x: 255, y: 548, w: 110, h: 102 }, signs: [] }, // the glasshouse
  { id: "integrations", name: "Town Hall", hit: { x: 781, y: 575, w: 150, h: 134 }, signs: [] }, // the silver hall
  { id: "chat", name: "Fountain Park", hit: { x: 610, y: 376, w: 68, h: 76 }, signs: [] }, // the round fountain
  { id: "schedule", name: "Post Office", hit: { x: 328, y: 378, w: 120, h: 104 }, integration: "gmail", signs: [badge(388, 386)] },
  { id: "crypto", name: "Bank", hit: { x: 943, y: 405, w: 272, h: 112 }, integration: "coinbase", signs: [badge(1070, 410)] },
  { id: "polymarket", name: "Odds Parlour", hit: { x: 893, y: 305, w: 373, h: 110 }, integration: "polymarket", signs: [badge(1062, 300)] },
  { id: "youtube", name: "Cinema", hit: { x: 894, y: 458, w: 88, h: 90 }, integration: "youtube", signs: [badge(938, 466)] },

  // One building per integration (the rest).
  { id: "integration-spotify", name: "Records", hit: { x: 607, y: 800, w: 105, h: 72 }, integration: "spotify", signs: [badge(660, 806)] },
  { id: "integration-discord", name: "Arcade", hit: { x: 415, y: 183, w: 130, h: 92 }, integration: "discord", signs: [badge(480, 186)] },
  { id: "integration-slack", name: "Cowork", hit: { x: 741, y: 697, w: 255, h: 112 }, integration: "slack", signs: [badge(868, 704)] },
  { id: "integration-openai", name: "Lab", hit: { x: 976, y: 645, w: 94, h: 105 }, integration: "openai", signs: [badge(1022, 650)] },
  { id: "integration-claude", name: "Studio", hit: { x: 1166, y: 628, w: 160, h: 78 }, integration: "claude", signs: [badge(1246, 632)] },
  { id: "integration-grok", name: "Observatory", hit: { x: 535, y: 38, w: 48, h: 78 }, integration: "grok", signs: [badge(559, 44)] },
  { id: "integration-gemini", name: "Gemini Tower", hit: { x: 694, y: 487, w: 112, h: 124 }, integration: "gemini", signs: [badge(750, 494)] },
  { id: "integration-telegram", name: "Telegraph", hit: { x: 515, y: 495, w: 185, h: 112 }, integration: "telegram", signs: [badge(660, 500)] },
  { id: "integration-gmail-calendar", name: "Clock Tower", hit: { x: 322, y: 778, w: 54, h: 86 }, integration: "gmail-calendar", signs: [badge(360, 784)] },
  { id: "integration-brave", name: "Library", hit: { x: 745, y: 150, w: 106, h: 128 }, integration: "brave", signs: [badge(798, 156)] },
  { id: "integration-phantom", name: "Vault", hit: { x: 786, y: 908, w: 64, h: 40 }, integration: "phantom", signs: [badge(818, 912)] },
]

// ── Walkways ────────────────────────────────────────────────────────────────

export type WalkNodeId = string

/**
 * Walkable points (feet positions) on the painted tan paving and the harbour boardwalk. A walker's body rises about
 * PERSON_HEIGHT px above its feet. The doors are the points in front of each building; the rest are waypoints that keep
 * every run between two nodes on visible paving (each street was traced from the painting's paving and checked
 * against it). Where a run passes behind something tall, an entry in DISTRICT_OCCLUDERS redraws it over the walker.
 */
export const WALK_NODES: Readonly<Record<WalkNodeId, readonly [number, number]>> = {
  // Doors: the paving in front of each building.
  hq: [200, 258], // U.B Agents HQ's gate stairs
  obs: [556, 115], // Observatory (red orb tower)
  lib: [800, 290], // Library (statue plaza)
  dis: [470, 282], // Arcade (blue spiked hall)
  post: [385, 492], // Post Office (red hall)
  chat: [645, 458], // Fountain Park's basin
  note: [310, 682], // Noticeboard (greenhouse lawn)
  tel: [640, 590], // Telegraph (pipe and train)
  gem: [750, 618], // Gemini Tower
  town: [850, 718], // Town Hall (silver dome hall)
  slack: [870, 812], // Cowork (orange arches)
  lab: [1020, 758], // Lab (garden lab with the tank)
  cin: [940, 552], // Cinema (purple dome)
  mkt: [1000, 430], // Odds Parlour (the dome market)
  bank: [1090, 525], // Bank (red bridge hall)
  pow: [1275, 568], // Power Plant (rocket tower)
  claude: [1230, 712], // Studio (terracotta domes)
  spot: [660, 879], // Records (red spotted dome)
  clock: [392, 815], // Clock Tower (spire)
  vault: [815, 950], // Vault (cave on the south jetty)
  dep: [89, 730], // Depot (harbour office on the pier)
  j1: [335, 269], // junction below the Studio-side lawns
  // Street waypoints between the doors (traced along the paving of the painting).
  "hq_j11": [257, 274],
  "hq_j12": [310, 239],
  "hq_j13": [336, 256],
  "j1_dis1": [337, 258],
  "j1_dis2": [267, 205],
  "j1_dis3": [262, 193],
  "j1_dis4": [282, 174],
  "j1_dis5": [324, 156],
  "j1_dis6": [355, 157],
  "j1_dis7": [431, 194],
  "j1_dis8": [403, 231],
  "j1_dis9": [403, 246],
  "j1_dis10": [436, 274],
  "dis_obs1": [501, 284],
  "dis_obs2": [547, 260],
  "dis_obs3": [564, 260],
  "dis_obs4": [593, 275],
  "dis_obs5": [636, 275],
  "dis_obs6": [679, 253],
  "dis_obs7": [684, 216],
  "dis_obs8": [713, 192],
  "dis_obs9": [712, 181],
  "dis_obs10": [683, 155],
  "dis_obs11": [682, 134],
  "dis_obs12": [656, 105],
  "dis_obs13": [629, 111],
  "dis_obs14": [583, 107],
  "dis_lib1": [501, 284],
  "dis_lib2": [547, 260],
  "dis_lib3": [618, 276],
  "dis_lib4": [673, 261],
  "dis_lib5": [711, 296],
  "dis_lib6": [725, 296],
  "dis_lib7": [742, 281],
  "j1_post1": [337, 258],
  "j1_post2": [323, 244],
  "j1_post3": [301, 239],
  "j1_post4": [251, 281],
  "j1_post5": [236, 312],
  "j1_post6": [185, 347],
  "j1_post7": [184, 371],
  "j1_post8": [239, 415],
  "j1_post9": [239, 432],
  "j1_post10": [251, 444],
  "j1_post11": [304, 444],
  "j1_post12": [337, 474],
  "post_chat1": [416, 497],
  "post_chat2": [431, 490],
  "post_chat3": [474, 466],
  "post_chat4": [533, 414],
  "post_chat5": [573, 390],
  "post_chat6": [586, 390],
  "post_chat7": [607, 409],
  "post_chat8": [602, 441],
  "post_chat9": [612, 451],
  "post_note1": [342, 478],
  "post_note2": [334, 496],
  "post_note3": [379, 521],
  "post_note4": [408, 527],
  "post_note5": [427, 545],
  "post_note6": [460, 579],
  "post_note7": [453, 616],
  "post_note8": [402, 658],
  "post_note9": [367, 661],
  "post_note10": [342, 676],
  "note_tel1": [342, 676],
  "note_tel2": [367, 661],
  "note_tel3": [404, 658],
  "note_tel4": [465, 708],
  "note_tel5": [488, 706],
  "note_tel6": [539, 690],
  "note_tel7": [545, 665],
  "note_tel8": [565, 645],
  "note_tel9": [618, 599],
  "tel_chat1": [681, 574],
  "tel_chat2": [716, 539],
  "tel_chat3": [714, 495],
  "tel_chat4": [728, 481],
  "tel_chat5": [728, 466],
  "tel_chat6": [698, 443],
  "tel_gem1": [642, 649],
  "tel_gem2": [652, 659],
  "tel_gem3": [747, 676],
  "tel_gem4": [762, 661],
  "tel_gem5": [762, 642],
  "gem_town1": [766, 648],
  "gem_town2": [766, 673],
  "gem_town3": [797, 714],
  "gem_town4": [807, 724],
  "town_slack1": [807, 724],
  "town_slack2": [788, 702],
  "town_slack3": [757, 701],
  "town_slack4": [741, 719],
  "town_slack5": [731, 788],
  "town_slack6": [764, 818],
  "town_slack7": [848, 806],
  "slack_spot1": [848, 806],
  "slack_spot2": [760, 818],
  "slack_spot3": [718, 870],
  "slack_spot4": [681, 886],
  "slack_spot5": [665, 886],
  "spot_clock1": [642, 887],
  "spot_clock2": [589, 862],
  "spot_clock3": [548, 862],
  "spot_clock4": [513, 880],
  "spot_clock5": [483, 881],
  "spot_clock6": [455, 866],
  "spot_clock7": [411, 817],
  "clock_dep1": [395, 790],
  "clock_dep2": [385, 758],
  "clock_dep3": [350, 748],
  "clock_dep4": [318, 752],
  "clock_dep5": [298, 790],
  "clock_dep6": [292, 810],
  "clock_dep7": [268, 812],
  "clock_dep8": [240, 782],
  "clock_dep9": [212, 758],
  "clock_dep10": [175, 742],
  "clock_dep11": [130, 735],
  "slack_vault1": [887, 813],
  "slack_vault2": [920, 846],
  "slack_vault3": [919, 884],
  "slack_vault4": [878, 909],
  "slack_vault5": [853, 946],
  "slack_lab1": [884, 811],
  "slack_lab2": [897, 822],
  "slack_lab3": [946, 812],
  "lab_claude1": [1066, 753],
  "lab_claude2": [1077, 742],
  "lab_claude3": [1081, 725],
  "lab_claude4": [1072, 660],
  "lab_claude5": [1082, 641],
  "lab_claude6": [1127, 641],
  "lab_claude7": [1146, 671],
  "lab_claude8": [1146, 687],
  "lab_claude9": [1181, 718],
  "lab_claude10": [1196, 718],
  "lab_claude11": [1212, 707],
  "lab_cin1": [1066, 753],
  "lab_cin2": [1077, 742],
  "lab_cin3": [1081, 725],
  "lab_cin4": [1069, 662],
  "lab_cin5": [1051, 637],
  "lab_cin6": [1007, 644],
  "lab_cin7": [960, 635],
  "lab_cin8": [928, 599],
  "lab_cin9": [927, 572],
  "cin_mkt1": [929, 563],
  "cin_mkt2": [910, 563],
  "cin_mkt3": [886, 542],
  "cin_mkt4": [885, 503],
  "cin_mkt5": [902, 483],
  "cin_mkt6": [902, 460],
  "cin_mkt7": [968, 410],
  "cin_mkt8": [983, 409],
  "mkt_bank1": [983, 409],
  "mkt_bank2": [965, 411],
  "mkt_bank3": [934, 440],
  "mkt_bank4": [936, 454],
  "mkt_bank5": [991, 506],
  "mkt_bank6": [1015, 507],
  "mkt_bank7": [1039, 531],
  "bank_pow1": [1103, 526],
  "bank_pow2": [1110, 544],
  "bank_pow3": [1097, 564],
  "bank_pow4": [1072, 579],
  "bank_pow5": [1075, 623],
  "bank_pow6": [1085, 641],
  "bank_pow7": [1124, 641],
  "bank_pow8": [1136, 625],
  "bank_pow9": [1175, 634],
  "bank_pow10": [1252, 587],
  "bank_pow11": [1260, 570],
  "claude_pow1": [1212, 707],
  "claude_pow2": [1196, 718],
  "claude_pow3": [1181, 718],
  "claude_pow4": [1151, 691],
  "claude_pow5": [1151, 667],
  "claude_pow6": [1184, 627],
  "claude_pow7": [1252, 587],
  "claude_pow8": [1260, 570],
  "lib_mkt1": [825, 324],
  "lib_mkt2": [852, 333],
  "lib_mkt3": [886, 362],
  "lib_mkt4": [886, 372],
  "lib_mkt5": [851, 403],
  "lib_mkt6": [851, 421],
  "lib_mkt7": [873, 440],
  "lib_mkt8": [927, 445],
  "lib_mkt9": [974, 409],
  "lib_mkt10": [983, 409],
  "cin_gem1": [929, 563],
  "cin_gem2": [833, 571],
  "cin_gem3": [790, 618],
  "gem_chat1": [790, 618],
  "gem_chat2": [821, 587],
  "gem_chat3": [826, 565],
  "gem_chat4": [811, 539],
  "gem_chat5": [757, 493],
  "gem_chat6": [749, 471],
  "gem_chat7": [734, 471],
  "gem_chat8": [698, 443],
  "town_lab1": [853, 727],
  "town_lab2": [880, 726],
  "town_lab3": [912, 694],
  "town_lab4": [940, 688],
  "town_lab5": [975, 637],
  "town_lab6": [1008, 644],
  "town_lab7": [1051, 637],
  "town_lab8": [1069, 663],
  "town_lab9": [1081, 735],
  "town_lab10": [1066, 753],
  "note_clock1": [388, 658],
  "note_clock2": [404, 658],
  "note_clock3": [433, 680],
  "note_clock4": [433, 689],
  "note_clock5": [400, 723],
  "note_clock6": [380, 726],
  "note_clock7": [361, 745],
  "note_clock8": [361, 763],
}

export const WALK_EDGES: ReadonlyArray<readonly [WalkNodeId, WalkNodeId]> = [
  ["hq", "hq_j11"], ["hq_j11", "hq_j12"], ["hq_j12", "hq_j13"], ["hq_j13", "j1"],
  ["j1", "j1_dis1"], ["j1_dis1", "j1_dis2"], ["j1_dis2", "j1_dis3"], ["j1_dis3", "j1_dis4"],
  ["j1_dis4", "j1_dis5"], ["j1_dis5", "j1_dis6"], ["j1_dis6", "j1_dis7"], ["j1_dis7", "j1_dis8"],
  ["j1_dis8", "j1_dis9"], ["j1_dis9", "j1_dis10"], ["j1_dis10", "dis"], ["dis", "dis_obs1"],
  ["dis_obs1", "dis_obs2"], ["dis_obs2", "dis_obs3"], ["dis_obs3", "dis_obs4"], ["dis_obs4", "dis_obs5"],
  ["dis_obs5", "dis_obs6"], ["dis_obs6", "dis_obs7"], ["dis_obs7", "dis_obs8"], ["dis_obs8", "dis_obs9"],
  ["dis_obs9", "dis_obs10"], ["dis_obs10", "dis_obs11"], ["dis_obs11", "dis_obs12"], ["dis_obs12", "dis_obs13"],
  ["dis_obs13", "dis_obs14"], ["dis_obs14", "obs"], ["dis", "dis_lib1"], ["dis_lib1", "dis_lib2"],
  ["dis_lib2", "dis_lib3"], ["dis_lib3", "dis_lib4"], ["dis_lib4", "dis_lib5"], ["dis_lib5", "dis_lib6"],
  ["dis_lib6", "dis_lib7"], ["dis_lib7", "lib"], ["j1", "j1_post1"], ["j1_post1", "j1_post2"],
  ["j1_post2", "j1_post3"], ["j1_post3", "j1_post4"], ["j1_post4", "j1_post5"], ["j1_post5", "j1_post6"],
  ["j1_post6", "j1_post7"], ["j1_post7", "j1_post8"], ["j1_post8", "j1_post9"], ["j1_post9", "j1_post10"],
  ["j1_post10", "j1_post11"], ["j1_post11", "j1_post12"], ["j1_post12", "post"], ["post", "post_chat1"],
  ["post_chat1", "post_chat2"], ["post_chat2", "post_chat3"], ["post_chat3", "post_chat4"], ["post_chat4", "post_chat5"],
  ["post_chat5", "post_chat6"], ["post_chat6", "post_chat7"], ["post_chat7", "post_chat8"], ["post_chat8", "post_chat9"],
  ["post_chat9", "chat"], ["post", "post_note1"], ["post_note1", "post_note2"], ["post_note2", "post_note3"],
  ["post_note3", "post_note4"], ["post_note4", "post_note5"], ["post_note5", "post_note6"], ["post_note6", "post_note7"],
  ["post_note7", "post_note8"], ["post_note8", "post_note9"], ["post_note9", "post_note10"], ["post_note10", "note"],
  ["note", "note_tel1"], ["note_tel1", "note_tel2"], ["note_tel2", "note_tel3"], ["note_tel3", "note_tel4"],
  ["note_tel4", "note_tel5"], ["note_tel5", "note_tel6"], ["note_tel6", "note_tel7"], ["note_tel7", "note_tel8"],
  ["note_tel8", "note_tel9"], ["note_tel9", "tel"], ["tel", "tel_chat1"], ["tel_chat1", "tel_chat2"],
  ["tel_chat2", "tel_chat3"], ["tel_chat3", "tel_chat4"], ["tel_chat4", "tel_chat5"], ["tel_chat5", "tel_chat6"],
  ["tel_chat6", "chat"], ["tel", "tel_gem1"], ["tel_gem1", "tel_gem2"], ["tel_gem2", "tel_gem3"],
  ["tel_gem3", "tel_gem4"], ["tel_gem4", "tel_gem5"], ["tel_gem5", "gem"], ["gem", "gem_town1"],
  ["gem_town1", "gem_town2"], ["gem_town2", "gem_town3"], ["gem_town3", "gem_town4"], ["gem_town4", "town"],
  ["town", "town_slack1"], ["town_slack1", "town_slack2"], ["town_slack2", "town_slack3"], ["town_slack3", "town_slack4"],
  ["town_slack4", "town_slack5"], ["town_slack5", "town_slack6"], ["town_slack6", "town_slack7"], ["town_slack7", "slack"],
  ["slack", "slack_spot1"], ["slack_spot1", "slack_spot2"], ["slack_spot2", "slack_spot3"], ["slack_spot3", "slack_spot4"],
  ["slack_spot4", "slack_spot5"], ["slack_spot5", "spot"], ["spot", "spot_clock1"], ["spot_clock1", "spot_clock2"],
  ["spot_clock2", "spot_clock3"], ["spot_clock3", "spot_clock4"], ["spot_clock4", "spot_clock5"], ["spot_clock5", "spot_clock6"],
  ["spot_clock6", "spot_clock7"], ["spot_clock7", "clock"], ["clock", "clock_dep1"], ["clock_dep1", "clock_dep2"],
  ["clock_dep2", "clock_dep3"], ["clock_dep3", "clock_dep4"], ["clock_dep4", "clock_dep5"], ["clock_dep5", "clock_dep6"],
  ["clock_dep6", "clock_dep7"], ["clock_dep7", "clock_dep8"], ["clock_dep8", "clock_dep9"], ["clock_dep9", "clock_dep10"],
  ["clock_dep10", "clock_dep11"], ["clock_dep11", "dep"], ["slack", "slack_vault1"], ["slack_vault1", "slack_vault2"],
  ["slack_vault2", "slack_vault3"], ["slack_vault3", "slack_vault4"], ["slack_vault4", "slack_vault5"], ["slack_vault5", "vault"],
  ["slack", "slack_lab1"], ["slack_lab1", "slack_lab2"], ["slack_lab2", "slack_lab3"], ["slack_lab3", "lab"],
  ["lab", "lab_claude1"], ["lab_claude1", "lab_claude2"], ["lab_claude2", "lab_claude3"], ["lab_claude3", "lab_claude4"],
  ["lab_claude4", "lab_claude5"], ["lab_claude5", "lab_claude6"], ["lab_claude6", "lab_claude7"], ["lab_claude7", "lab_claude8"],
  ["lab_claude8", "lab_claude9"], ["lab_claude9", "lab_claude10"], ["lab_claude10", "lab_claude11"], ["lab_claude11", "claude"],
  ["lab", "lab_cin1"], ["lab_cin1", "lab_cin2"], ["lab_cin2", "lab_cin3"], ["lab_cin3", "lab_cin4"],
  ["lab_cin4", "lab_cin5"], ["lab_cin5", "lab_cin6"], ["lab_cin6", "lab_cin7"], ["lab_cin7", "lab_cin8"],
  ["lab_cin8", "lab_cin9"], ["lab_cin9", "cin"], ["cin", "cin_mkt1"], ["cin_mkt1", "cin_mkt2"],
  ["cin_mkt2", "cin_mkt3"], ["cin_mkt3", "cin_mkt4"], ["cin_mkt4", "cin_mkt5"], ["cin_mkt5", "cin_mkt6"],
  ["cin_mkt6", "cin_mkt7"], ["cin_mkt7", "cin_mkt8"], ["cin_mkt8", "mkt"], ["mkt", "mkt_bank1"],
  ["mkt_bank1", "mkt_bank2"], ["mkt_bank2", "mkt_bank3"], ["mkt_bank3", "mkt_bank4"], ["mkt_bank4", "mkt_bank5"],
  ["mkt_bank5", "mkt_bank6"], ["mkt_bank6", "mkt_bank7"], ["mkt_bank7", "bank"], ["bank", "bank_pow1"],
  ["bank_pow1", "bank_pow2"], ["bank_pow2", "bank_pow3"], ["bank_pow3", "bank_pow4"], ["bank_pow4", "bank_pow5"],
  ["bank_pow5", "bank_pow6"], ["bank_pow6", "bank_pow7"], ["bank_pow7", "bank_pow8"], ["bank_pow8", "bank_pow9"],
  ["bank_pow9", "bank_pow10"], ["bank_pow10", "bank_pow11"], ["bank_pow11", "pow"], ["claude", "claude_pow1"],
  ["claude_pow1", "claude_pow2"], ["claude_pow2", "claude_pow3"], ["claude_pow3", "claude_pow4"], ["claude_pow4", "claude_pow5"],
  ["claude_pow5", "claude_pow6"], ["claude_pow6", "claude_pow7"], ["claude_pow7", "claude_pow8"], ["claude_pow8", "pow"],
  ["lib", "lib_mkt1"], ["lib_mkt1", "lib_mkt2"], ["lib_mkt2", "lib_mkt3"], ["lib_mkt3", "lib_mkt4"],
  ["lib_mkt4", "lib_mkt5"], ["lib_mkt5", "lib_mkt6"], ["lib_mkt6", "lib_mkt7"], ["lib_mkt7", "lib_mkt8"],
  ["lib_mkt8", "lib_mkt9"], ["lib_mkt9", "lib_mkt10"], ["lib_mkt10", "mkt"], ["cin", "cin_gem1"],
  ["cin_gem1", "cin_gem2"], ["cin_gem2", "cin_gem3"], ["cin_gem3", "gem"], ["gem", "gem_chat1"],
  ["gem_chat1", "gem_chat2"], ["gem_chat2", "gem_chat3"], ["gem_chat3", "gem_chat4"], ["gem_chat4", "gem_chat5"],
  ["gem_chat5", "gem_chat6"], ["gem_chat6", "gem_chat7"], ["gem_chat7", "gem_chat8"], ["gem_chat8", "chat"],
  ["town", "town_lab1"], ["town_lab1", "town_lab2"], ["town_lab2", "town_lab3"], ["town_lab3", "town_lab4"],
  ["town_lab4", "town_lab5"], ["town_lab5", "town_lab6"], ["town_lab6", "town_lab7"], ["town_lab7", "town_lab8"],
  ["town_lab8", "town_lab9"], ["town_lab9", "town_lab10"], ["town_lab10", "lab"], ["note", "note_clock1"],
  ["note_clock1", "note_clock2"], ["note_clock2", "note_clock3"], ["note_clock3", "note_clock4"], ["note_clock4", "note_clock5"],
  ["note_clock5", "note_clock6"], ["note_clock6", "note_clock7"], ["note_clock7", "note_clock8"], ["note_clock8", "clock"],
]

/** Where agents report for work at each workplace: the node in front of that building's door. */
export const WORKPLACE_DOOR: Readonly<Record<CityWorkplace, WalkNodeId>> = {
  hq: "hq",
  lab: "lab",
  comms: "tel",
  post: "post",
  bank: "bank",
  parlour: "mkt",
  cinema: "cin",
  library: "lib",
  power: "pow",
  depot: "dep",
}

/** Where an integration's worker stands: the walk node in front of that integration's own building. */
export const INTEGRATION_DOOR: Readonly<Record<CityIntegration, WalkNodeId>> = {
  telegram: "tel",
  discord: "dis",
  slack: "slack",
  openai: "lab",
  claude: "claude",
  grok: "obs",
  gemini: "gem",
  spotify: "spot",
  youtube: "cin",
  gmail: "post",
  "gmail-calendar": "clock",
  brave: "lib",
  coinbase: "bank",
  phantom: "vault",
  polymarket: "mkt",
}

export const WORKPLACE_NAME: Readonly<Record<CityWorkplace, string>> = {
  hq: "U.B Agents HQ",
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
 * it, clipped to `shapes`.
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
    id: "clock-tower",
    shapes: [[[358, 776], [364, 776], [372, 800], [378, 830], [386, 864], [330, 864], [342, 830], [350, 800]]],
    base: [[330, 864], [386, 864]],
  },
]

// ── Live details ─────────────────────────────────────────────────────────────

/** Five task floors: a column of lamps on the gate's right flank, top floor first. */
export const HQ_FLOORS: readonly SignRect[] = [0, 1, 2, 3, 4].map((i) => ({ x: 205, y: 98 + i * 11, w: 12, h: 7 }))
/** The dark panel behind the floor lamps. */
export const HQ_PANEL: SignRect = { x: 202, y: 94, w: 18, h: 60 }
/** The gate's round window: it glows while an agent is working. */
export const HQ_SIGN: SignRect = { x: 137, y: 123, w: 60, h: 107 }

/** The noticeboard's face on the glasshouse lawn: one paper per note. */
export const NOTICE_FACE: SignRect = { x: 276, y: 628, w: 32, h: 20 }
export const FOUNTAIN = { x: 644, y: 395, basinY: 432 }
/** U.B Agents the cat's seat beside the fountain. */
export const CAT_SPOT = { x: 668, y: 450 }

/**
 * Sea lanes the boats of active deployment runs sail along (one lane per boat, back and forth), in the open water of
 * the bay clear of the painted moorings.
 */
export const HARBOUR_LANES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[40, 905], [380, 1008]],
  [[480, 988], [1000, 1014]],
  [[1150, 1014], [1500, 962]],
]
