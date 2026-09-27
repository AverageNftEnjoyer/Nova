import { ditherBands, drawWeatherOverlay } from "./effects"
import { drawPixelText, measureText } from "./font"
import { buildCityLayout, type CityLayout, type Tower } from "./layout"
import { paletteFor, type CityPalette } from "./palette"
import { cellNoise } from "./random"
import { CAT_ASLEEP, CAT_SITTING, PIGEON, PIGEON_PECK, drawSprite } from "./sprites"
import { EMPTY_CITY_STATE, type CityHotspotId, type CityRect, type CitySceneHit, type CitySceneRenderer, type CitySceneState, type CityTaskLight } from "./types"

/** The whole scene repeats on this loop, like the reference: boats, tram and the light show all share it. */
export const CITY_LOOP_SECONDS = 240
const LIGHT_SHOW_START = 150
const LIGHT_SHOW_END = 196
/** Windows re-roll their lit state this often, so the skyline breathes without flickering. */
const WINDOW_BUCKET_SECONDS = 6
const MAX_FERRIES = 3
const MAX_NOTES = 6

function createLayer(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

function layerContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D is unavailable")
  ctx.imageSmoothingEnabled = false
  return ctx
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  let ax = Math.round(x0)
  let ay = Math.round(y0)
  const bx = Math.round(x1)
  const by = Math.round(y1)
  const dx = Math.abs(bx - ax)
  const dy = -Math.abs(by - ay)
  const sx = ax < bx ? 1 : -1
  const sy = ay < by ? 1 : -1
  let err = dx + dy
  ctx.fillStyle = color
  for (let guard = 0; guard < 4096; guard++) {
    ctx.fillRect(ax, ay, 1, 1)
    if (ax === bx && ay === by) return
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      ax += sx
    }
    if (e2 <= dx) {
      err += dx
      ay += sy
    }
  }
}

function pingPong(t: number): number {
  const m = t % 2
  return m < 1 ? m : 2 - m
}

function taskLightColor(p: CityPalette, light: CityTaskLight, t: number, index: number): string {
  switch (light) {
    case "running":
      return Math.floor(t * 3 + index) % 2 === 0 ? p.neonCyan : p.windowWarm[2]
    case "queued":
      return p.windowCool
    case "paused":
      return Math.floor(t * 1.5) % 2 === 0 ? p.ledAmber : p.windowDark
    case "failed":
      return p.ledRed
    case "completed":
      return p.ledGreen
  }
}

