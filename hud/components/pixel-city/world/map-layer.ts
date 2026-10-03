import { Container, ImageSource, Sprite, Texture } from "pixi.js"
import { DISTRICT_MAP, DISTRICT_OCCLUDERS, type DistrictOccluder } from "../district/image-plan"
import { WATER_MASK } from "./world-config"

/**
 * The painted map as GPU textures: the map sprite (tiled if the GPU cannot hold it whole), the structure cut-outs that
 * hide walkers standing behind them, and the water cells read from the map's own pixels. Everything is positioned in
 * plan pixels from DISTRICT_MAP; the image's real pixel size only sets the sprite scale.
 */

export function loadMapImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = "async"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load the city map (${src})`))
    image.src = src
  })
}

/**
 * Magnified (zoomed past one device pixel per map pixel) the map is nearest-neighbour: crisp pixels, no blur.
 * Minified, which is the normal case since the default view already shows the map smaller than its source, it is
 * trilinear with mipmaps: nearest there drops pixels and shimmers while panning.
 */
function mapSource(resource: HTMLImageElement | HTMLCanvasElement): ImageSource {
  return new ImageSource({ resource, autoGenerateMipmaps: true, magFilter: "nearest", minFilter: "linear", mipmapFilter: "linear" })
}

/** Plan pixels per source pixel of the map image. */
function planPerSource(image: HTMLImageElement): { x: number; y: number } {
  return { x: DISTRICT_MAP.w / image.naturalWidth, y: DISTRICT_MAP.h / image.naturalHeight }
}

/** The map as one sprite, or as tiles no bigger than the GPU's texture limit. */
export function buildMapSprites(image: HTMLImageElement, maxTextureSize: number): Container {
  const container = new Container()
  const k = planPerSource(image)
  const nw = image.naturalWidth
  const nh = image.naturalHeight
  if (nw <= maxTextureSize && nh <= maxTextureSize) {
    const sprite = new Sprite(new Texture({ source: mapSource(image) }))
    sprite.position.set(DISTRICT_MAP.x, DISTRICT_MAP.y)
    sprite.scale.set(k.x, k.y)
    container.addChild(sprite)
    return container
  }
  // Tiles overlap by one source pixel so filtering never opens a seam.
  const tile = Math.max(256, Math.min(maxTextureSize, 4096)) - 1
  for (let ty = 0; ty < nh; ty += tile) {
    for (let tx = 0; tx < nw; tx += tile) {
      const w = Math.min(tile + 1, nw - tx)
      const h = Math.min(tile + 1, nh - ty)
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      canvas.getContext("2d")?.drawImage(image, tx, ty, w, h, 0, 0, w, h)
      const sprite = new Sprite(new Texture({ source: mapSource(canvas) }))
      sprite.position.set(DISTRICT_MAP.x + tx * k.x, DISTRICT_MAP.y + ty * k.y)
      sprite.scale.set(k.x, k.y)
      container.addChild(sprite)
    }
  }
  return container
}

export interface OccluderSprite {
  sprite: Sprite
  /** Depth: walkers whose feet are at or below this y stand in front of the structure. */
  baseY: number
}

/**
 * One sprite per DISTRICT_OCCLUDERS entry: the map's own pixels inside the structure's outline, sitting exactly over
 * the map. The sprite's depth (zIndex) is the structure's front ground line, so a walker with its feet above that line
 * is drawn under it and is hidden by it, and a walker in front of it is not. A sloping base line uses its mean height.
 */
export function buildOccluders(image: HTMLImageElement): OccluderSprite[] {
  const k = planPerSource(image)
  return DISTRICT_OCCLUDERS.map((o: DistrictOccluder) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const shape of o.shapes) {
      for (const [x, y] of shape) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
    const w = Math.max(1, Math.ceil((x1 - x0) / k.x))
    const h = Math.max(1, Math.ceil((y1 - y0) / k.y))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.beginPath()
      for (const shape of o.shapes) {
        shape.forEach(([x, y], i) => {
          const px = (x - x0) / k.x
          const py = (y - y0) / k.y
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
      }
      ctx.clip()
      ctx.drawImage(image, (x0 - DISTRICT_MAP.x) / k.x, (y0 - DISTRICT_MAP.y) / k.y, w, h, 0, 0, w, h)
    }
    const sprite = new Sprite(new Texture({ source: mapSource(canvas) }))
    sprite.position.set(x0, y0)
    sprite.scale.set(k.x, k.y)
    const baseY = o.base.reduce((sum, p) => sum + p[1], 0) / o.base.length
    return { sprite, baseY }
  })
}

/** Plan-pixel centres of the map's open water, found from its colours (see WATER_MASK). */
export function sampleWaterCells(image: HTMLImageElement): Array<{ x: number; y: number; size: number }> {
  const cell = WATER_MASK.cell
  const cw = Math.floor(image.naturalWidth / cell)
  const ch = Math.floor(image.naturalHeight / cell)
  const canvas = document.createElement("canvas")
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return []
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(image, 0, 0, cw, ch)
  const px = ctx.getImageData(0, 0, cw, ch).data
  const water = new Uint8Array(cw * ch)
  for (let i = 0; i < cw * ch; i++) {
    const r = px[i * 4] / 255
    const g = px[i * 4 + 1] / 255
    const b = px[i * 4 + 2] / 255
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    if (max < WATER_MASK.minValue || d / (max || 1) < WATER_MASK.minSaturation || max !== b) continue
    const hue = 240 + (60 * (r - g)) / (d || 1)
    if (hue >= WATER_MASK.hueMin && hue <= WATER_MASK.hueMax) water[i] = 1
  }
  const k = planPerSource(image)
  const out: Array<{ x: number; y: number; size: number }> = []
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x
      if (!water[i] || !water[i - 1] || !water[i + 1] || !water[i - cw] || !water[i + cw]) continue
      out.push({ x: DISTRICT_MAP.x + x * cell * k.x, y: DISTRICT_MAP.y + y * cell * k.y, size: cell * k.x })
    }
  }
  return out
}
