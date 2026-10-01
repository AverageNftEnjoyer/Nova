import type { ResidentId } from "@/lib/town/residents"
import { drawWeatherOverlay } from "../effects"
import { draw5, measure5 } from "../font5x7"
import { cellNoise } from "../random"
import {
  EMPTY_CITY_STATE,
  agentResidentId,
  type CityAgent,
  type CityPlaceId,
  type CityRect,
  type CityResidentAnchor,
  type CityWorker,
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
  DISTRICT_SEA_COLOR,
  FOUNTAIN,
  HARBOUR_LANES,
  HQ_FLOORS,
  HQ_PANEL,
  HQ_SIGN,
  INTEGRATION_DOOR,
  NOTICE_FACE,
  TICKER_BOARD,
  WALK_EDGES,
  WALK_NODES,
  WORKPLACE_DOOR,
  WORKPLACE_NAME,
  type PlanPoint,
  type WalkNodeId,
} from "./image-plan"
import { CAT_HEIGHT, PERSON_HEIGHT, agentLook, drawCat as paintCat, drawPerson, loadPeopleArt, type PersonLook } from "./people"

/**
 * The District view: the painted daytime city, brought to life. The image is drawn at its native size and every live
 * element is painted on top in image pixels (the scene component scales the canvas to cover the screen):
 * status badges on the integration buildings, task floors on Nova HQ, the noticeboard's notes, the crypto ticker, the
 * fountain's spray, boats for active deployment runs, and the people from `people.ts`: only real residents (one figure
 * per agent task, one worker per connected integration), so a city with nothing deployed or connected has empty streets.
 */

/** Fade-in of a resident who appears (a new task, a newly connected integration). */
const APPEAR_SECONDS = 0.8
/** Click box around a figure's feet (plan px), generous so a resident is easy to hit. */
const AGENT_HIT_HALF_WIDTH = 9
const MAX_AGENTS = 12
const MAX_WORKERS = 16
const MAX_BOATS = HARBOUR_LANES.length
/** The Nova teal of an agent's visor, ground ring and data trail; a deep tone so it reads on the tan paving. */
const NOVA_CYAN = "#12c9b8"
const NOVA_CYAN_LIGHT = "#7ef6ea"
const INK = "#1b1530"
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
const FIGURE_HALF_WIDTH = 14
const FIGURE_HEADROOM = 5
const FIGURE_FOOTROOM = 4

// ── Walkers ───────────────────────────────────────────────────────────────────

