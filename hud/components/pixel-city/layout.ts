import { createRng, hashString, pick, randInt, type Rng } from "./random"
import type { CityHotspotId, CityRect } from "./types"

/**
 * Builds the scene's geometry for a logical canvas size and a city seed. Pure and deterministic, so resizing
 * or re-rendering never reshuffles the skyline. All numbers are logical scene pixels.
 */

export type TowerCrown = "flat" | "spire" | "crown" | "lattice" | "stepped" | "antenna"

export interface Tower {
  x: number
  w: number
  /** Top edge (y) of the body; the base always sits on the horizon. */
  top: number
  layer: 0 | 1
  shade: number
  crown: TowerCrown
  /** Window grid pitch and how many windows are lit. */
  pitchX: number
  pitchY: number
  litChance: number
  coolWindows: boolean
  seed: number
  landmark: boolean
}

export interface CityLayout {
  width: number
  height: number
  horizonY: number
  /** Top y of the ridge for every column. */
  ridge: number[]
  tram: { x0: number; y0: number; x1: number; y1: number }
  towers: Tower[]
  taskTower: Tower
  /** Five floors near the top of the task tower, top floor first. */
  taskFloors: CityRect[]
  showTowers: Tower[]
  pier: CityRect
  ledgeY: number
  laundry: { x0: number; x1: number; y: number }
  cinema: CityRect
  tank: CityRect
  antennas: CityRect
  cat: { x: number; y: number }
  wire: { x0: number; y0: number; x1: number; y1: number }
  /** Festoon string across the rooftop, from the laundry stand to the antenna array. */
  festoon: { x0: number; y0: number; x1: number; y1: number; sag: number }
  tenement: CityRect
  neon: CityRect
  billboard: CityRect
  clock: { cx: number; cy: number; r: number }
  acUnits: Array<{ x: number; y: number }>
  stars: Array<{ x: number; y: number; phase: number }>
  clouds: Array<{ x: number; y: number; w: number; speed: number }>
  hotspots: Record<CityHotspotId, CityRect>
}

const CROWNS: readonly TowerCrown[] = ["flat", "flat", "stepped", "antenna", "spire", "flat"]

function makeTower(rng: Rng, x: number, w: number, top: number, layer: 0 | 1, landmark = false): Tower {
  return {
    x,
    w,
    top,
    layer,
    shade: randInt(rng, 0, 2),
    crown: landmark ? "flat" : pick(rng, CROWNS),
    pitchX: pick(rng, [2, 2, 3]),
    pitchY: pick(rng, [2, 3, 3]),
    litChance: 0.18 + rng() * 0.32,
    coolWindows: rng() < 0.25,
    seed: Math.floor(rng() * 1e9),
    landmark,
  }
}

function buildRidge(rng: Rng, width: number, horizonY: number, height: number): number[] {
  // Two broad humps plus a little noise: a peak behind the city, not a sawtooth.
  const peakX = width * (0.18 + rng() * 0.2)
  const peakTop = Math.round(height * (0.2 + rng() * 0.05))
  const secondX = width * (0.62 + rng() * 0.2)
  const secondTop = Math.round(height * (0.3 + rng() * 0.06))
  const ridge: number[] = []
  let wobble = 0
  for (let x = 0; x < width; x++) {
    const a = peakTop + Math.pow(Math.abs(x - peakX) / (width * 0.42), 1.5) * (horizonY - peakTop)
    const b = secondTop + Math.pow(Math.abs(x - secondX) / (width * 0.34), 1.6) * (horizonY - secondTop)
    if (x % 3 === 0) wobble = Math.max(-2, Math.min(2, wobble + (rng() < 0.5 ? -1 : 1)))
    ridge.push(Math.min(horizonY - 4, Math.round(Math.min(a, b)) + wobble))
  }
  return ridge
}

