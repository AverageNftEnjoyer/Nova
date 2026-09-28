import { cellNoise } from "./random"
import type { CityWeather } from "./types"

const RAIN = "rgba(170, 190, 255, 0.55)"
const SNOW = "#eef2ff"
const FOG = "rgba(120, 110, 160, 0.18)"

/**
 * Rain, storm flashes, snow or fog over the whole scene. `px` is the size of one art pixel in the scene's
 * coordinates, so drops and flakes match the painting's pixel size and their count stays the same on screen.
 */
export function drawWeatherOverlay(
  ctx: CanvasRenderingContext2D,
  weather: CityWeather,
  width: number,
  height: number,
  t: number,
  fogTop: number,
  px = 1,
): void {
  const area = (width * height) / (px * px)
  if (weather === "rain" || weather === "storm") {
    const drops = Math.round(area / (weather === "storm" ? 260 : 520))
    ctx.fillStyle = RAIN
    for (let i = 0; i < drops; i++) {
      const speed = (140 + cellNoise(i, 0, 41) * 60) * px
      const x0 = cellNoise(i, 1, 41) * (width + 40 * px)
      const y = ((cellNoise(i, 2, 41) * height + t * speed) % (height + 8 * px)) - 4 * px
      const x = Math.round((x0 - y * 0.25) % (width + 40 * px))
      ctx.fillRect(x, Math.round(y), px, 3 * px)
    }
    if (weather === "storm") {
      const phase = t % 11
      if (phase < 0.12 || (phase > 0.25 && phase < 0.32)) {
        ctx.globalAlpha = 0.35
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, width, height)
        ctx.globalAlpha = 1
      }
    }
  } else if (weather === "snow") {
    const flakes = Math.round(area / 700)
    ctx.fillStyle = SNOW
    for (let i = 0; i < flakes; i++) {
      const speed = (10 + cellNoise(i, 0, 43) * 14) * px
      const y = (cellNoise(i, 1, 43) * height + t * speed) % height
      const x = (cellNoise(i, 2, 43) * width + Math.sin(t * 0.8 + i) * 4 * px + width) % width
      ctx.fillRect(Math.round(x), Math.round(y), px, px)
    }
  } else if (weather === "fog") {
    ctx.fillStyle = FOG
    for (let band = 0; band < 3; band++) {
      const drift = Math.round(Math.sin(t * 0.15 + band) * 20 * px)
      ctx.fillRect(drift - 30 * px, fogTop + band * 16 * px, width + 60 * px, 10 * px)
    }
  }
}