export class CityRenderer implements CitySceneRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private layout: CityLayout | null = null
  private palette: CityPalette = paletteFor("night")
  private state: CitySceneState = EMPTY_CITY_STATE
  private cityKey = ""
  private sky: HTMLCanvasElement | null = null
  private ridge: HTMLCanvasElement | null = null
  private towers: HTMLCanvasElement | null = null
  private front: HTMLCanvasElement | null = null
  private beacons: Array<{ x: number; y: number }> = []
  private windowBucket = -1
  private frontDirty = true

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = layerContext(canvas)
  }

  hotspots(): Partial<Record<CityHotspotId, CityRect>> {
    return this.layout?.hotspots ?? {}
  }

  hitTest(x: number, y: number): CitySceneHit | null {
    const spots = this.layout?.hotspots
    if (!spots) return null
    for (const [id, r] of Object.entries(spots) as Array<[CityHotspotId, CityRect]>) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: "hotspot", id }
    }
    return null
  }

  resize(width: number, height: number, cityKey: string): void {
    const w = Math.max(160, Math.round(width))
    const h = Math.max(120, Math.round(height))
    if (this.layout && this.layout.width === w && this.layout.height === h && this.cityKey === cityKey) return
    this.canvas.width = w
    this.canvas.height = h
    this.ctx.imageSmoothingEnabled = false
    this.cityKey = cityKey
    this.layout = buildCityLayout(w, h, cityKey)
    this.sky = createLayer(w, h)
    this.ridge = createLayer(w, h)
    this.towers = createLayer(w, h)
    this.front = createLayer(w, h)
    this.bakeAll()
  }

  setState(next: CitySceneState): void {
    const timeChanged = next.timeOfDay !== this.state.timeOfDay
    this.state = next
    if (timeChanged) {
      this.palette = paletteFor(next.timeOfDay)
      this.bakeAll()
    }
  }

  private bakeAll(): void {
    if (!this.layout) return
    this.bakeSky()
    this.bakeRidge()
    this.windowBucket = -1
    this.frontDirty = true
  }

  // ── Static layers ─────────────────────────────────────────────────────────

  private bakeSky(): void {
    const L = this.layout
    if (!L || !this.sky) return
    const p = this.palette
    const ctx = layerContext(this.sky)
    ctx.clearRect(0, 0, L.width, L.height)
    ditherBands(ctx, p.sky, 0, 0, L.width, L.horizonY)
    ditherBands(ctx, p.water, 0, L.horizonY, L.width, L.height)
    // Moon by night, sun by day, both in the upper right third.
    const cx = Math.round(L.width * 0.7)
    const cy = Math.round(L.height * 0.14)
    const r = this.state.timeOfDay === "day" ? 7 : 6
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue
        const crater = this.state.timeOfDay === "night" && cellNoise(x, y, 7) < 0.12
        rect(ctx, cx + x, cy + y, 1, 1, crater ? "#e6dcaa" : p.moon)
      }
    }
    if (this.state.timeOfDay === "day") {
      ctx.globalAlpha = 0.25
      for (let ring = r + 2; ring <= r + 4; ring += 2) {
        for (let a = 0; a < 32; a++) {
          const ang = (a / 32) * Math.PI * 2
          rect(ctx, cx + Math.cos(ang) * ring, cy + Math.sin(ang) * ring, 1, 1, p.moon)
        }
      }
      ctx.globalAlpha = 1
    }
  }

  private bakeRidge(): void {
    const L = this.layout
    if (!L || !this.ridge) return
    const p = this.palette
    const ctx = layerContext(this.ridge)
    ctx.clearRect(0, 0, L.width, L.height)
    for (let x = 0; x < L.width; x++) {
      const top = L.ridge[x]
      rect(ctx, x, top, 1, L.horizonY - top, p.ridge)
      rect(ctx, x, top, 1, 1, p.ridgeLight)
      // Scattered hillside homes.
      if (this.state.timeOfDay === "night") {
        for (let y = top + 4; y < L.horizonY - 2; y += 5) {
          if (cellNoise(x, y, 31) < 0.035) rect(ctx, x, y, 1, 1, p.windowWarm[0])
        }
      }
    }
    // Tram track: a dotted line up the slope with a station at the top.
    const { x0, y0, x1, y1 } = L.tram
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= steps; i += 2) {
      rect(ctx, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps + 1, 1, 1, p.ridgeLight)
    }
    rect(ctx, x1 - 3, y1 - 4, 7, 4, p.towerNear[0])
    rect(ctx, x1 - 2, y1 - 3, 5, 1, this.state.timeOfDay === "night" ? p.windowWarm[1] : p.windowCool)
  }

  private bakeTowers(bucket: number): void {
    const L = this.layout
    if (!L || !this.towers) return
    const ctx = layerContext(this.towers)
    ctx.clearRect(0, 0, L.width, L.height)
    this.beacons = []
    const ordered = [...L.towers].sort((a, b) => a.layer - b.layer || Number(a.landmark) - Number(b.landmark))
    for (const tower of ordered) this.drawTower(ctx, tower, bucket)
  }

  private drawTower(ctx: CanvasRenderingContext2D, t: Tower, bucket: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const night = this.state.timeOfDay === "night"
    const body = t.layer === 0 ? p.towerFar[t.shade] : p.towerNear[t.shade]
    const base = L.horizonY
    rect(ctx, t.x, t.top, t.w, base - t.top, body)
    if (t.layer === 1) rect(ctx, t.x, t.top, 1, base - t.top, p.towerEdge)

    // Windows: lit state is a stable hash per window, re-rolled for a few windows each bucket.
    for (let wy = t.top + 3; wy < base - 1; wy += t.pitchY) {
      for (let wx = t.x + 1 + (t.layer === 1 ? 1 : 0); wx < t.x + t.w - 1; wx += t.pitchX) {
        const stable = cellNoise(wx, wy, t.seed)
        const flicker = cellNoise(wx, wy, t.seed + bucket) < 0.04
        const lit = night ? stable < t.litChance !== flicker : stable < 0.55
        if (!lit) {
          if (!night) continue
          if (t.layer === 1) rect(ctx, wx, wy, 1, 1, p.windowDark)
          continue
        }
        const color = t.coolWindows ? p.windowCool : p.windowWarm[Math.floor(stable * 97) % p.windowWarm.length]
        ctx.globalAlpha = t.layer === 0 ? 0.7 : 1
        rect(ctx, wx, wy, 1, 1, color)
        ctx.globalAlpha = 1
      }
    }

    const cx = t.x + Math.floor(t.w / 2)
    switch (t.crown) {
      case "flat":
        rect(ctx, t.x, t.top, t.w, 1, p.towerEdge)
        break
      case "stepped":
        rect(ctx, t.x + 2, t.top - 3, t.w - 4, 3, body)
        rect(ctx, t.x + 4, t.top - 5, Math.max(1, t.w - 8), 2, body)
        break
      case "antenna":
        rect(ctx, cx, t.top - 7, 1, 7, p.metal)
        this.beacons.push({ x: cx, y: t.top - 8 })
        break
      case "spire": {
        const rise = Math.round(t.w * 0.9)
        for (let i = 0; i < rise; i++) {
          const half = Math.max(0, Math.round((t.w / 2) * (1 - i / rise)))
          rect(ctx, cx - half, t.top - i, half * 2 + 1, 1, body)
        }
        rect(ctx, cx, t.top - rise - 8, 1, 8, p.metal)
        this.beacons.push({ x: cx, y: t.top - rise - 9 })
        break
      }
      case "crown": {
        // Crowned tower: setbacks topped by vertical fins.
        rect(ctx, t.x + 2, t.top - 4, t.w - 4, 4, body)
        rect(ctx, t.x + 3, t.top - 8, t.w - 6, 4, body)
        for (let fx = t.x + 3; fx < t.x + t.w - 3; fx += 2) rect(ctx, fx, t.top - 11, 1, 3, p.towerEdge)
        if (night) rect(ctx, t.x + 3, t.top - 8, t.w - 6, 1, p.windowCool)
        break
      }
      case "lattice": {
        // Lattice tower: triangular facets and twin masts.
        for (let y = t.top + 2; y < base - 4; y += t.w) {
          line(ctx, t.x, y, t.x + t.w - 1, y + t.w - 1, p.towerEdge)
          line(ctx, t.x + t.w - 1, y, t.x, y + t.w - 1, p.towerEdge)
        }
        for (let i = 0; i < t.w; i++) rect(ctx, t.x + i, t.top - Math.round(i * 0.6), 1, Math.round(i * 0.6) + 1, body)
        rect(ctx, t.x + t.w - 3, t.top - Math.round(t.w * 0.6) - 9, 1, 9, p.metal)
        rect(ctx, t.x + t.w - 1, t.top - Math.round(t.w * 0.6) - 6, 1, 6, p.metal)
        this.beacons.push({ x: t.x + t.w - 3, y: t.top - Math.round(t.w * 0.6) - 10 })
        break
      }
    }
    if (t === L.taskTower) {
      // Task tower: a lit band marks the five task floors.
      rect(ctx, t.x + 1, L.taskFloors[0].y - 2, t.w - 2, 1, p.towerEdge)
      rect(ctx, t.x + 1, L.taskFloors[4].y + 4, t.w - 2, 1, p.towerEdge)
    }
  }

  private bakeFront(): void {
    const L = this.layout
    if (!L || !this.front) return
    const p = this.palette
    const night = this.state.timeOfDay === "night"
    const ctx = layerContext(this.front)
    ctx.clearRect(0, 0, L.width, L.height)

    // Tenement: facade, window rows with curtains, balcony rails and a rooftop parapet.
    const T = L.tenement
    rect(ctx, T.x, T.y, T.w, T.h, p.wall)
    rect(ctx, T.x, T.y, 2, T.h, p.wallDark)
    rect(ctx, T.x - 1, T.y - 2, T.w + 1, 2, p.roofEdge)
    // Brick texture, then floors: each window is framed, some lit with a curtain or a TV glow, some with a
    // balcony rail or a plant on the sill.
    for (let by = T.y + 2; by < T.y + T.h; by += 3) {
      for (let bx = T.x + 3 + ((by / 3) % 2) * 3; bx < T.x + T.w; bx += 6) {
        if (cellNoise(bx, by, 17) < 0.35) rect(ctx, bx, by, 2, 1, p.wallDark)
      }
    }
    for (let wy = T.y + 30, floor = 0; wy < T.y + T.h - 6; wy += 17, floor++) {
      rect(ctx, T.x + 2, wy - 3, T.w - 2, 1, p.wallDark)
      for (let wx = T.x + 6; wx + 8 < T.x + T.w - 2; wx += 14) {
        const n = cellNoise(wx, wy, 5)
        const lit = n < (night ? 0.55 : 0.2)
        rect(ctx, wx - 1, wy - 1, 9, 11, p.metalDark)
        const glass = !lit ? p.roofDark : n < 0.12 ? p.windowCool : n < 0.24 ? p.cloth[0] : p.wallWindow
        rect(ctx, wx, wy, 7, 9, glass)
        rect(ctx, wx + 3, wy, 1, 9, p.metalDark)
        if (lit && night) {
          rect(ctx, wx, wy, 2, 9, p.windowWarm[n < 0.4 ? 1 : 0])
          rect(ctx, wx, wy, 7, 1, p.windowWarm[2])
        }
        if (cellNoise(wx, wy, 6) < 0.3) {
          // Balcony rail.
          rect(ctx, wx - 2, wy + 6, 11, 1, p.metal)
          for (let rx = wx - 2; rx < wx + 9; rx += 2) rect(ctx, rx, wy + 7, 1, 3, p.metal)
        } else if (cellNoise(wx, wy, 7) < 0.35) {
          rect(ctx, wx + 1, wy + 7, 5, 2, night ? "#1f4a33" : "#3f8a55")
        }
        rect(ctx, wx - 1, wy + 10, 9, 1, p.roofEdge)
      }
    }
    // Billboard frame (the ticker is drawn live).
    const B = L.billboard
    rect(ctx, B.x - 1, B.y - 1, B.w + 2, B.h + 2, p.metalDark)
    rect(ctx, B.x, B.y, B.w, B.h, p.screen)
    rect(ctx, B.x + 3, B.y + B.h + 1, 1, 4, p.metalDark)
    rect(ctx, B.x + B.w - 4, B.y + B.h + 1, 1, 4, p.metalDark)
    // Clock tower on the tenement roof.
    const C = L.clock
    rect(ctx, C.cx - C.r - 2, C.cy - C.r - 2, C.r * 2 + 5, C.r * 2 + 12, p.wallDark)
    rect(ctx, C.cx - C.r - 3, C.cy - C.r - 4, C.r * 2 + 7, 2, p.roofEdge)
    for (let y = -C.r; y <= C.r; y++) {
      for (let x = -C.r; x <= C.r; x++) {
        const d = x * x + y * y
        if (d > C.r * C.r) continue
        rect(ctx, C.cx + x, C.cy + y, 1, 1, d > (C.r - 1) * (C.r - 1) ? p.metal : p.paper)
      }
    }
    // Neon sign bracket.
    const N = L.neon
    rect(ctx, N.x, N.y - 2, N.w + 1, 1, p.metalDark)
    rect(ctx, N.x, N.y, N.w, N.h, p.roofDark)
    // AC units.
    for (const ac of L.acUnits) {
      rect(ctx, ac.x, ac.y, 11, 7, p.metal)
      rect(ctx, ac.x, ac.y + 6, 11, 1, p.metalDark)
      for (let i = 0; i < 3; i++) rect(ctx, ac.x + 2 + i * 3, ac.y + 2, 2, 3, p.metalDark)
    }

    // Our rooftop: parapet ledge and floor.
    rect(ctx, 0, L.ledgeY, T.x, L.height - L.ledgeY, p.roof)
    rect(ctx, 0, L.ledgeY, T.x, 2, p.roofEdge)
    rect(ctx, 0, L.ledgeY + 2, T.x, 1, p.roofDark)
    for (let x = 6; x < T.x; x += 14) rect(ctx, x, L.ledgeY + 3, 1, L.height - L.ledgeY, p.roofDark)

    // Laundry poles: bamboo from the left edge, with a stand.
    const Ld = L.laundry
    rect(ctx, Ld.x0, Ld.y, Ld.x1 - Ld.x0, 1, p.bamboo)
    rect(ctx, Ld.x0, Ld.y + 12, Ld.x1 - Ld.x0 - 6, 1, p.bamboo)
    rect(ctx, Ld.x1 - 1, Ld.y - 1, 2, L.ledgeY - Ld.y + 1, p.bamboo)

    // Rooftop cinema screen on legs (YouTube).
    const S = L.cinema
    rect(ctx, S.x - 2, S.y - 2, S.w + 4, S.h + 4, p.metalDark)
    rect(ctx, S.x + 2, S.y + S.h + 2, 1, L.ledgeY - S.y - S.h - 2, p.metalDark)
    rect(ctx, S.x + S.w - 3, S.y + S.h + 2, 1, L.ledgeY - S.y - S.h - 2, p.metalDark)

    // Water tank on stilts (analytics meter lives on its face).
    const K = L.tank
    rect(ctx, K.x, K.y, K.w, K.h, p.metal)
    rect(ctx, K.x, K.y, 2, K.h, p.metalDark)
    rect(ctx, K.x - 1, K.y - 2, K.w + 2, 2, p.metalDark)
    for (let y = K.y + 5; y < K.y + K.h; y += 6) rect(ctx, K.x, y, K.w, 1, p.metalDark)
    rect(ctx, K.x + 2, K.y + K.h, 1, L.ledgeY - K.y - K.h, p.metalDark)
    rect(ctx, K.x + K.w - 3, K.y + K.h, 1, L.ledgeY - K.y - K.h, p.metalDark)
    rect(ctx, K.x + 1, K.y + 7, K.w - 2, 8, p.screen)

    // Antenna array (integrations): masts, cross bars and a dish.
    const A = L.antennas
    const masts = 5
    for (let i = 0; i < masts; i++) {
      const mx = A.x + 2 + Math.round((i * (A.w - 5)) / (masts - 1))
      const top = A.y + (i % 2 === 0 ? 0 : 8) + (i === 2 ? -2 : 0)
      rect(ctx, mx, top, 1, L.ledgeY - top, p.metal)
      rect(ctx, mx - 2, top + 3, 5, 1, p.metal)
      rect(ctx, mx - 1, top + 7, 3, 1, p.metal)
    }
    const dx = A.x + A.w - 6
    const dy = L.ledgeY - 10
    for (let i = 0; i < 6; i++) rect(ctx, dx + Math.floor(i / 2), dy + i, 6 - i, 1, p.metal)
    rect(ctx, dx + 2, dy + 6, 1, 4, p.metalDark)

    // Festoon string (the bulbs are drawn live).
    const F = L.festoon
    for (let i = 0; i <= 64; i++) {
      const f = i / 64
      rect(ctx, F.x0 + (F.x1 - F.x0) * f, F.y0 + (F.y1 - F.y0) * f + Math.sin(f * Math.PI) * F.sag, 1, 1, p.metalDark)
    }

    // Overhead wire to the tenement (pigeons perch on it).
    const W = L.wire
    line(ctx, W.x0, W.y0, W.x1, W.y1, p.metalDark)

    // Potted plants along the ledge.
    for (const px of [Math.round(L.width * 0.33), Math.round(L.width * 0.47)]) {
      rect(ctx, px, L.ledgeY - 4, 5, 4, p.wallDark)
      rect(ctx, px - 1, L.ledgeY - 8, 7, 4, night ? "#1f4a33" : "#3f8a55")
      rect(ctx, px + 1, L.ledgeY - 10, 3, 2, night ? "#2a5e42" : "#56a86a")
    }
    this.frontDirty = false
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  render(timeSeconds: number): void {
    const L = this.layout
    if (!L || !this.sky || !this.ridge || !this.towers || !this.front) return
    const p = this.palette
    const s = this.state
    const ctx = this.ctx
    const night = s.timeOfDay === "night"
    const t = timeSeconds
    const loopT = t % CITY_LOOP_SECONDS

    const bucket = Math.floor(t / WINDOW_BUCKET_SECONDS)
    if (bucket !== this.windowBucket) {
      this.bakeTowers(bucket)
      this.windowBucket = bucket
    }
    if (this.frontDirty) this.bakeFront()

    ctx.clearRect(0, 0, L.width, L.height)
    ctx.drawImage(this.sky, 0, 0)

    if (night) {
      for (const star of L.stars) {
        const tw = Math.sin(t * 1.3 + star.phase * 40)
        if (tw < -0.35) continue
        ctx.globalAlpha = tw > 0.7 ? 1 : 0.55
        rect(ctx, star.x, star.y, 1, 1, p.star)
      }
      ctx.globalAlpha = 1
    }
    this.drawClouds(t)
    if (night && loopT >= LIGHT_SHOW_START && loopT < LIGHT_SHOW_END) this.drawLightShow(loopT - LIGHT_SHOW_START)

    ctx.drawImage(this.ridge, 0, 0)
    // Peak tram climbs and descends once per loop.
    const tp = pingPong(loopT / (CITY_LOOP_SECONDS / 2))
    const tx = L.tram.x0 + (L.tram.x1 - L.tram.x0) * tp
    const ty = L.tram.y0 + (L.tram.y1 - L.tram.y0) * tp
    rect(ctx, tx - 2, ty - 2, 5, 3, p.tram)
    rect(ctx, tx - 1, ty - 2, 3, 1, night ? p.windowWarm[2] : p.ferryDeck)

    ctx.drawImage(this.towers, 0, 0)
    if (night) {
      const on = Math.floor(t * 1.2) % 2 === 0
      for (const b of this.beacons) if (on) rect(ctx, b.x, b.y, 1, 1, p.beacon)
    }
    this.drawTaskFloors(t)
    this.drawWater(t)
    this.drawPier(t)
    this.drawBoats(loopT)

    ctx.drawImage(this.front, 0, 0)
    this.drawTicker(t)
    this.drawNeon(t)
    this.drawClock()
    this.drawCinema(t)
    this.drawTankMeter(t)
    this.drawAntennaLeds(t)
    this.drawLaundry(t)
    this.drawFestoon(t)
    this.drawDrips(t)
    this.drawPigeons(t)
    this.drawCat(t)
    this.drawWeather(t)
  }

  private drawClouds(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const overcast = this.state.weather !== "clear"
    const alpha = this.state.timeOfDay === "night" ? (overcast ? 0.85 : 0.55) : overcast ? 0.95 : 0.85
    this.ctx.globalAlpha = alpha
    const clouds = overcast ? L.clouds : L.clouds.slice(0, 2)
    for (const c of clouds) {
      const span = L.width + c.w
      const x = Math.round(((c.x + t * c.speed) % span) - c.w)
      rect(this.ctx, x + 4, c.y, c.w - 8, 2, p.cloud)
      rect(this.ctx, x, c.y + 2, c.w, 3, p.cloud)
      rect(this.ctx, x + Math.round(c.w * 0.2), c.y - 2, Math.round(c.w * 0.3), 2, p.cloud)
      rect(this.ctx, x + 2, c.y + 5, c.w - 4, 1, p.cloudShade)
    }
    this.ctx.globalAlpha = 1
  }

  private drawLightShow(showT: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const colors = [p.neonCyan, p.neonPink, p.neonAmber, p.ledGreen]
    const ctx = this.ctx
    // Fade in and out at the edges of the show.
    const envelope = Math.min(1, showT / 3, (LIGHT_SHOW_END - LIGHT_SHOW_START - showT) / 3)
    L.showTowers.forEach((tower, i) => {
      const ox = tower.x + Math.floor(tower.w / 2)
      const oy = tower.top - 6
      for (let beam = 0; beam < 2; beam++) {
        const angle = -Math.PI / 2 + Math.sin(showT * 0.7 + i * 1.7 + beam * 2.4) * 0.9
        const color = colors[(i + beam + Math.floor(showT / 6)) % colors.length]
        const length = Math.round(L.height * 0.5)
        for (let d = 4; d < length; d++) {
          ctx.globalAlpha = envelope * 0.5 * (1 - d / length)
          rect(ctx, ox + Math.cos(angle) * d, oy + Math.sin(angle) * d, 1, 1, color)
        }
      }
    })
    ctx.globalAlpha = 1
  }

  private drawTaskFloors(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    L.taskFloors.forEach((floor, i) => {
      const light = this.state.taskLights[i]
      rect(this.ctx, floor.x, floor.y, floor.w, floor.h, light ? taskLightColor(p, light, t, i) : p.windowDark)
      if (light === "running") {
        // A progress sweep runs along a busy floor.
        const sweep = Math.floor((t * 6 + i * 3) % floor.w)
        rect(this.ctx, floor.x + sweep, floor.y, 1, floor.h, p.ferryDeck)
      }
    })
    if (this.state.taskLights.includes("running")) {
      const tower = L.taskTower
      const rise = Math.round(tower.w * 0.9)
      if (Math.floor(t * 2) % 2 === 0) rect(this.ctx, tower.x + Math.floor(tower.w / 2), tower.top - rise - 9, 1, 1, p.neonCyan)
    }
  }

  private drawWater(t: number): void {
    const L = this.layout
    if (!L || !this.towers) return
    const p = this.palette
    const ctx = this.ctx
    const depth = L.height - L.horizonY
    // Mirror the skyline into the harbour, wobbling each row.
    for (let y = L.horizonY; y < L.height; y++) {
      const d = y - L.horizonY
      const srcY = L.horizonY - 1 - Math.floor(d * 1.7)
      if (srcY < 0) break
      // Skip every third row: broken, rippled streaks instead of a mirror copy.
      if (d % 3 === 2) continue
      const offset = Math.round(Math.sin(t * 1.7 + y * 0.6) * (0.6 + d * 0.03))
      ctx.globalAlpha = (this.state.timeOfDay === "night" ? 0.3 : 0.22) * (1 - d / depth)
      ctx.drawImage(this.towers, 0, srcY, L.width, 1, offset, y, L.width, 1)
    }
    ctx.globalAlpha = 1
    // Moon or sun path on the water.
    const mx = Math.round(L.width * 0.7)
    for (let y = L.horizonY + 2; y < L.ledgeY; y += 2) {
      const w = 2 + Math.round(Math.sin(t * 2 + y) * 1.5 + 1.5)
      if (cellNoise(y, Math.floor(t * 2), 3) < 0.6) rect(ctx, mx - Math.floor(w / 2), y, w, 1, p.waterGlint)
    }
    // Glints.
    const tick = Math.floor(t * 3)
    for (let i = 0; i < Math.round(L.width / 12); i++) {
      const gx = Math.floor(cellNoise(i, tick, 11) * L.width)
      const gy = L.horizonY + 2 + Math.floor(cellNoise(i, tick, 12) * (L.ledgeY - L.horizonY - 2))
      ctx.globalAlpha = 0.6
      rect(ctx, gx, gy, 2, 1, p.waterGlint)
    }
    ctx.globalAlpha = 1
  }

  private drawPier(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const ctx = this.ctx
    const P = L.pier
    const night = this.state.timeOfDay === "night"
    rect(ctx, P.x, P.y + 4, P.w, 3, p.pier)
    for (let x = P.x + 2; x < P.x + P.w; x += 6) rect(ctx, x, P.y + 7, 1, 3, p.roofDark)
    // Terminal building, with its sign board on the roof.
    const bw = Math.min(40, P.w - 8)
    rect(ctx, P.x + 2, P.y - 7, bw, 11, p.wallDark)
    rect(ctx, P.x + 1, P.y - 8, bw + 2, 1, p.roofEdge)
    for (let x = P.x + 5; x < P.x + bw - 2; x += 4) rect(ctx, x, P.y - 4, 2, 4, night ? p.pierLight : p.wallWindow)
    const label = "PIER"
    const signW = measureText(label) + 4
    const signX = P.x + 2 + Math.floor((bw - signW) / 2)
    rect(ctx, signX, P.y - 16, signW, 7, p.roofDark)
    rect(ctx, signX + 1, P.y - 9, 1, 1, p.metalDark)
    rect(ctx, signX + signW - 2, P.y - 9, 1, 1, p.metalDark)
    drawPixelText(ctx, label, signX + 2, P.y - 15, night ? p.neonAmber : p.paper)
    // Lamp posts.
    for (let x = P.x + bw + 6; x < P.x + P.w; x += 10) {
      rect(ctx, x, P.y - 3, 1, 7, p.metalDark)
      if (night) rect(ctx, x - 1, P.y - 4, 3, 1, Math.floor(t * 0.5 + x) % 7 === 0 ? p.pier : p.pierLight)
    }
  }

  private drawFerry(x: number, y: number, facingRight: boolean, lit: boolean): void {
    const p = this.palette
    const ctx = this.ctx
    const w = 22
    rect(ctx, x + 1, y + 4, w - 2, 2, p.ferryHull)
    rect(ctx, x, y + 3, w, 1, p.ferryHull)
    rect(ctx, x + 3, y, w - 6, 3, p.ferryDeck)
    rect(ctx, x + 6, y - 2, w - 12, 2, p.ferryDeck)
    for (let wx = x + 4; wx < x + w - 4; wx += 2) rect(ctx, wx, y + 1, 1, 1, lit ? p.windowWarm[0] : p.windowCool)
    rect(ctx, facingRight ? x + 7 : x + w - 8, y - 4, 1, 2, p.metalDark)
  }

  private drawJunk(x: number, y: number): void {
    const p = this.palette
    const ctx = this.ctx
    rect(ctx, x, y + 9, 16, 2, p.junkHull)
    rect(ctx, x + 2, y + 11, 12, 1, p.junkHull)
    rect(ctx, x + 12, y + 7, 4, 2, p.junkHull)
    for (const [sx, sh] of [[x + 3, 8], [x + 9, 10]] as const) {
      rect(ctx, sx, y + 9 - sh, 5, sh, p.junkSail)
      for (let by = y + 10 - sh; by < y + 9; by += 2) rect(ctx, sx, by, 5, 1, p.junkHull)
      rect(ctx, sx + 2, y + 8 - sh, 1, sh + 1, p.junkHull)
    }
  }

  private drawBoats(loopT: number): void {
    const L = this.layout
    if (!L) return
    const lanes = [L.horizonY + 10, L.horizonY + 22, L.horizonY + 34].map((y) => Math.min(y, L.ledgeY - 14))
    const night = this.state.timeOfDay === "night"
    // The junk sails the whole loop, right to left.
    const junkX = L.width + 20 - ((loopT / CITY_LOOP_SECONDS) * (L.width + 50))
    this.drawJunk(junkX, lanes[1] - 8)
    const ferries = Math.min(MAX_FERRIES, Math.max(0, Math.floor(this.state.activeRuns)))
    if (ferries === 0) {
      // Nothing deployed: a ferry waits at the pier.
      this.drawFerry(L.pier.x + L.pier.w - 18, L.pier.y + 1, true, night)
      return
    }
    for (let i = 0; i < ferries; i++) {
      const period = 70 + i * 17
      const progress = ((loopT + i * 23) % period) / period
      const x = L.pier.x + L.pier.w - 18 + progress * (L.width - L.pier.w)
      const y = lanes[i % lanes.length]
      this.drawFerry(x, y, true, night)
      // Wake behind the ferry.
      this.ctx.globalAlpha = 0.6
      for (let k = 1; k < 6; k++) rect(this.ctx, x - k * 3, y + 5 + (k % 2), 2, 1, this.palette.waterGlint)
      this.ctx.globalAlpha = 1
    }
  }

  private drawTicker(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const B = L.billboard
    const items = this.state.ticker.length > 0 ? this.state.ticker : [{ label: "NOVA", value: "MARKETS", up: true }]
    const segments = items.map((item) => ({ text: `${item.label} ${item.value}`, up: item.up }))
    const gap = 12
    const total = segments.reduce((sum, seg) => sum + measureText(seg.text) + gap, 0)
    const offset = Math.floor((t * 14) % total)
    const y = B.y + Math.floor((B.h - 5) / 2)
    const clip = { x0: B.x + 1, x1: B.x + B.w - 2 }
    for (let pass = 0; pass < 3; pass++) {
      let x = B.x + 2 - offset + pass * total
      for (const seg of segments) {
        if (x > clip.x1) break
        const color = seg.up ? p.ledGreen : p.ledRed
        drawPixelText(this.ctx, seg.text, x, y, color, clip)
        x += measureText(seg.text) + gap
      }
    }
    // Scanline sheen.
    this.ctx.globalAlpha = 0.12
    rect(this.ctx, B.x, B.y + (Math.floor(t * 8) % B.h), B.w, 1, p.ferryDeck)
    this.ctx.globalAlpha = 1
  }

  private drawNeon(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const N = L.neon
    const connected = this.state.polymarketConnected
    // A connected sign hums; a disconnected one is dark with a dying tube.
    const flickerOff = connected ? cellNoise(Math.floor(t * 8), 1, 9) < 0.03 : cellNoise(Math.floor(t * 6), 2, 9) > 0.08
    const color = flickerOff ? p.neonOff : p.neonPink
    rect(this.ctx, N.x, N.y, N.w, 1, flickerOff ? p.neonOff : p.neonCyan)
    rect(this.ctx, N.x, N.y + N.h - 1, N.w, 1, flickerOff ? p.neonOff : p.neonCyan)
    "ODDS".split("").forEach((ch, i) => drawPixelText(this.ctx, ch, N.x + 3, N.y + 4 + i * 9, color))
    if (!flickerOff && this.state.timeOfDay === "night") {
      this.ctx.globalAlpha = 0.18
      rect(this.ctx, N.x - 3, N.y - 2, N.w + 6, N.h + 4, p.neonPink)
      this.ctx.globalAlpha = 1
    }
  }

  private drawClock(): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const { cx, cy, r } = L.clock
    const now = new Date()
    const minuteAngle = ((now.getMinutes() + now.getSeconds() / 60) / 60) * Math.PI * 2 - Math.PI / 2
    const hourAngle = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2
    line(this.ctx, cx, cy, cx + Math.cos(minuteAngle) * (r - 2), cy + Math.sin(minuteAngle) * (r - 2), p.roofDark)
    line(this.ctx, cx, cy, cx + Math.cos(hourAngle) * (r - 4), cy + Math.sin(hourAngle) * (r - 4), p.ledRed)
  }

  private drawCinema(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const S = L.cinema
    const ctx = this.ctx
    if (this.state.youtubeConnected) {
      rect(ctx, S.x, S.y, S.w, S.h, p.screen)
      const pulse = Math.floor(t * 2) % 2 === 0
      const cx = S.x + Math.floor(S.w / 2)
      const cy = S.y + Math.floor(S.h / 2)
      rect(ctx, cx - 7, cy - 5, 14, 10, p.screenGlow)
      for (let i = 0; i < 5; i++) rect(ctx, cx - 2 + i, cy - 4 + i, 1, 9 - i * 2, p.ferryDeck)
      ctx.globalAlpha = pulse ? 0.16 : 0.1
      rect(ctx, S.x - 3, S.y - 3, S.w + 6, S.h + 6, p.screenGlow)
      ctx.globalAlpha = 1
    } else {
      // Static noise until YouTube is connected.
      const tick = Math.floor(t * 10)
      for (let y = S.y; y < S.y + S.h; y++) {
        for (let x = S.x; x < S.x + S.w; x++) {
          const n = cellNoise(x, y, tick)
          rect(ctx, x, y, 1, 1, n < 0.33 ? p.screen : n < 0.66 ? p.metalDark : p.metal)
        }
      }
    }
  }

  private drawTankMeter(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const K = L.tank
    const cost = this.state.costTodayUsd
    const text = cost === null ? "--" : cost >= 100 ? `${Math.round(cost)}` : cost >= 10 ? cost.toFixed(1) : cost.toFixed(2)
    const alert = this.state.budgetAlert && Math.floor(t * 2) % 2 === 0
    const inner = { x0: K.x + 1, x1: K.x + K.w - 2 }
    const width = measureText(text)
    drawPixelText(this.ctx, text, K.x + Math.max(1, Math.floor((K.w - width) / 2)), K.y + 8, alert ? p.ledRed : p.ledAmber, inner)
  }

  private drawAntennaLeds(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const A = L.antennas
    const flags = this.state.integrations
    const masts = 5
    flags.forEach((connected, i) => {
      const mast = i % masts
      const level = Math.floor(i / masts)
      const mx = A.x + 2 + Math.round((mast * (A.w - 5)) / (masts - 1))
      const top = A.y + (mast % 2 === 0 ? 0 : 8) + (mast === 2 ? -2 : 0)
      const y = top + 10 + level * 6
      const blink = connected && Math.floor(t * 1.5 + i * 0.7) % 4 !== 0
      rect(this.ctx, mx + 1, y, 1, 1, connected ? (blink ? p.ledGreen : p.ledOff) : p.ledOff)
    })
  }

  private drawLaundry(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const ctx = this.ctx
    const Ld = L.laundry
    const span = Ld.x1 - Ld.x0 - 8
    const wind = this.state.weather === "storm" ? 2.4 : this.state.weather === "rain" ? 1.4 : 1
    // Clothes on the upper pole.
    const pieces = Math.max(3, Math.floor(span / 11))
    for (let i = 0; i < pieces; i++) {
      const x = Ld.x0 + 3 + i * 11
      const sway = Math.round(Math.sin(t * 1.4 * wind + i * 1.3) * wind)
      const color = p.cloth[i % p.cloth.length]
      const shirt = i % 2 === 0
      if (shirt) {
        rect(ctx, x + sway, Ld.y + 1, 7, 2, color)
        rect(ctx, x + 1 + sway, Ld.y + 3, 5, 5, color)
      } else {
        rect(ctx, x + sway, Ld.y + 1, 6, 2, color)
        rect(ctx, x + sway, Ld.y + 3, 2, 6, color)
        rect(ctx, x + 4 + sway, Ld.y + 3, 2, 6, color)
      }
    }
    // Notes pinned to the lower pole: one paper per note.
    const notes = Math.min(MAX_NOTES, Math.max(0, this.state.notesCount))
    for (let i = 0; i < notes; i++) {
      const x = Ld.x0 + 4 + i * 8
      if (x + 5 > Ld.x1 - 6) break
      const sway = Math.round(Math.sin(t * 1.8 * wind + i * 0.9) * 0.8 * wind)
      rect(ctx, x + sway, Ld.y + 13, 5, 6, p.paper)
      rect(ctx, x + 1 + sway, Ld.y + 15, 3, 1, p.metalDark)
      rect(ctx, x + 1 + sway, Ld.y + 17, 2, 1, p.metalDark)
      rect(ctx, x + 2, Ld.y + 12, 1, 2, p.neonAmber)
    }
  }

  private drawFestoon(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const F = L.festoon
    const night = this.state.timeOfDay === "night"
    const colors = [p.windowWarm[0], p.neonPink, p.windowWarm[1], p.neonCyan]
    const bulbs = Math.max(4, Math.floor(Math.abs(F.x1 - F.x0) / 7))
    for (let i = 1; i < bulbs; i++) {
      const f = i / bulbs
      const x = Math.round(F.x0 + (F.x1 - F.x0) * f)
      const y = Math.round(F.y0 + (F.y1 - F.y0) * f + Math.sin(f * Math.PI) * F.sag) + 1
      const color = colors[i % colors.length]
      if (!night) {
        rect(this.ctx, x, y, 1, 2, p.paper)
        continue
      }
      const dim = cellNoise(i, Math.floor(t * 2), 51) < 0.08
      rect(this.ctx, x, y, 1, 2, dim ? p.metalDark : color)
      if (!dim) {
        this.ctx.globalAlpha = 0.25
        rect(this.ctx, x - 1, y - 1, 3, 4, color)
        this.ctx.globalAlpha = 1
      }
    }
  }

  private drawDrips(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    L.acUnits.forEach((ac, i) => {
      const cycle = (t * 0.9 + i * 0.37) % 1.6
      if (cycle > 1) return
      const y = ac.y + 7 + Math.floor(cycle * cycle * 30)
      rect(this.ctx, ac.x + 9, y, 1, 2, p.waterGlint)
    })
  }

  private drawPigeons(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const W = L.wire
    const colors = { g: p.pigeon, w: p.neonCyan, o: p.ledAmber }
    ;[0.25, 0.5, 0.72].forEach((f, i) => {
      const x = W.x0 + (W.x1 - W.x0) * f
      const y = W.y0 + (W.y1 - W.y0) * f
      const peck = cellNoise(i, Math.floor(t * 0.8), 21) < 0.2
      drawSprite(this.ctx, peck ? PIGEON_PECK : PIGEON, x - 3, y - 4, colors, i === 1)
    })
  }

  private drawCat(t: number): void {
    const L = this.layout
    if (!L) return
    const p = this.palette
    const ctx = this.ctx
    const { x, y } = L.cat
    const presence = this.state.presence
    if (presence === "offline") {
      drawSprite(ctx, CAT_ASLEEP, x - 2, y + 5, { k: p.cat })
      const z = Math.floor(t * 1.2) % 3
      for (let i = 0; i <= z; i++) drawPixelText(ctx, "z", x + 10 + i * 3, y - 1 - i * 5, p.paper)
      return
    }
    drawSprite(ctx, CAT_SITTING, x, y, { k: p.cat })
    // Tail: a curl that sways along the ledge.
    const sway = Math.round(Math.sin(t * (presence === "thinking" ? 4 : 1.6)) * 2)
    rect(ctx, x + 8, y + 9, 3, 1, p.cat)
    rect(ctx, x + 10 + Math.max(0, sway), y + 7 + Math.min(0, sway), 1, 3, p.cat)
    // Ears twitch while listening.
    if (presence === "listening" && Math.floor(t * 3) % 2 === 0) rect(ctx, x + 1, y - 1, 1, 1, p.cat)
    // Presence bubble above the cat.
    const bx = x + 4
    const by = y - 10
    if (presence === "thinking") {
      const dots = 1 + (Math.floor(t * 2.5) % 3)
      rect(ctx, bx - 2, by - 1, 13, 7, p.paper)
      rect(ctx, bx, by + 6, 2, 1, p.paper)
      for (let i = 0; i < dots; i++) rect(ctx, bx + 1 + i * 3, by + 2, 2, 2, p.roofDark)
    } else if (presence === "speaking") {
      const hop = Math.floor(t * 3) % 2
      rect(ctx, bx + 1, by - hop, 1, 5, p.neonAmber)
      rect(ctx, bx - 1, by + 3 - hop, 2, 2, p.neonAmber)
      rect(ctx, bx + 2, by - hop, 2, 1, p.neonAmber)
    }
  }

  private drawWeather(t: number): void {
    const L = this.layout
    if (!L) return
    drawWeatherOverlay(this.ctx, this.palette, this.state.weather, L.width, L.height, t, L.horizonY - 30)
  }
}
