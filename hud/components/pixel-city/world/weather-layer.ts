import { Container, Sprite, TilingSprite, type Texture } from "pixi.js"
import { DISTRICT_MAP } from "../district/image-plan"
import { cellNoise } from "../random"
import type { CityWeather } from "../types"
import { rect, softCircleTexture, tileTexture } from "./textures"

/**
 * Rain, storm flashes, snow and fog over the whole map. Rain and snow are tiling sprites of one pre-drawn tile that
 * scroll, so a heavy downpour costs two draw calls whatever the density; a drop or flake is one plan pixel, like the
 * painting's own pixels. With reduced motion they are drawn still.
 */

const TILE = 256
const RAIN_DENSITY = { rain: 520, storm: 260 } as const
const SNOW_DENSITY = 700

function rainTile(perDrops: number, seed: number): Texture {
  return tileTexture(TILE, (ctx) => {
    ctx.fillStyle = "rgba(40, 70, 170, 0.6)"
    const drops = Math.round((TILE * TILE) / perDrops)
    for (let i = 0; i < drops; i++) {
      const x = Math.floor(cellNoise(i, 1, seed) * TILE)
      const y = Math.floor(cellNoise(i, 2, seed) * TILE)
      ctx.fillRect(x, y, 1, 3)
    }
  })
}

function snowTile(): Texture {
  return tileTexture(TILE, (ctx) => {
    ctx.fillStyle = "#ffffff"
    const flakes = Math.round((TILE * TILE) / SNOW_DENSITY)
    for (let i = 0; i < flakes; i++) ctx.fillRect(Math.floor(cellNoise(i, 1, 43) * TILE), Math.floor(cellNoise(i, 2, 43) * TILE), 1, 1)
  })
}

export class WeatherLayer {
  readonly container = new Container()
  private weather: CityWeather = "clear"
  private readonly rain: TilingSprite[] = []
  private readonly stormRain: TilingSprite[] = []
  private readonly snow: TilingSprite[] = []
  private readonly flash = rect(DISTRICT_MAP.x, DISTRICT_MAP.y, DISTRICT_MAP.w, DISTRICT_MAP.h, 0xffffff, 0)
  private readonly fog: Sprite[] = []

  constructor(private readonly animated: boolean) {
    const area = { width: DISTRICT_MAP.w, height: DISTRICT_MAP.h }
    const tiling = (texture: Texture) => {
      const s = new TilingSprite({ texture, ...area })
      s.position.set(DISTRICT_MAP.x, DISTRICT_MAP.y)
      s.visible = false
      this.container.addChild(s)
      return s
    }
    // Two layers of each, offset against each other, so the tile never reads as a pattern.
    this.rain.push(tiling(rainTile(RAIN_DENSITY.rain, 41)), tiling(rainTile(RAIN_DENSITY.rain, 42)))
    this.stormRain.push(tiling(rainTile(RAIN_DENSITY.storm, 44)), tiling(rainTile(RAIN_DENSITY.storm, 45)))
    this.snow.push(tiling(snowTile()), tiling(snowTile()))
    this.container.addChild(this.flash)
    const mist = softCircleTexture()
    for (let band = 0; band < 3; band++) {
      const s = new Sprite(mist)
      s.anchor.set(0.5)
      s.tint = 0xebf0f6
      s.alpha = 0
      s.width = DISTRICT_MAP.w * 1.2
      s.height = 90
      s.position.set(DISTRICT_MAP.x + DISTRICT_MAP.w / 2, DISTRICT_MAP.y + DISTRICT_MAP.h * (0.34 + band * 0.16))
      this.fog.push(s)
      this.container.addChild(s)
    }
  }

  setWeather(weather: CityWeather): void {
    this.weather = weather
    const raining = weather === "rain"
    const storming = weather === "storm"
    this.rain.forEach((s) => (s.visible = raining))
    this.stormRain.forEach((s) => (s.visible = storming))
    this.snow.forEach((s) => (s.visible = weather === "snow"))
    this.fog.forEach((s) => (s.alpha = weather === "fog" ? 0.34 : 0))
    if (weather !== "storm") this.flash.alpha = 0
  }

  update(t: number): void {
    const motion = this.animated ? t : 0
    if (this.weather === "rain" || this.weather === "storm") {
      const layers = this.weather === "rain" ? this.rain : this.stormRain
      layers.forEach((s, i) => {
        const speed = (i === 0 ? 150 : 195) * (this.weather === "storm" ? 1.15 : 1)
        s.tilePosition.set(-motion * speed * 0.25 + i * 97, motion * speed + i * 61)
      })
      if (this.weather === "storm") {
        const phase = motion % 11
        this.flash.alpha = this.animated && (phase < 0.12 || (phase > 0.25 && phase < 0.32)) ? 0.35 : 0
      }
    } else if (this.weather === "snow") {
      this.snow.forEach((s, i) => s.tilePosition.set(Math.sin(motion * 0.8 + i) * 4 + i * 131, motion * (i === 0 ? 14 : 22) + i * 77))
    } else if (this.weather === "fog") {
      this.fog.forEach((s, i) => (s.x = DISTRICT_MAP.x + DISTRICT_MAP.w / 2 + Math.sin(motion * 0.15 + i) * 20))
    }
  }
}
