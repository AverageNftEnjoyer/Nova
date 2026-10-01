import type { CityIntegration, CityWorkplace } from "../types"

/**
 * The people of Nova City: PixelLab character sheets drawn at the painting's own pixel density, so the
 * residents (one agent per task, one worker per connected integration) and Nova the cat look painted into the city rather than pasted on top.
 *
 * The daytime painting is a 1536x1024 plan on which a building stands ~80-160 px tall. A sheet pixel covers PERSON_PX
 * plan pixels, so a figure (~28 sheet pixels) is about 27 plan pixels tall: a little under door height. A sheet is
 * first enlarged with hard edges and then smoothly scaled to the screen, like the painting, so its pixels stay square.
 *
 * Sheet layout (`public/pixel-city/town/characters/*.png`): 8 direction rows in `directionRow` order (south,
 * south-east, east, north-east, north, north-west, west, south-west) by 7 columns (standing, then 6 walk frames),
 * 32 px cells, feet on row FOOT_Y. The cat sheet is one 24 px cell: Nova sitting, facing the viewer.
 *
 * Feet are the anchor: (x, y) is where the figure stands.
 */

/** Plan pixels per sheet pixel: a ~28 px figure stands ~27 plan pixels tall next to buildings 80-160 px tall. */
export const PERSON_PX = 0.95
const CELL = 32
/** Row of the feet inside a cell (the lowest opaque row of the standing frames). */
const FOOT_Y = 30
const WALK_FRAMES = 6
/** Walk-cycle frames per second: one stride per cycle at the city's strolling pace. */
const WALK_FPS = 9
/** Head to feet of a standing figure, in plan pixels (sheet figures are ~28 px tall). */
export const PERSON_HEIGHT = Math.round(28 * PERSON_PX)

const CAT_CELL = 24
/** Nova is drawn a little larger than life so the city's mascot reads from across the park. */
const CAT_PX = 0.8
/** Row of the cat's paws inside its cell. */
const CAT_FOOT_Y = 21
/** Paws to ear tips of the sitting cat, in plan pixels. */
export const CAT_HEIGHT = Math.round(20 * CAT_PX)

/** Sheets are enlarged this much with hard edges before the canvas scales them smoothly to the screen. */
const PRESCALE = 3
const SHEET_BASE = "/pixel-city/town/characters"

export const AGENT_SHEETS = ["agent", "agent-lab", "agent-courier", "agent-trader", "agent-media", "agent-research"] as const
export type PersonSheet = (typeof AGENT_SHEETS)[number]

export interface PersonLook {
  sheet: PersonSheet
}

/**
 * Agents dress for the job they are doing. Every outfit keeps the Nova teal suit and glowing cyan visor; workplaces
 * without their own outfit wear the base suit.
 */
const ROLE_SHEET: Readonly<Record<CityWorkplace, PersonSheet>> = {
  hq: "agent",
  lab: "agent-lab",
  comms: "agent-courier",
  post: "agent-courier",
  bank: "agent-trader",
  parlour: "agent-trader",
  cinema: "agent-media",
  library: "agent-research",
  power: "agent",
  depot: "agent",
}

export function agentLook(workplace: CityWorkplace): PersonLook {
  return { sheet: ROLE_SHEET[workplace] }
}

/** The building each integration's worker works at: the same workplaces agents use (see `workplaceForTools`). */
const INTEGRATION_WORKPLACE: Readonly<Record<CityIntegration, CityWorkplace>> = {
  telegram: "comms",
  discord: "comms",
  slack: "comms",
  openai: "lab",
  claude: "lab",
  grok: "lab",
  gemini: "lab",
  spotify: "cinema",
  youtube: "cinema",
  gmail: "post",
  "gmail-calendar": "post",
  brave: "library",
  coinbase: "bank",
  phantom: "bank",
  polymarket: "parlour",
}

export function integrationWorkplace(integration: CityIntegration): CityWorkplace {
  return INTEGRATION_WORKPLACE[integration]
}

/**
 * A character sheet's URL plus its grid, for drawing one frame outside the canvas (the agent card's portrait):
 * `cell` px cells, `columns` x `rows`, the standing south-facing frame at the top-left.
 */
export function personSheetArt(sheet: PersonSheet): { url: string; cell: number; columns: number; rows: number } {
  return { url: `${SHEET_BASE}/${sheet}.png`, cell: CELL, columns: 1 + WALK_FRAMES, rows: 8 }
}

