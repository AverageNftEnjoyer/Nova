import { drawWeatherOverlay } from "../effects"
import { draw5, measure5 } from "../font5x7"
import { paletteFor } from "../palette"
import { cellNoise } from "../random"
import {
  EMPTY_CITY_STATE,
  type CityAgent,
  type CityPlaceId,
  type CityRect,
  type CitySceneHit,
  type CitySceneRenderer,
  type CitySceneState,
  type CityTaskLight,
  type CityWorkplace,
} from "../types"
import {
  CAT_SPOT,
  DISTRICT_IMAGE_HEIGHT,
  DISTRICT_IMAGE_SRC,
  DISTRICT_IMAGE_WIDTH,
  DISTRICT_PLACES,
  FOUNTAIN,
  HQ_FLOORS,
  HQ_FLOORS_RIGHT,
  HQ_SIGN,
  LAMPS,
  NOTICE_FACE,
  ROADS,
  TICKER_BOARD,
  WALK_EDGES,
  WALK_NODES,
  WORKPLACE_DOOR,
  WORKPLACE_NAME,
  type PaintedSign,
  type SignRect,
  type WalkNodeId,
} from "./image-plan"

/**
 * The District view: the painted night city, brought to life. The image is drawn at its native size and every live
 * element is painted on top in image pixels (the scene component scales the canvas to cover the screen):
 * signs lit or dark by integration status, twinkling windows, task floors on Nova HQ, the noticeboard's notes, the
 * crypto ticker, the power meter, the fountain, cars and buses, townsfolk, and one walking character per agent task.
 */

const TOWNSFOLK = 14
const MAX_AGENTS = 12
const MAX_BUSES = 3
const WINDOW_CELL = 4
const WINDOW_BUCKET_SECONDS = 4
/** Art pixels in the painting are about 2 image pixels, so the fallback figures are drawn at 2x. */
const PX = 2
/**
 * PixelLab character sheets: 8 direction rows (south, south-east, east, north-east, north, north-west, west,
 * south-west) by 5 columns (standing, then 4 walk frames), 48 px cells. The cat sheet has the standing column only.
 */
const SHEET_CELL = 48
const SHEET_BASE = "/pixel-city/town/characters"
const TOWNSFOLK_SHEETS = ["folk-red", "folk-blue", "folk-office", "folk-coat"] as const
const AGENT_SHEET = "agent"
const CAT_SHEET = "cat"
/**
 * Agents dress for the job they are doing: every outfit shares the Nova look (teal accents, glowing cyan visor).
 * Workplaces without their own outfit use the base agent.
 */
const ROLE_SHEET: Readonly<Record<CityWorkplace, string>> = {
  hq: AGENT_SHEET,
  lab: "agent-lab",
  comms: "agent-courier",
  post: "agent-courier",
  bank: "agent-trader",
  parlour: "agent-trader",
  cinema: "agent-media",
  library: "agent-research",
  power: AGENT_SHEET,
  depot: AGENT_SHEET,
}
const ROLE_SHEETS = Array.from(new Set(Object.values(ROLE_SHEET)))
const NOVA_CYAN = "#3ff2e0"
const TRAIL_LENGTH = 12

/** Tiny work icons (7x7) shown in an agent's bubble while it works: what the job is, at a glance. */
const WORK_ICON: Readonly<Record<CityWorkplace, readonly string[]>> = {
  hq: ["1.....1", "11....1", "1.1...1", "1..1..1", "1...1.1", "1....11", "1.....1"],
  lab: ["..111..", "...1...", "...1...", "..1.1..", ".1...1.", "1.111.1", "1111111"],
  comms: ["1111111", "11...11", "1.1.1.1", "1..1..1", "1.....1", "1.....1", "1111111"],
  post: ["1111111", "11...11", "1.1.1.1", "1..1..1", "1.....1", "1.....1", "1111111"],
  bank: ["..111..", ".1.1.1.", ".1.1...", "..111..", "...1.1.", ".1.1.1.", "..111.."],
  parlour: ["......1", ".....11", "1...1.1", "11.1..1", "1.1...1", "1.....1", "1111111"],
  cinema: ["1......", "11.....", "111....", "1111...", "111....", "11.....", "1......"],
  library: ["111.111", "1.1.1.1", "1.1.1.1", "1.1.1.1", "1.1.1.1", "111.111", "..111.."],
  power: ["...11..", "..11...", ".11....", "111111.", "...11..", "..11...", ".11...."],
  depot: [".11111.", "1.1.1.1", "1111111", "1111111", "1111111", ".1...1.", "......."],
}

/** Sheet row for a movement direction on screen (y grows downward). */
function directionRow(dx: number, dy: number): number {
  const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
  return (10 - octant) % 8
}

interface CharacterSheet {
  image: HTMLImageElement
  /** Lowest opaque row of the standing south frame: where the feet are inside a cell. */
  footY: number
}

type Point = { x: number; y: number }

// ── Walk graph ────────────────────────────────────────────────────────────────

const ADJ: Map<WalkNodeId, WalkNodeId[]> = (() => {
  const adj = new Map<WalkNodeId, WalkNodeId[]>()
  for (const id of Object.keys(WALK_NODES)) adj.set(id, [])
  for (const [a, b] of WALK_EDGES) {
    adj.get(a)?.push(b)
    adj.get(b)?.push(a)
  }
  return adj
})()
const NODE_IDS = Object.keys(WALK_NODES)

