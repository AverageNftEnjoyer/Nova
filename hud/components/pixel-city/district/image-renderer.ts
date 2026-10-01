import { drawWeatherOverlay } from "../effects"
import { draw5, measure5 } from "../font5x7"
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
} from "../types"
import {
  CAT_SPOT,
  DISTRICT_IMAGE_HEIGHT,
  DISTRICT_IMAGE_SRC,
  DISTRICT_IMAGE_WIDTH,
  DISTRICT_OCCLUDERS,
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
  type PlanPoint,
  type SignRect,
  type WalkNodeId,
} from "./image-plan"
import { CAT_HEIGHT, PERSON_HEIGHT, agentLook, drawCat as paintCat, drawPerson, loadPeopleArt, townsfolkLook, type PersonLook } from "./people"

/**
 * The District view: the painted night city, brought to life. The image is drawn at its native size and every live
 * element is painted on top in image pixels (the scene component scales the canvas to cover the screen):
 * signs lit or dark by integration status, twinkling windows, task floors on Nova HQ, the noticeboard's notes, the
 * crypto ticker, the power meter, the fountain, cars and buses, and the people from `people.ts` (townsfolk, and one
 * figure per agent task).
 */

/** Townsfolk on the streets before the town's population is known (Home's smallest crowd). */
const START_TOWNSFOLK = 6
/** Hard cap on townsfolk, whatever the state asks for: every figure costs occlusion work each frame. */
const MAX_TOWNSFOLK = 60
/** Seconds between two new residents stepping out of their doors, so a quest's newcomers arrive one by one. */
const ARRIVAL_GAP_SECONDS = 0.9
/** Fade-in of a townsperson who appears (on first load) or steps out of a door. */
const APPEAR_SECONDS = 0.8
/** Doors townsfolk step out of when they move in, and walk back into when they leave. */
const FOLK_DOORS: readonly WalkNodeId[] = ["stu", "arc", "cin", "odd", "lab", "cow", "tel", "bnk", "pwr", "shop", "obs", "dep"]
/** Click boxes around a figure's feet (plan px): agents are generous, townsfolk a little tighter so buildings stay easy to hit. */
const AGENT_HIT_HALF_WIDTH = 16
const FOLK_HIT_HALF_WIDTH = 11
const MAX_AGENTS = 12
const MAX_BUSES = 3
const WINDOW_CELL = 4
const WINDOW_BUCKET_SECONDS = 4
const NOVA_CYAN = "#7ef6ea"
/** Height of the park bench's seat above CAT_SPOT (where the bench stands), in plan pixels. */
const CAT_SEAT_LIFT = 9
const TRAIL_LENGTH = 12

/** Sheet row for a movement direction on screen (y grows downward). */
function directionRow(dx: number, dy: number): number {
  const octant = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8
  return (10 - octant) % 8
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

// ── Depth ─────────────────────────────────────────────────────────────────────

/** A plan occluder ready to draw: its outline as one clip path, and that outline's bounding box. */
interface OccluderClip {
  base: ReadonlyArray<PlanPoint>
  path: Path2D
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Built on the client (Path2D is a browser API), once per renderer. */
function buildOccluders(): OccluderClip[] {
  return DISTRICT_OCCLUDERS.map((o) => {
    const path = new Path2D()
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const shape of o.shapes) {
      shape.forEach(([x, y], i) => {
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      })
      path.closePath()
    }
    return { base: o.base, path, x0, y0, x1, y1 }
  })
}

/** The occluder's front ground line at `x`; past either end, that end's y. */
function baseAt(base: ReadonlyArray<PlanPoint>, x: number): number {
  const first = base[0]
  const last = base[base.length - 1]
  if (x <= first[0]) return first[1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < base.length; i++) {
    const [ax, ay] = base[i - 1]
    const [bx, by] = base[i]
    if (x <= bx) return bx === ax ? by : ay + ((by - ay) * (x - ax)) / (bx - ax)
  }
  return last[1]
}

/** Box around a figure standing at (x, y), wide enough for the sprite cell, its shadow and an agent's ground ring. */
const FIGURE_HALF_WIDTH = 30
const FIGURE_HEADROOM = 10
const FIGURE_FOOTROOM = 8

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
  moving: boolean
  /** 0 south, then clockwise-ish: the isometric facing is derived from this. */
  dir: number
  // Agents only.
  agent?: CityAgent
  /** Leaving the scene (task gone or finished and home). */
  leaving?: boolean
  fade?: number
  /** Recent positions, newest last: the data trail behind a walking agent. */
  trail?: Point[]
  /** When the figure started fading in (NaN: on the next frame). Unset for figures that never fade in. */
  appear?: number
}