// ── Sheet loading ─────────────────────────────────────────────────────────────

type Art = HTMLCanvasElement

const sheets = new Map<string, Art>()
let catAwake: Art | null = null
let catAsleep: Art | null = null
let loading = false

/** The sheet enlarged PRESCALE times with hard edges: smooth scaling from here keeps the pixels square. */
function prescale(image: HTMLImageElement): Art | null {
  const c = document.createElement("canvas")
  c.width = image.naturalWidth * PRESCALE
  c.height = image.naturalHeight * PRESCALE
  const cctx = c.getContext("2d")
  if (!cctx) return null
  cctx.imageSmoothingEnabled = false
  cctx.drawImage(image, 0, 0, c.width, c.height)
  return c
}

/** The cat with its eyes shut: bright green eye pixels painted over with the fur next to them. */
function closeEyes(image: HTMLImageElement): Art | null {
  const w = image.naturalWidth
  const h = image.naturalHeight
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const cctx = c.getContext("2d")
  if (!cctx) return null
  cctx.drawImage(image, 0, 0)
  const data = cctx.getImageData(0, 0, w, h)
  const px = data.data
  for (let o = 0; o < px.length; o += 4) {
    const r = px[o]
    const g = px[o + 1]
    const b = px[o + 2]
    if (px[o + 3] > 0 && g > 120 && g > r + 30 && g > b + 30) {
      px[o] = 26
      px[o + 1] = 20
      px[o + 2] = 36
    }
  }
  cctx.putImageData(data, 0, 0)
  const img = document.createElement("canvas")
  img.width = w * PRESCALE
  img.height = h * PRESCALE
  const ictx = img.getContext("2d")
  if (!ictx) return null
  ictx.imageSmoothingEnabled = false
  ictx.drawImage(c, 0, 0, img.width, img.height)
  return img
}

function load(name: string, done: (image: HTMLImageElement) => void): void {
  const image = new Image()
  image.decoding = "async"
  image.onload = () => done(image)
  // A missing sheet leaves that character undrawn; the rest of the city keeps going.
  image.src = `${SHEET_BASE}/${name}.png`
}

/** Starts loading every character sheet once. Safe to call repeatedly; figures appear as their sheets arrive. */
export function loadPeopleArt(): void {
  if (loading || typeof document === "undefined") return
  loading = true
  for (const name of AGENT_SHEETS) {
    load(name, (image) => {
      const art = prescale(image)
      if (art) sheets.set(name, art)
    })
  }
  load("cat", (image) => {
    catAwake = prescale(image)
    catAsleep = closeEyes(image)
  })
}

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Draws one sheet cell (in sheet pixels) with its anchor row on (x, y), smoothly scaled like the painting. */
function drawCell(ctx: CanvasRenderingContext2D, art: Art, col: number, row: number, cell: number, footY: number, scale: number, x: number, y: number): void {
  const smoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  const size = cell * scale
  ctx.drawImage(art, col * cell * PRESCALE, row * cell * PRESCALE, cell * PRESCALE, cell * PRESCALE, x - size / 2, y - footY * scale, size, size)
  ctx.imageSmoothingEnabled = smoothing
}

/** A soft contact shadow under the feet, so figures stand on the paving instead of floating over it. */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.fillStyle = "rgba(20, 30, 50, 0.3)"
  ctx.beginPath()
  ctx.ellipse(x, y - 1, rx, rx * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * One person. `dir` is the sheet row (0 south … 7 south-west, see `directionRow`); a walking figure steps through
 * its walk cycle, phase-shifted by x so a crowd doesn't march in step.
 */
export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, moving: boolean, time: number, look: PersonLook): void {
  const art = sheets.get(look.sheet)
  if (!art) return
  const row = ((Math.round(dir) % 8) + 8) % 8
  const col = moving ? 1 + (Math.floor(time * WALK_FPS + x * 0.37) % WALK_FRAMES) : 0
  drawShadow(ctx, x, y, 5)
  drawCell(ctx, art, col, row, CELL, FOOT_Y, PERSON_PX, x, y)
}

/** Nova beside the fountain, facing the viewer. `blink` shuts the eyes (asleep while Nova is offline). */
export function drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, blink: boolean): void {
  const art = blink ? catAsleep : catAwake
  if (!art) return
  drawCell(ctx, art, 0, 0, CAT_CELL, CAT_FOOT_Y, CAT_PX, x, y)
}