function route(from: WalkNodeId, to: WalkNodeId): Point[] {
  const prev = new Map<WalkNodeId, WalkNodeId | null>([[from, null]])
  const queue: WalkNodeId[] = [from]
  while (queue.length > 0) {
    const cur = queue.shift() as WalkNodeId
    if (cur === to) break
    for (const next of ADJ.get(cur) ?? []) {
      if (prev.has(next)) continue
      prev.set(next, cur)
      queue.push(next)
    }
  }
  if (!prev.has(to)) return [pointOf(from)]
  const ids: WalkNodeId[] = []
  for (let k: WalkNodeId | null = to; k !== null; k = prev.get(k) ?? null) ids.push(k)
  return ids.reverse().map(pointOf)
}

function pointOf(id: WalkNodeId): Point {
  const [x, y] = WALK_NODES[id]
  return { x, y }
}

// ── Walkers ───────────────────────────────────────────────────────────────────

interface Walker {
  kind: "townsfolk" | "agent"
  id: string
  node: WalkNodeId
  path: Point[]
  seg: number
  segT: number
  speed: number
  idleUntil: number
  x: number
  y: number
  /** Small sideways offset so people on the same path don't overlap exactly. */
  lane: number
  shirt: string
  pants: string
  hair: string
  skin: string
  moving: boolean
  sheet: string
  /** Sheet row the character faces. */
  dir: number
  // Agents only.
  agent?: CityAgent
  /** Leaving the scene (task gone or finished and home). */
  leaving?: boolean
  fade?: number
  /** Recent positions, newest last: the data trail behind a walking agent. */
  trail?: Point[]
}

const SHIRTS = ["#c65a6a", "#4f8ac6", "#e2d6b8", "#6aa870", "#d08a4a", "#8a6ac6", "#d8c24a", "#5a6a8a"]
const PANTS = ["#23232e", "#2e3a4e", "#4a3a2e", "#3a2a3a"]
const HAIR = ["#1a1414", "#3a2a1e", "#6a4a2a", "#c8b070", "#8a3a2a"]
const SKIN = ["#f0c8a0", "#d8a47a", "#a8724c", "#7a4a30"]

function pick<T>(list: readonly T[], n: number): T {
  return list[Math.floor(n * list.length) % list.length]
}

