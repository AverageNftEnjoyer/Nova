import { Container, Graphics } from "pixi.js"

/** Pixel-art boats built once from rectangles on a small grid. They face east; flip with `scale.x = -1`. Origin: the hull's centre line at the waterline. */

const INK = 0x1b1530
const WAKE = 0xe8fbff

type Part = readonly [dx: number, dy: number, w: number, h: number, color: number, alpha?: number]

function build(unit: number, parts: readonly Part[]): Container {
  const root = new Container()
  const g = new Graphics()
  for (const [dx, dy, w, h, color, alpha] of parts) g.rect(dx * unit, dy * unit, w * unit, h * unit).fill({ color, alpha: alpha ?? 1 })
  root.addChild(g)
  return root
}

/** The sailboat of an active deployment run: hull, mast, sail, pennant and a wake behind the stern. */
export function buildRunBoat(hull: number, sail: number): Container {
  const parts: Part[] = [
    [-16, 2, 9, 1, WAKE, 0.6],
    [-13, 3, 7, 1, WAKE, 0.6],
    [-9, 0, 18, 1, INK],
    [-8, 1, 16, 2, hull],
    [-8, 1, 16, 1, 0xffffff],
    [-7, 3, 13, 1, INK],
    [7, -1, 3, 1, hull],
    [-1, -14, 1, 14, INK],
    [-1, -15, 3, 1, 0xe03a3a],
  ]
  for (let r = 0; r < 11; r++) parts.push([0, -12 + r, 1 + Math.floor(r * 0.7), 1, sail])
  return build(2, parts)
}

/** Cosmetic: a small fishing skiff with a cream sail and a teal pennant. Deliberately unlike the run boats. */
export function buildSkiff(): Container {
  const parts: Part[] = [
    [-9, 2, 6, 1, WAKE, 0.45],
    [-6, 0, 12, 1, INK],
    [-5, 1, 10, 2, 0x8a5a2e],
    [-5, 1, 10, 1, 0xd8b27a],
    [-4, 3, 8, 1, INK],
    [0, -9, 1, 9, INK],
    [0, -10, 2, 1, 0x1fb8a8],
  ]
  for (let r = 0; r < 7; r++) parts.push([1, -8 + r, 1 + Math.floor(r * 0.6), 1, 0xf4ead0])
  return build(2.2, parts)
}

/** Cosmetic: a rowing dinghy with one tiny oarsman. */
export function buildDinghy(): Container {
  const parts: Part[] = [
    [-8, 2, 5, 1, WAKE, 0.45],
    [-5, 0, 10, 1, INK],
    [-4, 1, 8, 2, 0xc9763a],
    [-4, 1, 8, 1, 0xf4ead0],
    [-3, 3, 6, 1, INK],
    [-1, -3, 2, 3, 0x3a6ea5],
    [-1, -4, 2, 1, 0xf0c8a0],
    [1, -1, 4, 1, INK],
  ]
  return build(2, parts)
}
