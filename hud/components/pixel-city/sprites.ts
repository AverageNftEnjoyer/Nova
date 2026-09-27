/**
 * Hand-placed sprites as character grids. Each character maps to a palette color at draw time; "." is transparent.
 * Larger, repetitive shapes (buildings, boats, laundry) are drawn procedurally in the renderer instead.
 */

export interface Sprite {
  width: number
  height: number
  rows: readonly string[]
}

function sprite(rows: readonly string[]): Sprite {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return { width, height: rows.length, rows }
}

/** The rooftop cat, seen from behind, watching the harbour. k = body. */
export const CAT_SITTING = sprite([
  ".k.....k.",
  ".kk...kk.",
  ".kkkkkkk.",
  "kkkkkkkkk",
  ".kkkkkkk.",
  "..kkkkk..",
  ".kkkkkkk.",
  "kkkkkkkkk",
  "kkkkkkkkk",
  "kkkkkkkkk",
  ".kkkkkkk.",
])

/** Asleep (Nova offline): a loaf with the tail wrapped round. */
export const CAT_ASLEEP = sprite([
  "..k...k......",
  "..kk.kk......",
  ".kkkkkkkkkk..",
  "kkkkkkkkkkkkk",
  "kkkkkkkkkkkkk",
  ".kkkkkkkkkkk.",
])

/** Pigeon, facing left. g = body, w = eye/neck sheen, o = feet. */
export const PIGEON = sprite([
  ".gg...",
  "gwgg..",
  ".ggggg",
  "..o.o.",
])

export const PIGEON_PECK = sprite([
  "......",
  ".gg...",
  "gwgggg",
  "..o.o.",
])

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  art: Sprite,
  x: number,
  y: number,
  colors: Readonly<Record<string, string>>,
  flip = false,
): void {
  const ox = Math.round(x)
  const oy = Math.round(y)
  for (let row = 0; row < art.height; row++) {
    const line = art.rows[row]
    for (let col = 0; col < line.length; col++) {
      const key = line[col]
      if (key === ".") continue
      const color = colors[key]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(ox + (flip ? art.width - 1 - col : col), oy + row, 1, 1)
    }
  }
}