/** Where a walker is drawn: its path position nudged sideways by its lane, in whole plan pixels. */
function drawnAt(w: Walker): Point {
  return { x: Math.round(w.x + w.lane * 0.6), y: Math.round(w.y + w.lane * 0.3) }
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
  private walkers: Walker[] = []
  /** Townsfolk the state asks for (null until the population is known). */
  private townsfolkWanted: number | null = null
  /** Next time (seconds) a new resident may step out of a door. */
  private nextArrival = 0
  /** Numbers new townsfolk, so each gets the next look in turn. */
  private folkSeq = 0
  /** Structures redrawn over walkers standing behind them (see DISTRICT_OCCLUDERS). */
  private readonly occluders: OccluderClip[] = buildOccluders()
  private lastT = 0
  private seed = 1
  /** Device pixels per plan pixel: the canvas draws at screen resolution, the plan stays in image coordinates. */
  private k = 1
  /** Plan point at the canvas's top-left corner (see `setCamera`). */
  private camX = 0
  private camY = 0

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
    loadPeopleArt()
    for (let i = 0; i < START_TOWNSFOLK; i++) this.walkers.push(this.spawnTownsfolk())
  }

  /**
   * The scene component passes the canvas's size in device pixels (the viewport, not the whole plan): the canvas is
   * the camera's window onto the city, so the painting and every sprite are drawn at screen resolution.
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
  }

  /** Camera: `scale` device pixels per plan pixel, with plan point (`x`, `y`) at the canvas's top-left corner. */
  setCamera(scale: number, x: number, y: number): void {
    this.k = Math.max(0.0001, scale)
    this.camX = x
    this.camY = y
  }

  setState(next: CitySceneState): void {
    this.state = next
    this.syncAgents()
    this.syncTownsfolk()
  }

  hotspots(): Partial<Record<CityPlaceId, CityRect>> {
    const out: Partial<Record<CityPlaceId, CityRect>> = {}
    for (const place of DISTRICT_PLACES) out[place.id] = place.hit
    return out
  }

  /**
   * What is under plan point (x, y). People come first, front-most (lowest on screen) first: an agent always wins,
   * even over a building's button; a townsperson only matters where no button takes the click (the scene decides).
   */
  hitTest(x: number, y: number): CitySceneHit | null {
    const people = this.walkers
      .filter((w) => !w.leaving && w.fade === undefined)
      .map((w) => ({ w, at: drawnAt(w) }))
      .sort((a, b) => b.at.y - a.at.y)
    const over = (at: Point, halfWidth: number) => Math.abs(x - at.x) <= halfWidth && y >= at.y - PERSON_HEIGHT - 6 && y <= at.y + 6
    for (const { w, at } of people) {
      if (w.kind !== "agent" || !w.agent || !over(at, AGENT_HIT_HALF_WIDTH)) continue
      return { kind: "agent", id: w.agent.id, label: w.agent.name, detail: this.agentDetail(w), anchorX: at.x, anchorY: at.y - PERSON_HEIGHT - 4 }
    }
    for (const { w, at } of people) {
      if (w.kind !== "townsfolk" || !over(at, FOLK_HIT_HALF_WIDTH)) continue
      // Still stepping out of a door: not clickable until it is mostly there.
      if (w.appear !== undefined && !(this.lastT - w.appear >= APPEAR_SECONDS / 2)) continue
      return { kind: "townsfolk", id: w.id, anchorX: at.x, anchorY: at.y - PERSON_HEIGHT - 4 }
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

  /**
   * A new townsperson. With no `door` it stands somewhere in the city already (the starting crowd; `appear` fades
   * it in). From a door it steps out, fading in, and walks off into town.
   */
  private spawnTownsfolk(options: { door?: WalkNodeId; appear?: boolean } = {}): Walker {
    const i = this.folkSeq++
    const node = options.door ?? NODE_IDS[Math.floor(cellNoise(i, 3, 91) * NODE_IDS.length)]
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
      moving: false,
      dir: 0,
      ...(options.appear || options.door ? { appear: Number.NaN } : {}),
    }
  }

  // ── Townsfolk ───────────────────────────────────────────────────────────────

  /**
   * Matches the crowd to the population. The first known count fills the streets at once, fading in (the city has
   * not been seen at that size yet); later growth arrives one resident at a time out of a door (admitTownsfolk), and
   * a smaller count sends the newest residents home through the nearest door.
   */
  private syncTownsfolk(): void {
    if (this.state.townsfolk === null) return
    const wanted = Math.min(MAX_TOWNSFOLK, Math.max(0, Math.floor(this.state.townsfolk)))
    const first = this.townsfolkWanted === null
    this.townsfolkWanted = wanted
    const staying = this.walkers.filter((w) => w.kind === "townsfolk" && !w.leaving)
    if (first) for (let n = staying.length; n < wanted; n++) this.walkers.push(this.spawnTownsfolk({ appear: true }))
    for (const w of staying.slice(wanted)) {
      w.leaving = true
      this.sendTo(w, this.nearestDoor(w))
    }
  }

  private nearestDoor(w: Walker): WalkNodeId {
    let best = FOLK_DOORS[0]
    let bestD = Infinity
    for (const id of FOLK_DOORS) {
      const p = pointOf(id)
      const d = Math.hypot(p.x - w.x, p.y - w.y)
      if (d < bestD) {
        best = id
        bestD = d
      }
    }
    return best
  }

  /** Lets in at most one waiting resident every ARRIVAL_GAP_SECONDS: out of a door, then off into town. */
  private admitTownsfolk(t: number): void {
    if (this.townsfolkWanted === null || t < this.nextArrival) return
    let present = 0
    for (const w of this.walkers) if (w.kind === "townsfolk" && !w.leaving) present++
    if (present >= this.townsfolkWanted) return
    const door = FOLK_DOORS[Math.floor(this.rand() * FOLK_DOORS.length)]
    const w = this.spawnTownsfolk({ door })
    w.idleUntil = t + 0.3
    this.walkers.push(w)
    this.nextArrival = t + ARRIVAL_GAP_SECONDS
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
      ...DISTRICT_PLACES.flatMap((p) => p.signs),
      { x: FOUNTAIN.x - 80, y: FOUNTAIN.y - 60, w: 160, h: 120 }, // fountain glow
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
        moving: false,
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
    // Clear first: when the camera shows past the painting's edge (zoomed out, or panned to reveal what the HUD
    // covers) those pixels must not keep the previous frame.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.k, 0, 0, this.k, -this.camX * this.k, -this.camY * this.k)
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
    this.drawHq(t)
    this.drawNotices()
    this.drawTicker(t)
    this.drawLamps(t)
    this.drawFountain(t)
    this.drawTraffic(t)
    this.stepWalkers(t, dt)
    // People and Nova the cat, back to front; structures in front of a walker are redrawn over it.
    this.drawWalkers(t)
    drawWeatherOverlay(ctx, this.state.weather, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT, t, DISTRICT_IMAGE_HEIGHT * 0.3, 3)
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
    ctx.fillStyle = "rgba(16, 28, 40, 0.72)"
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = "#8aa4b8"
    ctx.fillRect(b.x, b.y, b.w, 1)
    ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1)
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
        draw5(ctx, s.text, x, b.y + 3, s.up ? "#7dffb0" : "#ff7a7a", 1, clip)
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
    this.admitTownsfolk(t)
    for (const w of this.walkers) {
      if (w.appear !== undefined && Number.isNaN(w.appear)) w.appear = t
      // Someone leaving who is already at the door just goes in.
      if (w.leaving && !w.moving && w.fade === undefined) w.fade = t
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
      if (w.kind === "townsfolk" && !w.leaving && t >= w.idleUntil) {
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

  /**
   * Back to front by feet: each figure is painted, then every structure it stands behind is redrawn over it from the
   * painting. Nova the cat takes its place in the same order. Badges go last so a waiting agent's mark stays visible.
   */
  private drawWalkers(t: number): void {
    const list = this.walkers.map((w) => ({ w, ...drawnAt(w) })).sort((a, b) => a.y - b.y)
    let catDrawn = false
    const badges: Array<{ w: Walker; x: number; y: number }> = []
    for (const { w, x, y } of list) {
      if (!catDrawn && y > CAT_SPOT.y) {
        this.drawCat(t)
        catDrawn = true
      }
      const fadeOut = w.fade !== undefined ? Math.max(0, 1 - (t - w.fade) / 2) : 1
      const fadeIn = w.appear === undefined ? 1 : Number.isNaN(w.appear) ? 0 : Math.min(1, Math.max(0, (t - w.appear) / APPEAR_SECONDS))
      const alpha = Math.min(fadeOut, fadeIn)
      this.ctx.globalAlpha = alpha
      if (w.kind === "agent") this.drawAgentAura(x, y, w, t)
      this.paintWalker(x, y, w, t)
      this.ctx.globalAlpha = 1
      this.occludeFigure(x, y)
      if (w.kind === "agent" && w.agent && alpha > 0.2) badges.push({ w, x, y })
    }
    if (!catDrawn) this.drawCat(t)
    for (const b of badges) this.drawAgentBadge(b.x, b.y, b.w, t)
  }

  /** Redraws, from the painting, each structure in front of a figure standing at (x, y), within the figure's box. */
  private occludeFigure(x: number, y: number): void {
    const image = this.image
    if (!image) return
    const ctx = this.ctx
    const bx0 = x - FIGURE_HALF_WIDTH
    const bx1 = x + FIGURE_HALF_WIDTH
    const by0 = y - PERSON_HEIGHT - FIGURE_HEADROOM
    const by1 = y + FIGURE_FOOTROOM
    const sx = image.naturalWidth / DISTRICT_IMAGE_WIDTH
    const sy = image.naturalHeight / DISTRICT_IMAGE_HEIGHT
    for (const o of this.occluders) {
      if (o.x1 < bx0 || o.x0 > bx1 || o.y1 < by0 || o.y0 > by1) continue
      if (y >= baseAt(o.base, x)) continue
      const cx0 = Math.max(bx0, o.x0)
      const cy0 = Math.max(by0, o.y0)
      const cx1 = Math.min(bx1, o.x1)
      const cy1 = Math.min(by1, o.y1)
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx0, cy0, cx1 - cx0, cy1 - cy0)
      ctx.clip()
      ctx.clip(o.path)
      // The same smooth scaling as the full painting; the source box is padded so its edge filtering stays outside the clip.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      const px0 = Math.max(0, cx0 - 4)
      const py0 = Math.max(0, cy0 - 4)
      const pw = Math.min(DISTRICT_IMAGE_WIDTH, cx1 + 4) - px0
      const ph = Math.min(DISTRICT_IMAGE_HEIGHT, cy1 + 4) - py0
      ctx.drawImage(image, px0 * sx, py0 * sy, pw * sx, ph * sy, px0, py0, pw, ph)
      ctx.restore()
    }
  }

  private paintWalker(x: number, y: number, w: Walker, t: number): void {
    const look: PersonLook = w.kind === "agent" && w.agent ? agentLook(w.agent.workplace) : townsfolkLook(w.id)
    drawPerson(this.ctx, x, y, w.dir, w.moving, t, look)
  }

  /** Under an agent: a pulsing cyan ring, and a fading data trail behind it while it walks. */
  private drawAgentAura(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const fade = ctx.globalAlpha
    const trail = w.moving ? (w.trail ?? []) : []
    trail.forEach((p, i) => {
      ctx.globalAlpha = fade * ((i + 1) / trail.length) * 0.35
      ctx.fillStyle = NOVA_CYAN
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2)
    })
    const pulse = (Math.sin(t * 3 + x) + 1) / 2
    ctx.globalAlpha = fade * (0.28 + pulse * 0.2)
    ctx.strokeStyle = NOVA_CYAN
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(x, y - 1, 13, 5, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = fade
  }

  /** A small mark above an agent that is waiting, paused, or failed. Working agents are the visor and the ground glow. */
  private drawAgentBadge(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const a = w.agent
    if (!a || w.moving || w.leaving) return
    if (a.status !== "paused" && a.status !== "failed" && a.status !== "queued") return
    const by = y - PERSON_HEIGHT - 8 + Math.round(Math.sin(t * 2.4 + x) * 1)
    ctx.fillStyle = "#14101c"
    ctx.fillRect(x - 4, by, 9, 9)
    ctx.fillStyle = NOVA_CYAN
    ctx.fillRect(x - 4, by, 9, 1)
    if (a.status === "paused") draw5(ctx, "!", x - 1, by + 2, "#ffc24a")
    else if (a.status === "failed") draw5(ctx, "X", x - 1, by + 2, "#ff6a6a")
    else draw5(ctx, ".", x + 1, by + 2, "#8fd4ff")
  }

  private drawCat(t: number): void {
    const ctx = this.ctx
    // Nova sits on the bench's seat, a little above the spot where the bench stands.
    const x = CAT_SPOT.x
    const y = CAT_SPOT.y - CAT_SEAT_LIFT
    const top = y - CAT_HEIGHT
    const presence = this.state.presence
    // Asleep while Nova is offline; otherwise a short blink every few seconds.
    paintCat(ctx, x, y, presence === "offline" || t % 4.2 < 0.16)
    if (presence === "offline") {
      const z = Math.floor(t * 1.2) % 3
      for (let i = 0; i <= z; i++) draw5(ctx, "Z", x + 8 + i * 5, top - 2 - i * 6, "#e8e4f8")
      return
    }
    if (presence === "thinking" || presence === "speaking") {
      ctx.fillStyle = "#14101c"
      ctx.fillRect(x + 6, top - 8, 12, 8)
      ctx.fillStyle = NOVA_CYAN
      ctx.fillRect(x + 6, top - 8, 12, 1)
      if (presence === "thinking") {
        const dots = 1 + (Math.floor(t * 2.5) % 3)
        ctx.fillStyle = "#e8e4f8"
        for (let i = 0; i < dots; i++) ctx.fillRect(x + 8 + i * 3, top - 4, 2, 2)
      } else {
        ctx.fillStyle = "#ffc24a"
        ctx.fillRect(x + 10, top - 6, 2, 5)
      }
    }
  }

}
