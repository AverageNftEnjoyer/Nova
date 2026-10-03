import { Sprite, Texture } from "pixi.js"
import { draw5 } from "../font5x7"

/** A flat-coloured rectangle in plan pixels (a scaled white texel, tinted). */
export function rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): Sprite {
  const s = new Sprite(Texture.WHITE)
  s.position.set(x, y)
  s.width = w
  s.height = h
  s.tint = color
  s.alpha = alpha
  return s
}

export function hexToNumber(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16)
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D is unavailable")
  return { canvas, ctx }
}

let softCircle: Texture | null = null
/** A white disc fading to transparent at its edge: glows, mist, cloud shadows, soft shadows. Tint and scale it. */
export function softCircleTexture(): Texture {
  if (softCircle) return softCircle
  const size = 64
  const { canvas, ctx } = makeCanvas(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, "rgba(255,255,255,1)")
  g.addColorStop(0.45, "rgba(255,255,255,0.45)")
  g.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  softCircle = Texture.from(canvas)
  return softCircle
}

let hardEllipse: Texture | null = null
/** A solid white ellipse (the contact shadow under a figure). */
export function ellipseTexture(): Texture {
  if (hardEllipse) return hardEllipse
  const { canvas, ctx } = makeCanvas(32, 16)
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  ctx.ellipse(16, 8, 15, 7, 0, 0, Math.PI * 2)
  ctx.fill()
  hardEllipse = Texture.from(canvas)
  return hardEllipse
}

const glyphs = new Map<string, Texture>()
/** One 5x7 glyph in `color`, hard-edged (badges over agents, U.B Agents' sleeping Z). */
export function glyphTexture(char: string, color: string): Texture {
  const key = `${char}${color}`
  const cached = glyphs.get(key)
  if (cached) return cached
  const { canvas, ctx } = makeCanvas(5, 7)
  draw5(ctx, char, 0, 0, color)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = "nearest"
  glyphs.set(key, texture)
  return texture
}

/** A tile of scattered single pixels / short streaks for the tiling weather layers. */
export function tileTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const { canvas, ctx } = makeCanvas(size, size)
  draw(ctx)
  const texture = Texture.from(canvas)
  texture.source.scaleMode = "nearest"
  return texture
}