interface Walker {
  kind: "worker" | "agent"
  /** The resident id: `agent:<task id>` or `integration:<key>`. */
  id: ResidentId
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
  /** Workers only: the connected integration this figure works for. */
  worker?: CityWorker
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
  private walkers: Walker[] = []
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
      this.render(performance.now() / 1000)
    }
    img.src = DISTRICT_IMAGE_SRC
    loadPeopleArt()
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
    this.syncWorkers()
  }

  hotspots(): Partial<Record<CityPlaceId, CityRect>> {
    const out: Partial<Record<CityPlaceId, CityRect>> = {}
    for (const place of DISTRICT_PLACES) out[place.id] = place.hit
    return out
  }

  /**
   * What is under plan point (x, y). Residents come first, front-most (lowest on screen) first: a resident always wins,
   * even over a building's button.
   */
  hitTest(x: number, y: number): CitySceneHit | null {
    const people = this.walkers
      .filter((w) => this.clickable(w))
      .map((w) => ({ w, at: drawnAt(w) }))
      .sort((a, b) => b.at.y - a.at.y)
    const over = (at: Point, halfWidth: number) => Math.abs(x - at.x) <= halfWidth && y >= at.y - PERSON_HEIGHT - 4 && y <= at.y + 4
    for (const { w, at } of people) {
      if (!over(at, AGENT_HIT_HALF_WIDTH)) continue
      return { kind: "resident", id: w.id, label: this.nameOf(w), detail: this.detailOf(w), anchorX: at.x, anchorY: at.y - PERSON_HEIGHT - 2 }
    }
    for (let i = DISTRICT_PLACES.length - 1; i >= 0; i--) {
      const r = DISTRICT_PLACES[i].hit
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: "hotspot", id: DISTRICT_PLACES[i].id }
    }
    return null
  }

  /** Every resident on the streets with where they stand now; the scene keeps one focusable button on each. */
  residents(): CityResidentAnchor[] {
    return this.walkers
      .filter((w) => w.kind === "agent" ? !!w.agent : !!w.worker)
      .map((w) => {
        const at = drawnAt(w)
        return { id: w.id, label: `${this.nameOf(w)}, ${w.kind === "agent" ? "agent" : "integration worker"}`, x: at.x, y: at.y, visible: this.clickable(w) }
      })
  }

  /** A resident can be clicked unless it is leaving or still stepping out of a door. */
  private clickable(w: Walker): boolean {
    if (w.leaving || w.fade !== undefined) return false
    return w.appear === undefined || this.lastT - w.appear >= APPEAR_SECONDS / 2
  }

  private nameOf(w: Walker): string {
    return w.agent?.name ?? w.worker?.name ?? "Resident"
  }

  // ── Setup helpers ───────────────────────────────────────────────────────────

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  // ── Workers ─────────────────────────────────────────────────────────────────

  /**
   * One worker per connected integration, at that integration's building. A newly connected integration's worker
   * fades in at its door; a disconnected one fades out where it stands.
   */
  private syncWorkers(): void {
    const wanted = this.state.workers.slice(0, MAX_WORKERS)
    const byId = new Map(wanted.map((worker) => [worker.id, worker]))
    for (const w of this.walkers) {
      if (w.kind !== "worker" || !w.worker) continue
      const next = byId.get(w.id)
      if (!next) {
        if (!w.leaving) {
          w.leaving = true
          w.moving = false
        }
        continue
      }
      w.worker = next
    }
    const present = new Set(this.walkers.filter((w) => w.kind === "worker" && !w.leaving).map((w) => w.id))
    wanted.forEach((worker, i) => {
      if (present.has(worker.id)) return
      const door = INTEGRATION_DOOR[worker.integration]
      const start = pointOf(door)
      this.walkers.push({
        kind: "worker",
        id: worker.id,
        node: door,
        path: [start],
        seg: 0,
        segT: 0,
        speed: 9 + cellNoise(i, 1, 91) * 5,
        idleUntil: 4 + cellNoise(i, 2, 91) * 12,
        x: start.x,
        y: start.y,
        lane: ((i % 5) - 2) * 3,
        moving: false,
        dir: 0,
        worker,
        appear: Number.NaN,
      })
    })
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
        id: agentResidentId(agent.id),
        node: WORKPLACE_DOOR.hq,
        path: [start],
        seg: 0,
        segT: 0,
        speed: 13,
        idleUntil: 0,
        x: start.x,
        y: start.y,
        lane: ((i % 5) - 2) * 3,
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

  private detailOf(w: Walker): string {
    const worker = w.worker
    if (worker) {
      const place = WORKPLACE_NAME[worker.workplace]
      return w.moving ? `connected · walking near the ${place}` : `connected · working at the ${place}`
    }
    return this.agentDetail(w)
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
    // The sea continues past the painting's edges, so zooming out or panning shows open water, never a hole.
    ctx.fillStyle = DISTRICT_SEA_COLOR
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(this.k, 0, 0, this.k, -this.camX * this.k, -this.camY * this.k)
    if (!this.ready || !this.image) return
    // The painting is scaled smoothly (from its full source resolution); sprites and signs stay pixel-sharp.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(this.image, 0, 0, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT)
    ctx.imageSmoothingEnabled = false
    this.drawBadges(t)
    this.drawHq(t)
    this.drawNotices()
    this.drawTicker(t)
    this.drawFountain(t)
    this.drawBoats(t)
    this.stepWalkers(t, dt)
    // People and Nova the cat, back to front; structures in front of a walker are redrawn over it.
    this.drawWalkers(t)
    drawWeatherOverlay(ctx, this.state.weather, DISTRICT_IMAGE_WIDTH, DISTRICT_IMAGE_HEIGHT, t, DISTRICT_IMAGE_HEIGHT * 0.3, 1.5)
  }

  /**
   * A small lamp on every integration building: lit green while the integration is connected, a dark grey socket while
   * it is not. Hard pixel border so it reads on the bright painting; the connection flag is the only data it shows.
   */
  private drawBadges(t: number): void {
    const ctx = this.ctx
    const connected = new Set(this.state.connectedIntegrations)
    for (const place of DISTRICT_PLACES) {
      const sign = place.signs[0]
      if (!sign || !place.integration) continue
      const on = connected.has(place.integration)
      ctx.fillStyle = INK
      ctx.fillRect(sign.x, sign.y, sign.w, sign.h)
      ctx.fillStyle = on ? "#3fe27a" : "#6c6a7c"
      ctx.fillRect(sign.x + 1, sign.y + 1, sign.w - 2, sign.h - 2)
      if (on) {
        ctx.fillStyle = "#d6ffe4"
        ctx.fillRect(sign.x + 2, sign.y + 2, 2, 2)
        // A connected lamp breathes: a soft halo outside the border.
        ctx.globalAlpha = 0.12 + 0.1 * (Math.sin(t * 2 + sign.x) + 1) / 2
        ctx.fillStyle = "#3fe27a"
        ctx.fillRect(sign.x - 2, sign.y - 2, sign.w + 4, sign.h + 4)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = "#3d3b4c"
        ctx.fillRect(sign.x + 3, sign.y + 3, sign.w - 6, sign.h - 6)
      }
    }
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
    // The gate's round window glows while any agent is working.
    if (lights.includes("running")) {
      ctx.globalAlpha = 0.14 + 0.12 * (Math.sin(t * 2.2) + 1) / 2
      ctx.fillStyle = NOVA_CYAN_LIGHT
      ctx.beginPath()
      ctx.ellipse(HQ_SIGN.x + HQ_SIGN.w / 2, HQ_SIGN.y + HQ_SIGN.h / 2, HQ_SIGN.w / 2, HQ_SIGN.h / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (lights.length === 0) return
    // Task floors: a dark panel with one lamp per task, top floor first.
    const p = HQ_PANEL
    ctx.fillStyle = INK
    ctx.fillRect(p.x, p.y, p.w, p.h)
    ctx.fillStyle = "#4a4468"
    ctx.fillRect(p.x + 1, p.y + 1, p.w - 2, 1)
    HQ_FLOORS.forEach((r, i) => {
      const light = lights[i]
      ctx.fillStyle = "#2c2742"
      ctx.fillRect(r.x, r.y, r.w, r.h)
      if (!light) return
      ctx.fillStyle = this.taskColor(light, t, i)
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    })
  }

  /** A small cork board on two posts: one paper per note (up to six). Always drawn, empty when there are no notes. */
  private drawNotices(): void {
    const ctx = this.ctx
    const f = NOTICE_FACE
    ctx.fillStyle = "rgba(20, 30, 50, 0.3)"
    ctx.fillRect(f.x + 1, f.y + f.h + 5, f.w, 2)
    ctx.fillStyle = "#5a3a1e"
    ctx.fillRect(f.x + 3, f.y + f.h - 1, 2, 6)
    ctx.fillRect(f.x + f.w - 5, f.y + f.h - 1, 2, 6)
    ctx.fillStyle = INK
    ctx.fillRect(f.x - 1, f.y - 1, f.w + 2, f.h + 2)
    ctx.fillStyle = "#c8985a"
    ctx.fillRect(f.x, f.y, f.w, f.h)
    ctx.fillStyle = "#e0b87a"
    ctx.fillRect(f.x, f.y, f.w, 1)
    const count = Math.min(6, Math.max(0, this.state.notesCount))
    for (let i = 0; i < count; i++) {
      const x = f.x + 2 + (i % 3) * 10
      const y = f.y + 2 + Math.floor(i / 3) * 9
      ctx.fillStyle = "#fbf6e4"
      ctx.fillRect(x, y, 8, 7)
      ctx.fillStyle = "#8a8070"
      ctx.fillRect(x + 1, y + 3, 6, 1)
      ctx.fillRect(x + 1, y + 5, 4, 1)
      ctx.fillStyle = "#e03a3a"
      ctx.fillRect(x + 3, y, 2, 2)
    }
  }

  private drawTicker(t: number): void {
    const ctx = this.ctx
    const b = TICKER_BOARD
    ctx.fillStyle = INK
    ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2)
    ctx.fillStyle = "#101c28"
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
        draw5(ctx, s.text, x, b.y + 3, s.up ? "#7dffb0" : "#ff7a7a", 1, clip)
        x += measure5(s.text) + gap
      }
    }
  }

  private drawFountain(t: number): void {
    const ctx = this.ctx
    // A light spray rises from the fountain's spout and falls back into its basin in a loop.
    for (let i = 0; i < 14; i++) {
      const phase = (t * 0.9 + cellNoise(i, 0, 61)) % 1
      const side = cellNoise(i, 1, 61) * 2 - 1
      const x = FOUNTAIN.x + side * 9 * phase
      const y = FOUNTAIN.y - 14 * Math.sin(phase * Math.PI) + phase * (FOUNTAIN.basinY - FOUNTAIN.y)
      ctx.fillStyle = i % 3 === 0 ? "#ffffff" : "#bff0ff"
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
    }
  }

  /** One boat per active deployment run, sailing back and forth along its sea lane in the bay (capped by the lanes). */
  private drawBoats(t: number): void {
    const boats = Math.min(MAX_BOATS, Math.max(0, Math.floor(this.state.activeRuns)))
    const hulls = ["#e0452e", "#2f7fe0", "#f2b21c"]
    const sails = ["#fff4d6", "#ffd24a", "#ff7a4a"]
    for (let i = 0; i < boats; i++) {
      const [[x0, y0], [x1, y1]] = HARBOUR_LANES[i] as ReadonlyArray<readonly [number, number]>
      // Triangle wave 0 -> 1 -> 0: out and back along the lane, slowly.
      const cycle = (t * 0.012 + i * 0.37) % 1
      const p = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2
      const east = cycle < 0.5 ? x1 >= x0 : x1 < x0
      const x = Math.round(x0 + (x1 - x0) * p)
      const y = Math.round(y0 + (y1 - y0) * p + Math.sin(t * 1.6 + i) * 1)
      this.drawBoat(x, y, east ? 1 : -1, hulls[i % hulls.length], sails[i % sails.length])
    }
  }

  /** A little sailboat seen from the isometric camera: hull, mast, sail and a wake, on a 2 px grid, facing `dir`. */
  private drawBoat(cx: number, cy: number, dir: 1 | -1, hull: string, sail: string): void {
    const ctx = this.ctx
    const U = 2
    const px = (dx: number, dy: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(cx + (dir === 1 ? dx * U : -(dx + w) * U), cy + dy * U, w * U, h * U)
    }
    // Wake on the water, behind the stern.
    ctx.globalAlpha = 0.6
    px(-16, 2, 9, 1, "#e8fbff")
    px(-13, 3, 7, 1, "#e8fbff")
    ctx.globalAlpha = 1
    px(-9, 0, 18, 1, INK)
    px(-8, 1, 16, 2, hull)
    px(-8, 1, 16, 1, "#ffffff")
    px(-7, 3, 13, 1, INK)
    px(7, -1, 3, 1, hull)
    // Mast, sail and pennant.
    px(-1, -14, 1, 14, INK)
    for (let r = 0; r < 11; r++) px(0, -12 + r, 1 + Math.floor(r * 0.7), 1, sail)
    px(-1, -15, 3, 1, "#e03a3a")
  }

  // ── People ──────────────────────────────────────────────────────────────────

  private stepWalkers(t: number, dt: number): void {
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
          if (!last || Math.hypot(last.x - w.x, last.y - w.y) >= 2) w.trail.push({ x: w.x, y: w.y })
          if (w.trail.length > TRAIL_LENGTH) w.trail.shift()
        }
        if (w.seg >= w.path.length - 1) {
          w.moving = false
          w.dir = 0
          w.idleUntil = t + 18 + this.rand() * 20
          if (w.leaving) w.fade = t
        }
        continue
      }
      if (w.kind === "worker" && w.worker && !w.leaving && t >= w.idleUntil) {
        // A worker now and then steps to a neighbouring spot by its building and back.
        const door = INTEGRATION_DOOR[w.worker.integration]
        const around = ADJ.get(door) ?? [door]
        const next = w.node === door ? around[Math.floor(this.rand() * around.length)] : door
        this.sendTo(w, next)
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
    const look: PersonLook = w.worker ? agentLook(w.worker.workplace) : agentLook(w.agent?.workplace ?? "hq")
    drawPerson(this.ctx, x, y, w.dir, w.moving, t, look)
  }

  /** Under an agent: a pulsing cyan ring, and a fading data trail behind it while it walks. */
  private drawAgentAura(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const fade = ctx.globalAlpha
    const trail = w.moving ? (w.trail ?? []) : []
    trail.forEach((p, i) => {
      ctx.globalAlpha = fade * ((i + 1) / trail.length) * 0.6
      ctx.fillStyle = NOVA_CYAN
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1)
    })
    const pulse = (Math.sin(t * 3 + x) + 1) / 2
    ctx.globalAlpha = fade * (0.28 + pulse * 0.2)
    ctx.strokeStyle = NOVA_CYAN
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.ellipse(x, y - 1, 7, 3, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = fade
  }

  /** A small mark above an agent that is waiting, paused, or failed. Working agents are the visor and the ground glow. */
  private drawAgentBadge(x: number, y: number, w: Walker, t: number): void {
    const ctx = this.ctx
    const a = w.agent
    if (!a || w.moving || w.leaving) return
    if (a.status !== "paused" && a.status !== "failed" && a.status !== "queued") return
    const by = y - PERSON_HEIGHT - 10 + Math.round(Math.sin(t * 2.4 + x) * 1)
    ctx.fillStyle = INK
    ctx.fillRect(x - 5, by - 1, 11, 11)
    ctx.fillStyle = "#2b2547"
    ctx.fillRect(x - 4, by, 9, 9)
    ctx.fillStyle = NOVA_CYAN
    ctx.fillRect(x - 4, by, 9, 1)
    if (a.status === "paused") draw5(ctx, "!", x - 1, by + 2, "#ffc24a")
    else if (a.status === "failed") draw5(ctx, "X", x - 1, by + 2, "#ff6a6a")
    else draw5(ctx, ".", x + 1, by + 2, "#8fd4ff")
  }

  private drawCat(t: number): void {
    const ctx = this.ctx
    // Nova sits on the paving beside the fountain.
    const x = CAT_SPOT.x
    const y = CAT_SPOT.y
    const top = y - CAT_HEIGHT
    const presence = this.state.presence
    // Asleep while Nova is offline; otherwise a short blink every few seconds.
    paintCat(ctx, x, y, presence === "offline" || t % 4.2 < 0.16)
    if (presence === "offline") {
      const z = Math.floor(t * 1.2) % 3
      for (let i = 0; i <= z; i++) draw5(ctx, "Z", x + 5 + i * 5, top - 2 - i * 6, INK)
      return
    }
    if (presence === "thinking" || presence === "speaking") {
      ctx.fillStyle = INK
      ctx.fillRect(x + 4, top - 9, 14, 9)
      ctx.fillStyle = "#2b2547"
      ctx.fillRect(x + 5, top - 8, 12, 7)
      if (presence === "thinking") {
        const dots = 1 + (Math.floor(t * 2.5) % 3)
        ctx.fillStyle = "#e8e4f8"
        for (let i = 0; i < dots; i++) ctx.fillRect(x + 7 + i * 3, top - 5, 2, 2)
      } else {
        ctx.fillStyle = "#ffc24a"
        ctx.fillRect(x + 10, top - 7, 2, 5)
      }
    }
  }

}