export function buildCityLayout(width: number, height: number, cityKey: string): CityLayout {
  const rng = createRng(hashString(cityKey.trim().toLowerCase() || "nova"))
  const horizonY = Math.round(height * 0.58)
  const ridge = buildRidge(rng, width, horizonY, height)

  // Foreground tenement on the right (its facade holds the billboard, neon sign and clock).
  const tenementW = Math.max(66, Math.min(118, Math.round(width * 0.2)))
  const tenement: CityRect = { x: width - tenementW, y: Math.round(height * 0.3), w: tenementW, h: height - Math.round(height * 0.3) }
  const skylineEnd = tenement.x + 6

  // Landmarks first so the filler towers pack around them.
  // Tallest roofs stop at 27% of the height so spires clear the HUD bar at the top.
  const maxRise = horizonY - Math.round(height * 0.27)
  const taskW = Math.max(16, Math.round(width * 0.045))
  const taskTower = makeTower(rng, Math.round(width * 0.43), taskW, horizonY - maxRise, 1, true)
  taskTower.crown = "spire"
  taskTower.pitchX = 2
  taskTower.pitchY = 3
  const crownTower = makeTower(rng, Math.round(width * 0.27), Math.max(13, Math.round(width * 0.034)), horizonY - Math.round(maxRise * 0.82), 1, true)
  crownTower.crown = "crown"
  const latticeTower = makeTower(rng, Math.round(width * 0.58), Math.max(13, Math.round(width * 0.036)), horizonY - Math.round(maxRise * 0.9), 1, true)
  latticeTower.crown = "lattice"
  const landmarks = [crownTower, taskTower, latticeTower]

  const towers: Tower[] = []
  // Far layer: dense, short, dim.
  for (let x = -4; x < skylineEnd; ) {
    const w = randInt(rng, 6, 14)
    const rise = randInt(rng, Math.round(maxRise * 0.18), Math.round(maxRise * 0.55))
    towers.push(makeTower(rng, x, w, horizonY - rise, 0))
    x += w + randInt(rng, -2, 1)
  }
  // Near layer: taller, skipping the landmark footprints.
  for (let x = Math.round(width * 0.14); x < skylineEnd; ) {
    const w = randInt(rng, 8, 16)
    const hitsLandmark = landmarks.some((l) => x + w > l.x - 2 && x < l.x + l.w + 2)
    if (!hitsLandmark && rng() < 0.8) {
      const rise = randInt(rng, Math.round(maxRise * 0.3), Math.round(maxRise * 0.66))
      towers.push(makeTower(rng, x, w, horizonY - rise, 1))
    }
    x += w + randInt(rng, 1, 5)
  }
  towers.push(...landmarks)

  const floorH = 3
  const taskFloors: CityRect[] = Array.from({ length: 5 }, (_, i) => ({
    x: taskTower.x + 2,
    y: taskTower.top + 4 + i * (floorH + 1),
    w: taskTower.w - 4,
    h: floorH,
  }))

  // Tram line up the ridge's left slope.
  const tramX0 = Math.round(width * 0.06)
  const tramX1 = Math.round(width * 0.2)
  const tram = { x0: tramX0, y0: ridge[tramX0] + 6, x1: tramX1, y1: ridge[tramX1] + 2 }

  const pierW = Math.max(52, Math.round(width * 0.17))
  const pier: CityRect = { x: 0, y: horizonY + 5, w: pierW, h: 9 }

  // Foreground rooftop band; the HUD footer overlays the bottom of it.
  const ledgeY = height - Math.round(height * 0.16)
  const laundry = { x0: 0, x1: Math.round(width * 0.2), y: ledgeY - Math.round(height * 0.12) }
  const cinemaW = Math.max(30, Math.round(width * 0.075))
  const cinema: CityRect = { x: Math.round(width * 0.23), y: ledgeY - Math.round(cinemaW * 0.62) - 6, w: cinemaW, h: Math.round(cinemaW * 0.62) }
  const tankW = Math.max(16, Math.round(width * 0.04))
  const tank: CityRect = { x: Math.round(width * 0.39), y: ledgeY - 30, w: tankW, h: 22 }
  const antennas: CityRect = { x: Math.round(width * 0.51), y: ledgeY - 44, w: Math.max(26, Math.round(width * 0.07)), h: 44 }
  const cat = { x: Math.round(width * 0.66), y: ledgeY - 11 }
  // Pigeon wire: from the antenna mast across to the tenement, sagging just above the rooftop clutter.
  const wire = { x0: antennas.x + antennas.w - 2, y0: antennas.y + 4, x1: tenement.x, y1: antennas.y - 6 }

  const festoon = { x0: laundry.x1, y0: laundry.y - 2, x1: antennas.x + 2, y1: antennas.y + 3, sag: Math.round(height * 0.05) }

  const neon: CityRect = { x: tenement.x - 9, y: tenement.y + 30, w: 9, h: 42 }
  const billboard: CityRect = { x: tenement.x + 6, y: tenement.y + 6, w: tenement.w - 12, h: 17 }
  const clock = { cx: tenement.x + Math.round(tenement.w / 2), cy: tenement.y - 9, r: 7 }
  const acUnits = [
    { x: tenement.x + 4, y: tenement.y + 52 },
    { x: tenement.x + tenement.w - 16, y: tenement.y + 70 },
    { x: tenement.x + Math.round(tenement.w * 0.45), y: tenement.y + 88 },
  ]

  const stars = Array.from({ length: Math.round((width * horizonY) / 420) }, () => ({
    x: Math.floor(rng() * width),
    y: Math.floor(rng() * (horizonY - 30)),
    phase: rng(),
  }))
  const clouds = Array.from({ length: 4 }, (_, i) => ({
    x: Math.floor(rng() * width),
    y: Math.round(height * 0.07) + i * Math.round(height * 0.05) + randInt(rng, 0, 6),
    w: randInt(rng, 26, 60),
    speed: 0.6 + rng() * 1.2,
  }))

  const pad = (r: CityRect, p: number): CityRect => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 })
  const hotspots: Record<CityHotspotId, CityRect> = {
    tasks: { x: taskTower.x - 3, y: taskTower.top - 14, w: taskTower.w + 6, h: horizonY - taskTower.top + 14 },
    deploy: { x: pier.x, y: pier.y - 14, w: pier.w, h: pier.h + 20 },
    schedule: pad({ x: clock.cx - clock.r, y: clock.cy - clock.r, w: clock.r * 2 + 1, h: clock.r * 2 + 1 }, 2),
    crypto: pad(billboard, 1),
    polymarket: pad(neon, 1),
    youtube: { x: cinema.x - 2, y: cinema.y - 2, w: cinema.w + 4, h: ledgeY - cinema.y + 2 },
    analytics: { x: tank.x - 2, y: tank.y - 6, w: tank.w + 4, h: ledgeY - tank.y + 6 },
    notes: { x: laundry.x0, y: laundry.y - 3, w: laundry.x1 - laundry.x0, h: 22 },
    integrations: pad(antennas, 1),
    chat: { x: cat.x - 5, y: cat.y - 12, w: 22, h: 24 },
  }

  return {
    width,
    height,
    horizonY,
    ridge,
    tram,
    towers,
    taskTower,
    taskFloors,
    showTowers: landmarks,
    pier,
    ledgeY,
    laundry,
    cinema,
    tank,
    antennas,
    cat,
    wire,
    festoon,
    tenement,
    neon,
    billboard,
    clock,
    acUnits,
    stars,
    clouds,
    hotspots,
  }
}
