import { Container, Sprite } from "pixi.js"
import { DISTRICT_MAP } from "../district/image-plan"
import { cellNoise } from "../random"
import { rect, softCircleTexture } from "./textures"
import { LIGHT_COLORS, WINDOW_LIGHTS } from "./world-config"
import { cityHour, lookAtHour } from "./time-of-day"

/**
 * Day and night. A multiply layer over the scene carries the tint (dawn pink, dusk amber and violet, night blue; clear
 * in daylight), and the building windows in WINDOW_LIGHTS glow with additive sprites that fade in as it gets dark and
 * twinkle slowly. The clock (or the forced hour) is read about once a second, not per frame.
 */

interface WindowGlow {
  glow: Sprite
  core: Sprite
  base: number
  speed: number
  phase: number
}

const CLOCK_INTERVAL = 1

export class DayNightLayer {
  /** Multiply tint: sits above the scene, below the emissive details. */
  readonly tint: Sprite
  /** Window glows: additive, above the tint. */
  readonly lights = new Container()
  private readonly windows: WindowGlow[] = []
  private night = 0
  private lastClock = -Infinity

  constructor(private readonly animated: boolean) {
    this.tint = rect(DISTRICT_MAP.x, DISTRICT_MAP.y, DISTRICT_MAP.w, DISTRICT_MAP.h, 0xffffff)
    this.tint.blendMode = "multiply"
    this.tint.visible = false
    const texture = softCircleTexture()
    WINDOW_LIGHTS.forEach((light, i) => {
      const colors = LIGHT_COLORS[light.tone]
      const glow = new Sprite(texture)
      glow.anchor.set(0.5)
      glow.position.set(light.x, light.y)
      glow.scale.set((light.r * 3.4) / 64)
      glow.tint = colors.glow
      glow.blendMode = "add"
      const core = rect(Math.round(light.x) - 1, Math.round(light.y) - 1, 2, 2, colors.core)
      core.blendMode = "add"
      this.lights.addChild(glow, core)
      this.windows.push({ glow, core, base: 0.75 + cellNoise(i, 1, 81) * 0.25, speed: 0.5 + cellNoise(i, 2, 81) * 1.6, phase: cellNoise(i, 3, 81) * Math.PI * 2 })
    })
    this.lights.visible = false
  }

  update(t: number): void {
    if (t - this.lastClock >= CLOCK_INTERVAL || this.lastClock === -Infinity) {
      this.lastClock = t
      const look = lookAtHour(cityHour())
      this.tint.tint = look.tint
      this.tint.visible = look.tint !== 0xffffff
      this.night = look.night
      this.lights.visible = look.night > 0.01
    }
    if (!this.lights.visible) return
    for (const w of this.windows) {
      const twinkle = this.animated ? 0.8 + 0.2 * Math.sin(t * w.speed + w.phase) : 1
      const a = this.night * w.base * twinkle
      w.glow.alpha = a * 0.85
      w.core.alpha = Math.min(1, a * 1.2)
    }
  }
}
