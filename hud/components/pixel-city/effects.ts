import type { CityPalette } from "./palette"
import { cellNoise } from "./random"
import type { CityWeather } from "./types"

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Vertical gradient with ordered dithering between palette steps: the classic pixel-art sky (and water). */
export function ditherBands(ctx: CanvasRenderingContext2D, colors: readonly string[], x: number, y0: number, width: number, y1: number): void {
  const height = y1 - y0
  if (height <= 0 || width <= 0) return
  const image = ctx.createImageData(width, height)
  const rgb = colors.map(hexToRgb)
  const steps = rgb.length - 1
  for (let y = 0; y < height; y++) {
    const t = steps > 0 ? (y / Math.max(1, height - 1)) * steps : 0
    const i = Math.min(steps, Math.floor(t))
    const frac = t - i
    for (let xx = 0; xx < width; xx++) {
      const threshold = (BAYER_4[(y % 4) * 4 + (xx % 4)] + 0.5) / 16
      const c = frac > threshold && i < steps ? rgb[i + 1] : rgb[i]
      const o = (y * width + xx) * 4
      image.data[o] = c[0]
      image.data[o + 1] = c[1]
      image.data[o + 2] = c[2]
      image.data[o + 3] = 255
    }
  }
  ctx.putImageData(image, x, y0)
}

/** Rain, storm flashes, snow or fog over the whole scene; shared by every city view. */
export function drawWeatherOverlay(
  ctx: CanvasRenderingContext2D,
  p: Pick<CityPalette, "rain" | "snow" | "fog">,
  weather: CityWeather,
  width: number,
  height: number,
  t: number,
  fogTop: number,
): void {
  if (weather === "rain" || weather === "storm") {
    const drops = Math.round((width * height) / (weather === "storm" ? 260 : 520))
    ctx.fillStyle = p.rain
    for (let i = 0; i < drops; i++) {
      const speed = 140 + cellNoise(i, 0, 41) * 60
      const x0 = cellNoise(i, 1, 41) * (width + 40)
      const y = ((cellNoise(i, 2, 41) * height + t * speed) % (height + 8)) - 4
      const x = Math.round((x0 - y * 0.25) % (width + 40))
      ctx.fillRect(x, Math.round(y), 1, 3)
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
    const flakes = Math.round((width * height) / 700)
    ctx.fillStyle = p.snow
    for (let i = 0; i < flakes; i++) {
      const speed = 10 + cellNoise(i, 0, 43) * 14
      const y = (cellNoise(i, 1, 43) * height + t * speed) % height
      const x = (cellNoise(i, 2, 43) * width + Math.sin(t * 0.8 + i) * 4 + width) % width
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1)
    }
  } else if (weather === "fog") {
    ctx.fillStyle = p.fog
    for (let band = 0; band < 3; band++) {
      const drift = Math.round(Math.sin(t * 0.15 + band) * 20)
      ctx.fillRect(drift - 30, fogTop + band * 16, width + 60, 10)
    }
  }
}
