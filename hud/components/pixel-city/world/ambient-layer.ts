import { Container, Sprite } from "pixi.js"
import { DISTRICT_MAP } from "../district/image-plan"
import { cellNoise } from "../random"
import type { CityWeather } from "../types"
import { buildDinghy, buildSkiff } from "./boat-art"
import { rect, softCircleTexture } from "./textures"
import { AMBIENT_BOATS, CLOUDS, PARTICLE_CAPS, WATERFALLS, WATER_MASK, type Waterfall } from "./world-config"

/**
 * Cosmetic life that carries no data: glints on the water (placed on the map's detected water), waterfall streaks,
 * spray and mist, a few drifting boats, and cloud shadows that lag the camera a little for depth. With reduced motion
 * the world is drawn still: glints at a fixed brightness, no particles, no drift.
 */

interface Glint {
  sprite: Sprite
  x: number
  y: number
  phase: number
  speed: number
}

interface Streak {
  sprite: Sprite
  fall: Waterfall
  offset: number
  speed: number
}

interface Particle {
  sprite: Sprite
  fall: Waterfall
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  /** Mist grows as it fades; spray falls under gravity. */
  mist: boolean
}

interface Cloud {
  sprite: Sprite
  speed: number
}

interface DriftingBoat {
  root: Container
  x: number
  y: number
  rx: number
  ry: number
  period: number
  phase: number
}

const GRAVITY = 90
const CLOUD_WEATHER_GAIN: Readonly<Record<CityWeather, number>> = { clear: 1, cloudy: 1.9, fog: 1.4, rain: 2.4, storm: 3, snow: 1.7 }

export class AmbientLayer {
  /** Beneath the walkers: water glints, waterfall streaks, spray and mist. */
  readonly ground = new Container()
  /** Cloud shadows over everything on the ground. */
  readonly clouds = new Container()
  /** Drifting boats; the world adds them to its depth-sorted layer. */
  readonly boats: Container[] = []
  private readonly glints: Glint[] = []
  private readonly streaks: Streak[] = []
  private readonly particles: Particle[] = []
  private readonly cloudList: Cloud[] = []
  private readonly drifting: DriftingBoat[] = []

  constructor(
    water: ReadonlyArray<{ x: number; y: number; size: number }>,
    private readonly animated: boolean,
  ) {
    this.buildGlints(water)
    this.buildFalls()
    this.buildClouds()
    this.buildBoats()
    this.update(0, 0, DISTRICT_MAP.x + DISTRICT_MAP.w / 2, DISTRICT_MAP.y + DISTRICT_MAP.h / 2)
  }

  setWeather(weather: CityWeather): void {
    const gain = CLOUD_WEATHER_GAIN[weather]
    for (const cloud of this.cloudList) cloud.sprite.alpha = Math.min(0.32, CLOUDS.alpha * gain)
  }

  private buildGlints(water: ReadonlyArray<{ x: number; y: number; size: number }>): void {
    if (water.length === 0) return
    // A stable pick: every n-th cell, jittered inside it, so the glints spread over all the water.
    const count = Math.min(WATER_MASK.maxGlints, water.length)
    const stride = water.length / count
    for (let i = 0; i < count; i++) {
      const cell = water[Math.floor(i * stride)]
      const x = cell.x + cellNoise(i, 1, 71) * cell.size
      const y = cell.y + cellNoise(i, 2, 71) * cell.size
      const sprite = rect(0, 0, 3, 1, 0xffffff, 0)
      sprite.position.set(x, y)
      this.ground.addChild(sprite)
      this.glints.push({ sprite, x, y, phase: cellNoise(i, 3, 71) * Math.PI * 2, speed: 0.6 + cellNoise(i, 4, 71) * 1.1 })
    }
  }

  private buildFalls(): void {
    let spray = 0
    let mist = 0
    for (const [index, fall] of WATERFALLS.entries()) {
      // Bright streaks sliding down the face of the fall.
      const streakCount = Math.round(9 * fall.power) + 2
      for (let i = 0; i < streakCount; i++) {
        const sprite = rect(0, 0, 1, 6 * Math.max(0.6, fall.power), 0xffffff, 0.5)
        this.ground.addChild(sprite)
        this.streaks.push({ sprite, fall, offset: cellNoise(i, index, 73), speed: 0.7 + cellNoise(i, index, 74) * 0.9 })
      }
      if (!this.animated) continue
      const sprayCount = Math.min(PARTICLE_CAPS.spray - spray, Math.round(PARTICLE_CAPS.spray * (fall.power >= 1 ? 0.65 : 0.17)))
      for (let i = 0; i < sprayCount; i++) this.addParticle(fall, false, i)
      spray += sprayCount
      const mistCount = Math.min(PARTICLE_CAPS.mist - mist, fall.power >= 1 ? 12 : 3)
      for (let i = 0; i < mistCount; i++) this.addParticle(fall, true, i)
      mist += mistCount
    }
  }

  private addParticle(fall: Waterfall, mist: boolean, i: number): void {
    const sprite = mist ? new Sprite(softCircleTexture()) : rect(0, 0, 1, 1, 0xffffff)
    if (mist) {
      sprite.anchor.set(0.5)
      sprite.tint = 0xeaf8ff
    }
    this.ground.addChild(sprite)
    const particle: Particle = { sprite, fall, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, mist }
    this.respawn(particle, cellNoise(i, mist ? 1 : 0, 75))
    this.particles.push(particle)
  }

