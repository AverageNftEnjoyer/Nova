import type { ResidentId } from "@/lib/town/residents"
import { cellNoise } from "../random"
import {
  EMPTY_CITY_STATE,
  agentResidentId,
  type CityAgent,
  type CityPlaceId,
  type CityRect,
  type CityResidentAnchor,
  type CitySceneHit,
  type CitySceneState,
  type CityWorker,
} from "../types"
import { DISTRICT_PLACES, INTEGRATION_DOOR, WALK_EDGES, WALK_NODES, WORKPLACE_DOOR, WORKPLACE_NAME, type WalkNodeId } from "./image-plan"
import { PERSON_HEIGHT } from "./people"

/**
 * The city's people, without any drawing: one walker per agent task and one worker per connected integration, walking
 * the painted paving (WALK_NODES / WALK_EDGES in image-plan.ts). The PixiJS world reads `walkers` each frame to place
 * sprites; the scene component asks it what is under the pointer. Only real residents exist, so a city with nothing
 * deployed or connected has empty streets.
 */

/** Fade-in of a resident who appears (a new task, a newly connected integration). */
export const APPEAR_SECONDS = 0.8
/** Click box around a figure's feet (plan px), generous so a resident is easy to hit. */
const AGENT_HIT_HALF_WIDTH = 9
const MAX_AGENTS = 12
const MAX_WORKERS = 16
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

// ── Walkers ───────────────────────────────────────────────────────────────────

export interface Walker {
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
export function drawnAt(w: Walker): Point {
  return { x: drawnX(w), y: drawnY(w) }
}
export const drawnX = (w: Walker): number => Math.round(w.x + w.lane * 0.6)
export const drawnY = (w: Walker): number => Math.round(w.y + w.lane * 0.3)

function isHome(a: CityAgent): boolean {
  return a.status === "queued" || a.status === "completed" || a.status === "failed"
}

/** The people of the city; see the file comment. */
export class CitySim {
  private state: CitySceneState = EMPTY_CITY_STATE
  walkers: Walker[] = []
  private lastT = 0
  private seed = 1

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
  clickable(w: Walker): boolean {
    if (w.leaving || w.fade !== undefined) return false
    return w.appear === undefined || this.lastT - w.appear >= APPEAR_SECONDS / 2
  }

  nameOf(w: Walker): string {
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

  detailOf(w: Walker): string {
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
    if (a.status === "queued") return "queued · waiting at U.B Agents HQ"
    if (a.status === "completed") return "completed · back at U.B Agents HQ"
    if (a.status === "failed") return "failed · back at U.B Agents HQ"
    if (w.moving) return `${a.status} · walking to the ${place}`
    return a.status === "paused" ? `paused · at the ${place}` : `running · working at the ${place}`
  }

  /** Advances every walker to time `t` (seconds). */
  step(t: number): void {
    const dt = this.lastT === 0 ? 0 : Math.min(0.25, Math.max(0, t - this.lastT))
    this.lastT = t
    this.stepWalkers(t, dt)
  }

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
}
