import type { CityWorkplace } from "../types"

/**
 * People drawn on the painting's own grid. An art pixel in the night city is 2 image pixels, with the same dark
 * outline as the buildings. Feet are the anchor: (x, y) is where the figure stands.
 */

export const PERSON_PX = 2
const PX = PERSON_PX

/** South-east, toward the camera's right. South-west is this mirrored. `v` is the face (visor or eyes). */
const SE_STAND = [
  ".....oooo.......",
  "....ohhhhho.....",
  "...ohhhhhhho....",
  "...ohhvvvhho....",
  "....ossssso.....",
  ".....ossso......",
  "...oocccccdo....",
  "..occcccccddo...",
  "..occcccccddo...",
  "..occcccccddo...",
  "...occcccddo....",
  "....occcddo.....",
  "....opp..po.....",
  "....op....po....",
  "....ok....ko....",
  ".....o....o.....",
]

const SE_WALK = [
  ".....oooo.......",
  "....ohhhhho.....",
  "...ohhhhhhho....",
  "...ohhvvvhho....",
  "....ossssso.....",
  ".....ossso......",
  "...oocccccdo....",
  "..occcccccddo...",
  "..occcccccddo...",
  "..occcccccddo...",
  "...occcccddo....",
  "....occcddo.....",
  "...opp...o......",
  "..op.....ko.....",
  ".ok.............",
  "..o.............",
]

/** North-east, walking away. North-west is this mirrored. */
const NE_STAND = [
  ".....oooo.......",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "....ohhhhhho....",
  ".....oooo.......",
  "...oocccccdo....",
  "..occcccccddo...",
  "..occcccccddo...",
  "..occcccccddo...",
  "...occcccddo....",
  "....occcddo.....",
  "....opp..po.....",
  "....op....po....",
  "....ok....ko....",
  ".....o....o.....",
]

const NE_WALK = [
  ".....oooo.......",
  "....ohhhhhho....",
  "...ohhhhhhhho...",
  "...ohhhhhhhho...",
  "....ohhhhhho....",
  ".....oooo.......",
  "...oocccccdo....",
  "..occcccccddo...",
  "..occcccccddo...",
  "..occcccccddo...",
  "...occcccddo....",
  "....occcddo.....",
  "...opp...o......",
  "..op.....ko.....",
  ".ok.............",
  "..o.............",
]

export const PERSON_HEIGHT = SE_STAND.length * PX

type Facing = "se" | "sw" | "ne" | "nw"

function mirror(rows: readonly string[]): string[] {
  return rows.map((row) =>
    row
      .split("")
      .reverse()
      .map((ch) => (ch === "c" ? "d" : ch === "d" ? "c" : ch))
      .join(""),
  )
}

const FRAMES: Record<Facing, readonly [readonly string[], readonly string[]]> = {
  se: [SE_STAND, SE_WALK],
  sw: [mirror(SE_STAND), mirror(SE_WALK)],
  ne: [NE_STAND, NE_WALK],
  nw: [mirror(NE_STAND), mirror(NE_WALK)],
}

/** Sheet row from directionRow: 0 south … 7 south-west. The city camera only needs the four isometric facings. */
export function facingFromDir(dir: number): Facing {
  if (dir === 3) return "ne"
  if (dir === 4 || dir === 5) return "nw"
  if (dir === 6 || dir === 7) return "sw"
  return "se"
}

export interface PersonLook {
  hair: string
  skin: string
  shirt: string
  pants: string
  /** Bright visor for an agent; dark eyes for everyone else. */
  agent: boolean
}

const OUTLINE = "#1a1020"
const SHOE = "#141018"

function darken(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const k = 0.62
  const r = Math.round(((n >> 16) & 255) * k)
  const g = Math.round(((n >> 8) & 255) * k)
  const b = Math.round((n & 255) * k)
  return `rgb(${r},${g},${b})`
}

/** Nova crew. The lab coat is the one job you can read at a distance; every agent keeps the cyan visor. */
export function agentLook(workplace: CityWorkplace): PersonLook {
  if (workplace === "lab") return { hair: "#16343a", skin: "#f0d2b0", shirt: "#e4eef4", pants: "#163844", agent: true }
  if (workplace === "bank" || workplace === "parlour") return { hair: "#16343a", skin: "#f0d2b0", shirt: "#243044", pants: "#141c28", agent: true }
  if (workplace === "library") return { hair: "#16343a", skin: "#f0d2b0", shirt: "#3a3428", pants: "#241c14", agent: true }
  return { hair: "#12383a", skin: "#f0d2b0", shirt: "#2ec4b6", pants: "#143848", agent: true }
}

export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, moving: boolean, time: number, look: PersonLook): void {
  const facing = facingFromDir(dir)
  const cycle = moving ? (Math.floor(time * 6 + x) % 2 === 0 ? 0 : 1) : 0
  const rows = FRAMES[facing][cycle]
  const colors: Record<string, string> = {
    o: OUTLINE,
    h: look.hair,
    s: look.skin,
    v: look.agent ? "#d9fff6" : "#2a1c18",
    c: look.shirt,
    d: darken(look.shirt),
    p: look.pants,
    k: SHOE,
  }
  const width = rows[0].length * PX
  const left = Math.round(x - width / 2)
  const top = Math.round(y - (rows.length - 1) * PX)
  ctx.fillStyle = "rgba(12, 8, 18, 0.4)"
  ctx.fillRect(Math.round(x) - 8, Math.round(y) - 1, 16, 2)
  ctx.fillRect(Math.round(x) - 5, Math.round(y) + 1, 10, 2)
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < row.length; c++) {
      const color = colors[row[c]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(left + c * PX, top + r * PX, PX, PX)
    }
  }
}

const CAT = [
  "..o.o.....",
  ".ohhhho...",
  ".oe.e.o...",
  ".oooooo...",
  "..ooooo...",
  "...oooo...",
  ".....oo.o.",
]

/** Nova on the park bench. Same outline and pixel size as the people. */
export function drawCat(ctx: CanvasRenderingContext2D, x: number, y: number, blink: boolean): void {
  const colors: Record<string, string> = {
    o: OUTLINE,
    h: "#1a1424",
    e: blink ? "#1a1424" : "#b6ff6a",
  }
  const width = CAT[0].length * PX
  const left = Math.round(x - width / 2)
  const top = Math.round(y - (CAT.length - 1) * PX)
  for (let r = 0; r < CAT.length; r++) {
    for (let c = 0; c < CAT[r].length; c++) {
      const color = colors[CAT[r][c]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(left + c * PX, top + r * PX, PX, PX)
    }
  }
}