  private respawn(p: Particle, startAge: number): void {
    const f = p.fall
    if (p.mist) {
      p.life = 2.2 + Math.random() * 1.4
      p.x = f.x + (Math.random() * 2 - 1) * f.halfWidth * 1.6
      p.y = f.bottom - 2 + Math.random() * 3
      p.vx = (Math.random() * 2 - 1) * 3
      p.vy = -(3 + Math.random() * 4) * f.power
    } else {
      p.life = 0.6 + Math.random() * 0.5
      p.x = f.x + (Math.random() * 2 - 1) * f.halfWidth
      p.y = f.bottom - 1
      p.vx = (Math.random() * 2 - 1) * 22 * f.power
      p.vy = -(26 + Math.random() * 34) * f.power
    }
    p.age = startAge * p.life
  }

  private buildClouds(): void {
    const texture = softCircleTexture()
    for (let i = 0; i < CLOUDS.count; i++) {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      sprite.tint = CLOUDS.color
      sprite.alpha = CLOUDS.alpha
      const w = CLOUDS.widthMin + cellNoise(i, 1, 77) * (CLOUDS.widthMax - CLOUDS.widthMin)
      const h = CLOUDS.heightMin + cellNoise(i, 2, 77) * (CLOUDS.heightMax - CLOUDS.heightMin)
      sprite.scale.set(w / 64, h / 64)
      sprite.position.set(DISTRICT_MAP.x + cellNoise(i, 3, 77) * DISTRICT_MAP.w, DISTRICT_MAP.y + (0.1 + 0.8 * ((i + cellNoise(i, 4, 77) * 0.6) / CLOUDS.count)) * DISTRICT_MAP.h)
      this.clouds.addChild(sprite)
      this.cloudList.push({ sprite, speed: CLOUDS.speedMin + cellNoise(i, 5, 77) * (CLOUDS.speedMax - CLOUDS.speedMin) })
    }
  }

  private buildBoats(): void {
    for (const boat of AMBIENT_BOATS) {
      const root = boat.kind === "skiff" ? buildSkiff() : buildDinghy()
      this.boats.push(root)
      this.drifting.push({ root, x: boat.x, y: boat.y, rx: boat.rx, ry: boat.ry, period: boat.period, phase: boat.phase })
    }
  }

  /** `camX`, `camY`: the plan point at the middle of the screen (for the clouds' depth shift). */
  update(t: number, dt: number, camX: number, camY: number): void {
    const motion = this.animated ? t : 0
    for (const g of this.glints) {
      const wave = Math.sin(motion * g.speed + g.phase)
      g.sprite.alpha = this.animated ? Math.max(0, wave) ** 2 * 0.7 : 0.35
      g.sprite.x = g.x + (this.animated ? Math.sin(motion * 0.3 + g.phase) * 2 : 0)
    }
    for (const s of this.streaks) {
      const f = s.fall
      const phase = this.animated ? (motion * s.speed * 0.5 + s.offset) % 1 : s.offset
      const len = f.bottom - f.top
      s.sprite.x = f.x - f.halfWidth + ((s.offset * 7.3) % 1) * 2 * f.halfWidth
      s.sprite.y = f.top + phase * len
      s.sprite.alpha = 0.55 * Math.sin(phase * Math.PI)
    }
    if (this.animated) {
      for (const p of this.particles) {
        p.age += dt
        if (p.age >= p.life) this.respawn(p, 0)
        const k = p.age / p.life
        if (p.mist) {
          p.x += p.vx * dt
          p.y += p.vy * dt
          const size = (7 + 20 * k) * p.fall.power
          p.sprite.scale.set(size / 64)
          p.sprite.alpha = 0.34 * Math.sin(Math.min(1, k) * Math.PI)
        } else {
          p.vy += GRAVITY * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.sprite.alpha = 1 - k
        }
        p.sprite.position.set(Math.round(p.x), Math.round(p.y))
      }
      const half = DISTRICT_MAP.w / 2
      const span = DISTRICT_MAP.w + CLOUDS.widthMax
      for (const c of this.cloudList) {
        c.sprite.x += c.speed * dt
        if (c.sprite.x > DISTRICT_MAP.x + half + span / 2) c.sprite.x -= span
      }
    }
    // Clouds lag the camera slightly: depth without ever uncovering anything (they are translucent shadows).
    this.clouds.position.set(-(camX - (DISTRICT_MAP.x + DISTRICT_MAP.w / 2)) * CLOUDS.parallax, -(camY - (DISTRICT_MAP.y + DISTRICT_MAP.h / 2)) * CLOUDS.parallax)
    for (const b of this.drifting) {
      const a = (motion / b.period + b.phase) * Math.PI * 2
      const vx = Math.cos(a)
      b.root.position.set(Math.round(b.x + b.rx * Math.sin(a)), Math.round(b.y + b.ry * Math.sin(a * 2) + (this.animated ? Math.sin(motion * 1.3 + b.phase * 9) * 0.8 : 0)))
      b.root.scale.x = vx >= 0 ? 1 : -1
      b.root.zIndex = b.root.y
    }
  }
}