function isHome(a: CityAgent): boolean {
  return a.status === "queued" || a.status === "completed" || a.status === "failed"
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class ImageDistrictRenderer implements CitySceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private image: HTMLImageElement | null = null
  private ready = false
  private state: CitySceneState = EMPTY_CITY_STATE
  private windows: Array<{ x: number; y: number }> = []
  /** Each image sign with its neon switched off (bright pixels dimmed), shown when a disconnected sign flickers. */
  private unlitSigns = new Map<SignRect, HTMLCanvasElement>()
  /** Board and letter colours sampled from the image under each repainted sign. */
  private paintedColors = new Map<PaintedSign, { board: string; letters: string }>()
  private walkers: Walker[] = []
  private lastT = 0
  private seed = 1
  private sheets = new Map<string, CharacterSheet>()
  /** Device pixels per plan pixel: the canvas draws at screen resolution, the plan stays in image coordinates. */
  private k = 1

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D is unavailable")
    this.ctx = ctx
    canvas.width = DISTRICT_IMAGE_WIDTH
    canvas.height = DISTRICT_IMAGE_HEIGHT
    const img = new Image()
    img.decoding = "async"
    img.onload = () => {
      this.image = img
      this.ready = true
      this.findWindows()
      this.render(performance.now() / 1000)
    }
    img.src = DISTRICT_IMAGE_SRC
    for (const name of [...TOWNSFOLK_SHEETS, ...ROLE_SHEETS, CAT_SHEET]) this.loadSheet(name)
    for (let i = 0; i < TOWNSFOLK; i++) this.walkers.push(this.spawnTownsfolk(i))
  }

  private loadSheet(name: string): void {
    const image = new Image()
    image.onload = () => {
      // Find the feet: the lowest opaque row of the first cell.
      let footY = SHEET_CELL - 4
      const probe = document.createElement("canvas")
      probe.width = SHEET_CELL
      probe.height = SHEET_CELL
      const pctx = probe.getContext("2d")
      if (pctx) {
        pctx.drawImage(image, 0, 0, SHEET_CELL, SHEET_CELL, 0, 0, SHEET_CELL, SHEET_CELL)
        const data = pctx.getImageData(0, 0, SHEET_CELL, SHEET_CELL).data
        for (let y = SHEET_CELL - 1; y >= 0; y--) {
          let opaque = false
          for (let x = 0; x < SHEET_CELL; x++) if (data[(y * SHEET_CELL + x) * 4 + 3] > 40) opaque = true
          if (opaque) {
            footY = y
            break
          }
        }
      }
      this.sheets.set(name, { image, footY })
    }
    // A missing sheet just keeps the fallback figure.
    image.onerror = () => undefined
    image.src = `${SHEET_BASE}/${name}.png`
  }

  /**
   * The scene component passes the canvas's size in device pixels (the plan's 1376x768 scaled to cover the screen),
   * so the painting and every sprite are drawn at screen resolution instead of being stretched afterwards.
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    this.k = w / DISTRICT_IMAGE_WIDTH
  }

  setState(next: CitySceneState): void {
    this.state = next
    this.syncAgents()
  }

  hotspots(): Partial<Record<CityPlaceId, CityRect>> {
    const out: Partial<Record<CityPlaceId, CityRect>> = {}
    for (const place of DISTRICT_PLACES) out[place.id] = place.hit
    return out
  }

  hitTest(x: number, y: number): CitySceneHit | null {
    for (const w of this.walkers) {
      if (w.kind !== "agent" || !w.agent || w.leaving) continue
      if (Math.abs(x - w.x) <= 8 && y >= w.y - 32 && y <= w.y + 2) {
        return { kind: "agent", id: w.agent.id, label: w.agent.name, detail: this.agentDetail(w), anchorX: w.x, anchorY: w.y - 38 }
      }
    }
    for (let i = DISTRICT_PLACES.length - 1; i >= 0; i--) {
      const r = DISTRICT_PLACES[i].hit
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: "hotspot", id: DISTRICT_PLACES[i].id }
    }
    return null
  }

  // ── Setup helpers ───────────────────────────────────────────────────────────

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  private spawnTownsfolk(i: number): Walker {
    const node = NODE_IDS[Math.floor(cellNoise(i, 3, 91) * NODE_IDS.length)]
    const p = pointOf(node)
    return {
      kind: "townsfolk",
      id: `folk-${i}`,
      node,
      path: [p],
      seg: 0,
      segT: 0,
      speed: 14 + cellNoise(i, 1, 91) * 10,
      idleUntil: cellNoise(i, 2, 91) * 4,
      x: p.x,
      y: p.y,
      lane: (cellNoise(i, 4, 91) - 0.5) * 10,
      shirt: pick(SHIRTS, cellNoise(i, 5, 91)),
      pants: pick(PANTS, cellNoise(i, 6, 91)),
      hair: pick(HAIR, cellNoise(i, 7, 91)),
      skin: pick(SKIN, cellNoise(i, 8, 91)),
      moving: false,
      sheet: TOWNSFOLK_SHEETS[i % TOWNSFOLK_SHEETS.length],
      dir: 0,
    }
  }

  /** Finds lit windows (warm, bright 4x4 cells) once, so some can switch off and on over time. */
  private findWindows(): void {
    if (!this.image) return
    const probe = document.createElement("canvas")
    probe.width = DISTRICT_IMAGE_WIDTH
    probe.height = DISTRICT_IMAGE_HEIGHT
    const pctx = probe.getContext("2d")
    if (!pctx) return
    pctx.drawImage(this.image, 0, 0, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT)
    const data = pctx.getImageData(0, 0, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT).data
    const excluded: SignRect[] = [
      HQ_SIGN,
      ...DISTRICT_PLACES.flatMap((p) => [...p.signs, ...(p.painted ? [p.painted.rect] : [])]),
      { x: 1000, y: 380, w: 130, h: 100 }, // fountain glow
    ]
    const inside = (x: number, y: number) => excluded.some((r) => x >= r.x - 4 && x < r.x + r.w + 4 && y >= r.y - 4 && y < r.y + r.h + 4)
    const found: Array<{ x: number; y: number }> = []
    for (let y = 100; y < DISTRICT_IMAGE_HEIGHT - WINDOW_CELL; y += WINDOW_CELL) {
      for (let x = 0; x < DISTRICT_IMAGE_WIDTH - WINDOW_CELL; x += WINDOW_CELL) {
        let warm = 0
        for (let dy = 0; dy < WINDOW_CELL; dy++) {
          for (let dx = 0; dx < WINDOW_CELL; dx++) {
            const o = ((y + dy) * DISTRICT_IMAGE_WIDTH + (x + dx)) * 4
            const r = data[o]
            const g = data[o + 1]
            const b = data[o + 2]
            if (r > 200 && g > 140 && b < 150 && r - b > 90) warm++
          }
        }
        if (warm >= 12 && !inside(x, y)) found.push({ x, y })
      }
    }
    this.windows = found
    this.unlitSigns.clear()
    for (const place of DISTRICT_PLACES) {
      for (const r of place.signs) {
        const c = document.createElement("canvas")
        c.width = r.w
        c.height = r.h
        const cctx = c.getContext("2d")
        if (!cctx) continue
        const img = pctx.getImageData(r.x, r.y, r.w, r.h)
        const px = img.data
        for (let o = 0; o < px.length; o += 4) {
          const lum = 0.3 * px[o] + 0.59 * px[o + 1] + 0.11 * px[o + 2]
          if (lum < 95) continue
          // Neon off: the tube keeps a faint tint of its colour.
          const k = 0.32
          px[o] = px[o] * k + 18
          px[o + 1] = px[o + 1] * k + 14
          px[o + 2] = px[o + 2] * k + 26
        }
        cctx.putImageData(img, 0, 0)
        this.unlitSigns.set(r, c)
      }
      if (place.painted) this.paintedColors.set(place.painted, this.sampleSign(pctx, place.painted.rect))
    }
  }

  /** The dark board and the bright lettering of the sign that was painted there, as CSS colours. */
  private sampleSign(pctx: CanvasRenderingContext2D, rect: SignRect): { board: string; letters: string } {
    // Only the middle of the sign: the edges of the rect catch pavement, trees and walls.
    const ix = Math.round(rect.w * 0.2)
    const iy = Math.round(rect.h * 0.2)
    const px = pctx.getImageData(rect.x + ix, rect.y + iy, Math.max(1, rect.w - ix * 2), Math.max(1, rect.h - iy * 2)).data
    const samples: Array<[number, number, number, number]> = []
    for (let o = 0; o < px.length; o += 4) samples.push([0.3 * px[o] + 0.59 * px[o + 1] + 0.11 * px[o + 2], px[o], px[o + 1], px[o + 2]])
    samples.sort((a, b) => a[0] - b[0])
    const avg = (from: number, to: number) => {
      const slice = samples.slice(Math.floor(samples.length * from), Math.max(Math.floor(samples.length * from) + 1, Math.floor(samples.length * to)))
      const sum = slice.reduce((acc, p) => [acc[0] + p[1], acc[1] + p[2], acc[2] + p[3]], [0, 0, 0])
      return `rgb(${Math.round(sum[0] / slice.length)}, ${Math.round(sum[1] / slice.length)}, ${Math.round(sum[2] / slice.length)})`
    }
    return { board: avg(0.1, 0.45), letters: avg(0.93, 1) }
  }

  // ── Agents ──────────────────────────────────────────────────────────────────

  private syncAgents(): void {
    const wanted = this.state.agents.slice(0, MAX_AGENTS)
    const byId = new Map(wanted.map((a) => [a.id, a]))
    for (const w of this.walkers) {
      if (w.kind !== "agent" || !w.agent) continue
      const next = byId.get(w.agent.id)
      if (!next) {
        if (!w.leaving) this.sendTo(w, WORKPLACE_DOOR.hq)
        w.leaving = true
        continue
      }
      const changed = next.status !== w.agent.status || next.workplace !== w.agent.workplace
      w.agent = next
      w.sheet = ROLE_SHEET[next.workplace]
      if (changed) this.sendTo(w, isHome(next) ? WORKPLACE_DOOR.hq : WORKPLACE_DOOR[next.workplace])
    }
    const present = new Set(this.walkers.filter((w) => w.kind === "agent" && w.agent).map((w) => w.agent?.id))
    wanted.forEach((agent, i) => {
      if (present.has(agent.id)) return
      const start = pointOf(WORKPLACE_DOOR.hq)
      const w: Walker = {
        kind: "agent",
        id: agent.id,
        node: WORKPLACE_DOOR.hq,
        path: [start],
        seg: 0,
        segT: 0,
        speed: 24,
        idleUntil: 0,
        x: start.x,
        y: start.y,
        lane: ((i % 5) - 2) * 5,
        shirt: "#3ff2e0",
        pants: "#1f6f6a",
        hair: "#12302e",
        skin: pick(SKIN, cellNoise(i, 9, 17)),
        moving: false,
        sheet: ROLE_SHEET[agent.workplace],
        dir: 0,
        trail: [],
        agent,
      }
      this.walkers.push(w)
      if (!isHome(agent)) this.sendTo(w, WORKPLACE_DOOR[agent.workplace])
    })
  }

  private sendTo(w: Walker, target: WalkNodeId): void {
    w.path = route(w.node, target)
    w.seg = 0
    w.segT = 0
    w.node = target
    w.moving = w.path.length > 1
  }

  private agentDetail(w: Walker): string {
    const a = w.agent
    if (!a) return ""
    const place = WORKPLACE_NAME[a.workplace]
    if (w.leaving) return "done · heading home"
    if (a.status === "queued") return "queued · waiting at Nova HQ"
    if (a.status === "completed") return "completed · back at Nova HQ"
    if (a.status === "failed") return "failed · back at Nova HQ"
    if (w.moving) return `${a.status} · walking to the ${place}`
    return a.status === "paused" ? `paused · at the ${place}` : `running · working at the ${place}`
  }

  // ── Frame ───────────────────────────────────────────────────────────────────

  render(timeSeconds: number): void {
    const ctx = this.ctx
    const t = timeSeconds
    const dt = this.lastT === 0 ? 0 : Math.min(0.25, Math.max(0, t - this.lastT))
    this.lastT = t
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0)
    if (!this.ready || !this.image) {
      ctx.fillStyle = "#120f24"
      ctx.fillRect(0, 0, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT)
      return
    }
    // The painting is scaled smoothly (from its full source resolution); sprites and signs stay pixel-sharp.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(this.image, 0, 0, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT)
    ctx.imageSmoothingEnabled = false
    this.drawWindows(t)
    this.drawSigns(t)
    this.drawHq(t)
    this.drawNotices()
    this.drawTicker(t)
    this.drawLamps(t)
    this.drawFountain(t)
    this.drawTraffic(t)
    this.stepWalkers(t, dt)
    this.drawWalkers(t)
    this.drawCat(t)
    drawWeatherOverlay(ctx, paletteFor("night"), this.state.weather, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT, t, 300)
  }

  private drawWindows(t: number): void {
    const bucket = Math.floor(t / WINDOW_BUCKET_SECONDS)
    const ctx = this.ctx
    ctx.fillStyle = "rgba(34, 24, 40, 0.86)"
    this.windows.forEach((w, i) => {
      // About one window in thirty is dark at any moment; each re-rolls every few seconds, staggered.
      const n = cellNoise(i, bucket + (i % 7), 23)
      if (n < 0.033) ctx.fillRect(w.x, w.y, WINDOW_CELL, WINDOW_CELL)
    })
  }

  private isLit(place: (typeof DISTRICT_PLACES)[number]): boolean {
    return !place.integration || this.state.connectedIntegrations.includes(place.integration)
  }

  private drawSigns(t: number): void {
    const ctx = this.ctx
    for (const place of DISTRICT_PLACES) {
      const lit = this.isLit(place)
      for (const r of place.signs) {
        const unlit = this.unlitSigns.get(r)
        if (unlit && this.flickersOff(lit, t, r.x)) {
          // Cut from the painting, so it is scaled the same smooth way.
          ctx.imageSmoothingEnabled = true
          ctx.drawImage(unlit, r.x, r.y)
          ctx.imageSmoothingEnabled = false
        }
      }
      if (place.painted) this.drawPainted(place.painted, lit, t)
    }
  }

  /**
   * Signs look like the painting: lit. A connected integration's sign only blinks off very rarely; a disconnected
   * one stutters like a faulty neon tube, a half-second burst every nine seconds.
   */
  private flickersOff(lit: boolean, t: number, salt: number): boolean {
    if (lit) return cellNoise(Math.floor(t * 9), salt, 5) < 0.012
    const cycle = (t + cellNoise(salt, 1, 9) * 9) % 9
    return cycle < 0.5 && Math.floor(t * 12) % 3 !== 0
  }

  private drawPainted(sign: PaintedSign, lit: boolean, t: number): void {
    const ctx = this.ctx
    const colors = this.paintedColors.get(sign)
    if (!colors) return
    const { x, y, w, h } = sign.rect
    // Cover the wrong lettering with the sign's own board colour, then letter it in the sign's own ink.
    ctx.fillStyle = colors.board
    ctx.fillRect(x, y, w, h)
    const off = this.flickersOff(lit, t, x)
    const ink = off ? colors.board : colors.letters
    const drawText = (dx: number, dy: number, color: string) => {
      ctx.fillStyle = color
      if (sign.vertical) {
        const scale = h >= sign.text.length * 16 - 2 ? 2 : 1
        const step = 7 * scale + 2
        const top = y + Math.floor((h - (sign.text.length * step - 2)) / 2)
        sign.text.split("").forEach((ch, i) => draw5(ctx, ch, x + dx + Math.floor((w - 5 * scale) / 2), top + dy + i * step, color, scale))
      } else {
        // Condensed 2x lettering (5 px glyphs, 1 px gaps) when it fits, like the painted signs; 1x otherwise.
        const fits2 = sign.text.length * 11 - 1 <= w - 2 && h >= 16
        if (fits2) {
          const total = sign.text.length * 11 - 1
          sign.text.split("").forEach((ch, i) => draw5(ctx, ch, x + dx + Math.floor((w - total) / 2) + i * 11, y + dy + Math.floor((h - 14) / 2), color, 2))
        } else {
          const tw = measure5(sign.text)
          draw5(ctx, sign.text, x + dx + Math.floor((w - tw) / 2), y + dy + Math.floor((h - 7) / 2), color)
        }
      }
    }
    if (!off) {
      // Neon halo: the letters bleed a soft glow onto the board.
      ctx.globalAlpha = 0.28
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) drawText(dx, dy, colors.letters)
      ctx.globalAlpha = 1
    }
    drawText(0, 0, ink)
  }

  private taskColor(light: CityTaskLight, t: number, i: number): string {
    switch (light) {
      case "running":
        return Math.floor(t * 3 + i) % 2 === 0 ? "#7fffe8" : "#ffe9b0"
      case "queued":
        return "#8fd4ff"
      case "paused":
        return Math.floor(t * 1.5) % 2 === 0 ? "#ffc24a" : "#3a2a10"
      case "failed":
        return "#ff5a5a"
      case "completed":
        return "#58f08c"
    }
  }

  private drawHq(t: number): void {
    const ctx = this.ctx
    const lights = this.state.taskLights
    ;[HQ_FLOORS, HQ_FLOORS_RIGHT].forEach((floors) =>
      floors.forEach((r, i) => {
        const light = lights[i]
        if (!light) return
        ctx.globalAlpha = 0.75
        ctx.fillStyle = this.taskColor(light, t, i)
        ctx.fillRect(r.x, r.y, r.w, r.h)
        ctx.globalAlpha = 0.18
        ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
        ctx.globalAlpha = 1
      }),
    )
    // The NOVA sign breathes while any agent is working.
    if (lights.includes("running")) {
      ctx.globalAlpha = 0.07 + 0.06 * (Math.sin(t * 2.2) + 1) / 2
      ctx.fillStyle = "#7fffe8"
      ctx.fillRect(HQ_SIGN.x, HQ_SIGN.y, HQ_SIGN.w, HQ_SIGN.h)
      ctx.globalAlpha = 1
    }
  }

  private drawNotices(): void {
    const ctx = this.ctx
    const count = Math.min(6, Math.max(0, this.state.notesCount))
    for (let i = 0; i < count; i++) {
      const x = NOTICE_FACE.x + 3 + (i % 3) * 17
      const y = NOTICE_FACE.y + 2 + Math.floor(i / 3) * 14
      ctx.fillStyle = "#f4ecd0"
      ctx.fillRect(x, y, 12, 10)
      ctx.fillStyle = "#8a8070"
      ctx.fillRect(x + 2, y + 3, 8, 1)
      ctx.fillRect(x + 2, y + 6, 6, 1)
      ctx.fillStyle = "#ff5a5a"
      ctx.fillRect(x + 5, y, 2, 2)
    }
  }

  private drawTicker(t: number): void {
    const ctx = this.ctx
    const b = TICKER_BOARD
    ctx.fillStyle = "#0a0d10"
    ctx.fillRect(b.x, b.y, b.w, b.h)
    const items = this.state.ticker.length > 0 ? this.state.ticker : [{ label: "NOVA", value: "MARKETS", up: true }]
    const gap = 14
    const segments = items.map((it) => ({ text: `${it.label} ${it.value}`, up: it.up }))
    const total = segments.reduce((sum, s) => sum + measure5(s.text) + gap, 0)
    const offset = Math.floor((t * 16) % total)
    const clip = { x0: b.x + 1, x1: b.x + b.w - 1 }
    for (let pass = 0; pass < 2; pass++) {
      let x = b.x + 2 - offset + pass * total
      for (const s of segments) {
        if (x > clip.x1) break
        draw5(ctx, s.text, x, b.y + 3, s.up ? "#58f08c" : "#ff5a5a", 1, clip)
        x += measure5(s.text) + gap
      }
    }
  }

  private drawLamps(t: number): void {
    const ctx = this.ctx
    LAMPS.forEach(([x, y], i) => {
      ctx.globalAlpha = 0.1 + 0.05 * Math.sin(t * 1.7 + i * 2)
      ctx.fillStyle = "#ffd88a"
      ctx.fillRect(x - 10, y - 8, 20, 20)
      ctx.globalAlpha = 1
    })
  }

  private drawFountain(t: number): void {
    const ctx = this.ctx
    // Droplets rise from the spout and fall back into the basin in a loop.
    for (let i = 0; i < 26; i++) {
      const phase = (t * 0.9 + cellNoise(i, 0, 61)) % 1
      const side = cellNoise(i, 1, 61) * 2 - 1
      const x = FOUNTAIN.x + side * 22 * phase
      const y = FOUNTAIN.y - 26 * Math.sin(phase * Math.PI) + phase * (FOUNTAIN.basinY - FOUNTAIN.y)
      ctx.fillStyle = i % 3 === 0 ? "#e8fffd" : "#7fdcff"
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2)
    }
  }

  private drawTraffic(t: number): void {
    const buses = Math.min(MAX_BUSES, Math.max(0, Math.floor(this.state.activeRuns)))
    const vehicles: Array<{ road: number; offset: number; speed: number; dir: 1 | -1; bus: boolean; color: string }> = [
      { road: 0, offset: 0.1, speed: 0.045, dir: 1, bus: false, color: "#c8453a" },
      { road: 0, offset: 0.6, speed: 0.038, dir: -1, bus: false, color: "#e8e4dc" },
      { road: 1, offset: 0.3, speed: 0.04, dir: -1, bus: false, color: "#3a6ab0" },
      { road: 1, offset: 0.8, speed: 0.034, dir: 1, bus: false, color: "#e0b040" },
    ]
    for (let i = 0; i < buses; i++) vehicles.push({ road: i % 2, offset: 0.2 + i * 0.33, speed: 0.03, dir: i % 2 === 0 ? 1 : -1, bus: true, color: "#2f9a5a" })
    for (const v of vehicles) {
      const [[x0, y0], [x1, y1]] = ROADS[v.road] as ReadonlyArray<readonly [number, number]>
      let p = (v.offset + t * v.speed) % 1
      if (v.dir === -1) p = 1 - p
      const x = x0 + (x1 - x0) * p
      const y = y0 + (y1 - y0) * p
      const slope = (y1 - y0) / (x1 - x0)
      // Right-hand traffic: each direction keeps to its own side of the centre line.
      this.drawVehicle(x, y + (v.dir === 1 ? 6 : -6), slope, v.dir === 1 ? Math.sign(x1 - x0) : -Math.sign(x1 - x0), v.bus, v.color)
    }
  }

  /** A car or bus seen from the isometric camera, sheared along the road's slope. */
  private drawVehicle(cx: number, cy: number, slope: number, facing: number, bus: boolean, color: string): void {
    const ctx = this.ctx
    const len = bus ? 36 : 24
    const body = bus ? 12 : 8
    const x0 = Math.round(cx - len / 2)
    const dark = "rgba(0, 0, 0, 0.28)"
    for (let i = 0; i < len; i++) {
      const base = Math.round(cy + (i - len / 2) * slope)
      // Shadow, wheels, body, window band, roof.
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)"
      ctx.fillRect(x0 + i + 2, base, 1, 3)
      ctx.fillStyle = color
      ctx.fillRect(x0 + i, base - body, 1, body)
      ctx.fillStyle = dark
      ctx.fillRect(x0 + i, base - 3, 1, 3)
      const nose = i < 4 || i >= len - 4
      if (bus) {
        ctx.fillStyle = i % 5 === 0 || nose ? color : "#bfe6ff"
        ctx.fillRect(x0 + i, base - body + 2, 1, 4)
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)"
        ctx.fillRect(x0 + i, base - body, 1, 1)
      } else if (!nose) {
        // Cabin: raised roof with dark windows.
        ctx.fillStyle = color
        ctx.fillRect(x0 + i, base - body - 4, 1, 4)
        ctx.fillStyle = i === 4 || i === len - 5 || i === Math.floor(len / 2) ? color : "#1a2230"
        ctx.fillRect(x0 + i, base - body - 3, 1, 3)
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
        ctx.fillRect(x0 + i, base - body - 4, 1, 1)
      }
      if (i === 5 || i === len - 6) {
        ctx.fillStyle = "#101014"
        ctx.fillRect(x0 + i - 1, base - 2, 3, 3)
      }
    }
    const frontI = facing > 0 ? len - 1 : 0
    const backI = facing > 0 ? 0 : len - 1
    const fy = Math.round(cy + (frontI - len / 2) * slope)
    const by = Math.round(cy + (backI - len / 2) * slope)
    ctx.fillStyle = "#fff2b0"
    ctx.fillRect(x0 + frontI - (facing > 0 ? 1 : 0), fy - 6, 2, 2)
    // Headlight beam on the road.
    ctx.globalAlpha = 0.22
    for (let k = 1; k <= 14; k++) {
      const bx = x0 + frontI + facing * k
      ctx.fillRect(bx, Math.round(fy + facing * k * slope) - 6 + Math.floor(k / 5), 1, 2 + Math.floor(k / 4))
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = "#ff4a4a"
    ctx.fillRect(x0 + backI - (facing > 0 ? 0 : 1), by - 6, 2, 2)
  }

  // ── People ──────────────────────────────────────────────────────────────────

  private stepWalkers(t: number, dt: number): void {
    for (const w of this.walkers) {
      if (w.moving && w.path.length > 1) {
        let remaining = w.speed * dt
        while (remaining > 0 && w.seg < w.path.length - 1) {
          const a = w.path[w.seg]
          const b = w.path[w.seg + 1]
          const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
          const left = (1 - w.segT) * len
          if (remaining >= left) {
            remaining -= left
            w.seg++
            w.segT = 0
          } else {
            w.segT += remaining / len
            remaining = 0
          }
        }
        const a = w.path[Math.min(w.seg, w.path.length - 1)]
        const b = w.path[Math.min(w.seg + 1, w.path.length - 1)]
        w.x = a.x + (b.x - a.x) * w.segT
        w.y = a.y + (b.y - a.y) * w.segT
        if (b.x !== a.x || b.y !== a.y) w.dir = directionRow(b.x - a.x, b.y - a.y)
        if (w.trail) {
          const last = w.trail[w.trail.length - 1]
          if (!last || Math.hypot(last.x - w.x, last.y - w.y) >= 4) w.trail.push({ x: w.x, y: w.y })
          if (w.trail.length > TRAIL_LENGTH) w.trail.shift()
        }
        if (w.seg >= w.path.length - 1) {
          w.moving = false
          if (w.kind === "agent") w.dir = 0
          w.idleUntil = t + (w.kind === "townsfolk" ? 1 + this.rand() * 4 : 18 + this.rand() * 20)
          if (w.leaving) w.fade = t
        }
        continue
      }
      if (w.kind === "townsfolk" && t >= w.idleUntil) {
        const target = NODE_IDS[Math.floor(this.rand() * NODE_IDS.length)]
        if (target !== w.node) this.sendTo(w, target)
      } else if (w.kind === "agent" && w.agent && !w.leaving && w.agent.status === "running" && t >= w.idleUntil) {
        // A working agent sometimes steps out to a neighbouring spot and comes back, so the street keeps moving.
        const door = WORKPLACE_DOOR[w.agent.workplace]
        const next = w.node === door ? (ADJ.get(door) ?? [door])[Math.floor(this.rand() * (ADJ.get(door)?.length ?? 1))] : door
        this.sendTo(w, next)
      }
    }
    // Finished agents fade out once they are home.
    this.walkers = this.walkers.filter((w) => !(w.fade !== undefined && t - w.fade > 2))
  }

  private drawWalkers(t: number): void {
    const list = this.walkers.slice().sort((a, b) => a.y - b.y)
    for (const w of list) {
      const x = Math.round(w.x + w.lane * 0.6)
      const y = Math.round(w.y + w.lane * 0.3)
      const alpha = w.fade !== undefined ? Math.max(0, 1 - (t - w.fade) / 2) : 1
      this.ctx.globalAlpha = alpha
      if (w.kind === "agent") this.drawAgentAura(x, y, w, t)
      this.drawPerson(x, y, w, t)
      this.ctx.globalAlpha = 1
      if (w.kind === "agent" && w.agent && alpha > 0.2) this.drawAgentBadge(x, y, w, t)
    }
  }

  private drawPerson(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const sheet = this.sheets.get(w.sheet) ?? (w.kind === "agent" ? this.sheets.get(AGENT_SHEET) : undefined)
    if (sheet) {
      const cols = Math.round(sheet.image.width / SHEET_CELL)
      const col = w.moving && cols > 1 ? 1 + (Math.floor(t * 8 + Math.abs(w.lane)) % 4) : 0
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)"
      ctx.fillRect(x - 7, y - 1, 14, 3)
      ctx.fillRect(x - 5, y - 2, 10, 5)
      ctx.drawImage(sheet.image, col * SHEET_CELL, w.dir * SHEET_CELL, SHEET_CELL, SHEET_CELL, x - SHEET_CELL / 2, y - sheet.footY, SHEET_CELL, SHEET_CELL)
      return
    }
    const step = w.moving ? Math.floor(t * 6 + w.lane) % 2 : 0
    const rows = [
      ".hhh.",
      "hsssh",
      w.kind === "agent" ? ".vvv." : ".sss.",
      "ccccc",
      "ccccc",
      "scccs",
      ".ppp.",
      step === 0 ? ".p.p." : "..pp.",
      step === 0 ? ".p.p." : ".p..p",
      step === 0 ? ".k.k." : ".k..k",
    ]
    const colors: Record<string, string> = { h: w.hair, s: w.skin, v: "#e8fffd", c: w.shirt, p: w.pants, k: "#141018" }
    const left = x - Math.floor((5 * PX) / 2)
    const top = y - rows.length * PX
    ctx.fillStyle = "rgba(0,0,0,0.35)"
    ctx.fillRect(left, y - 1, 5 * PX, 3)
    rows.forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        const key = row[c]
        if (key === ".") continue
        ctx.fillStyle = colors[key]
        ctx.fillRect(left + c * PX, top + r * PX, PX, PX)
      }
    })
    // Shading: the right column of the shirt is a touch darker.
    ctx.fillStyle = "rgba(0,0,0,0.22)"
    ctx.fillRect(left + 4 * PX, top + 3 * PX, PX, 3 * PX)
  }

  /** Under an agent: a pulsing cyan ring, and a fading data trail behind it while it walks. */
  private drawAgentAura(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const trail = w.moving ? (w.trail ?? []) : []
    trail.forEach((p, i) => {
      ctx.globalAlpha = ((i + 1) / trail.length) * 0.55
      ctx.fillStyle = i % 2 === 0 ? NOVA_CYAN : "#e8fffd"
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2)
    })
    const pulse = (Math.sin(t * 3 + x) + 1) / 2
    ctx.globalAlpha = 0.35 + pulse * 0.3
    ctx.fillStyle = NOVA_CYAN
    ctx.fillRect(x - 8, y - 1, 16, 1)
    ctx.fillRect(x - 10, y, 2, 1)
    ctx.fillRect(x + 8, y, 2, 1)
    ctx.fillRect(x - 8, y + 1, 16, 1)
    ctx.globalAlpha = 0.12 + pulse * 0.1
    ctx.fillRect(x - 9, y - 1, 18, 3)
    ctx.globalAlpha = 1
  }

  /** Above an agent: a floating Nova chip, and while it works, a bubble with its job's icon or its status. */
  private drawAgentBadge(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const a = w.agent
    if (!a) return
    const head = y - 34
    const bob = Math.round(Math.sin(t * 2.4 + x) * 1.5)
    // Holographic "N" chip.
    const cx = x - 5
    const cy = head - 12 + bob
    ctx.globalAlpha = 0.85 - (Math.floor(t * 10 + x) % 17 === 0 ? 0.4 : 0)
    ctx.fillStyle = "#06201e"
    ctx.fillRect(cx, cy, 11, 11)
    ctx.fillStyle = NOVA_CYAN
    ctx.fillRect(cx, cy, 11, 1)
    ctx.fillRect(cx, cy + 10, 11, 1)
    ctx.fillRect(cx, cy, 1, 11)
    ctx.fillRect(cx + 10, cy, 1, 11)
    draw5(ctx, "N", cx + 3, cy + 2, "#e8fffd")
    ctx.globalAlpha = 0.18
    ctx.fillStyle = NOVA_CYAN
    ctx.fillRect(cx - 2, cy - 2, 15, 15)
    ctx.globalAlpha = 1
    if (w.moving || w.leaving) return
    // Work bubble to the right of the chip.
    const bx = x + 8
    const by = head - 16
    ctx.fillStyle = "#f4f1e8"
    ctx.fillRect(bx, by, 13, 11)
    ctx.fillRect(bx - 2, by + 8, 3, 2)
    ctx.fillStyle = "#1a1626"
    ctx.fillRect(bx, by + 11, 13, 1)
    if (a.status === "paused") {
      draw5(ctx, "!", bx + 4, by + 2, "#c88a10")
    } else if (a.status === "failed") {
      draw5(ctx, "X", bx + 4, by + 2, "#d23a3a")
    } else if (a.status === "completed") {
      ctx.fillStyle = "#1f9a55"
      ;[[2, 5], [3, 6], [4, 7], [5, 6], [6, 5], [7, 4], [8, 3], [9, 2]].forEach(([dx, dy]) => ctx.fillRect(bx + dx, by + dy, 2, 2))
    } else if (a.status === "queued") {
      draw5(ctx, "...", bx - 1, by + 2, "#5a6a8a")
    } else {
      // Working: the job's icon, pulsing gently.
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 4)
      const icon = WORK_ICON[a.workplace]
      ctx.fillStyle = "#127a72"
      icon.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "1") ctx.fillRect(bx + 3 + rx, by + 2 + ry, 1, 1)
      })
      ctx.globalAlpha = 1
    }
  }

  private drawCat(t: number): void {
    const ctx = this.ctx
    const { x, y } = CAT_SPOT
    const presence = this.state.presence
    const catSheet = this.sheets.get(CAT_SHEET)
    if (catSheet) {
      // Nova sits on the bench looking towards the fountain; asleep (runtime down), it faces the viewer.
      const row = presence === "offline" ? 0 : 7
      ctx.drawImage(catSheet.image, 0, row * SHEET_CELL, SHEET_CELL, SHEET_CELL, x - SHEET_CELL / 2, y - catSheet.footY, SHEET_CELL, SHEET_CELL)
      if (presence === "offline") {
        const z = Math.floor(t * 1.2) % 3
        for (let i = 0; i <= z; i++) draw5(ctx, "Z", x + 10 + i * 5, y - 22 - i * 7, "#e8e4f8")
        return
      }
    }
    const cat = "#0d0a12"
    if (!catSheet && presence === "offline") {
      ctx.fillStyle = cat
      ctx.fillRect(x - 6, y - 4, 13, 5)
      ctx.fillRect(x - 5, y - 6, 2, 2)
      ctx.fillRect(x - 1, y - 6, 2, 2)
      const z = Math.floor(t * 1.2) % 3
      for (let i = 0; i <= z; i++) draw5(ctx, "Z", x + 8 + i * 5, y - 12 - i * 7, "#e8e4f8")
      return
    }
    if (!catSheet) {
      ctx.fillStyle = cat
      ctx.fillRect(x - 4, y - 10, 9, 10)
      ctx.fillRect(x - 4, y - 13, 2, 3)
      ctx.fillRect(x + 3, y - 13, 2, 3)
      const sway = Math.round(Math.sin(t * (presence === "thinking" ? 4 : 1.6)) * 2)
      ctx.fillRect(x + 5, y - 2, 3, 2)
      ctx.fillRect(x + 7 + Math.max(0, sway), y - 5 + Math.min(0, sway), 2, 4)
      ctx.fillStyle = "#b8ff6a"
      ctx.fillRect(x - 2, y - 8, 1, 1)
      ctx.fillRect(x + 2, y - 8, 1, 1)
    }
    if (presence === "thinking" || presence === "speaking") {
      ctx.fillStyle = "#f4f1e8"
      ctx.fillRect(x - 2, y - 34, 17, 11)
      ctx.fillRect(x + 2, y - 23, 3, 2)
      if (presence === "thinking") {
        const dots = 1 + (Math.floor(t * 2.5) % 3)
        ctx.fillStyle = "#3a3446"
        for (let i = 0; i < dots; i++) ctx.fillRect(x + 1 + i * 4, y - 29, 2, 2)
      } else {
        ctx.fillStyle = "#c88a10"
        ctx.fillRect(x + 6, y - 33, 2, 7)
        ctx.fillRect(x + 4, y - 28, 3, 2)
        ctx.fillRect(x + 8, y - 33, 3, 1)
      }
    }
  }
}
