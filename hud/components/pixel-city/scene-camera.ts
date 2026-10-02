/**
 * Nova City's camera: pure math for panning and zooming the painted city inside the Home window. The default view is
 * also the closest zoom (`zoomLimits().max`); the user can zoom out until the whole map fits in the window.
 *
 * Coordinates: "plan" pixels are the painting's own pixels (DISTRICT_IMAGE_WIDTH x DISTRICT_IMAGE_HEIGHT); the drawn
 * map (DISTRICT_MAP) is larger and extends past them on every side. "Screen" pixels are CSS pixels inside the scene
 * host. Along an axis where the map is larger than the window it pans edge to edge, never past an edge; where it is smaller (zoomed far out) it is centred on the sea. The camera is a zoom (CSS pixels per plan pixel) plus the plan point
 * shown at the centre of the safe area, the band between the HUD bar and the footer player.
 */

import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_WIDTH, DISTRICT_MAP } from "./district/image-plan"
import type { CityRect } from "./types"

export interface CameraViewport {
  /** Scene host size in CSS pixels. */
  width: number
  height: number
  /** CSS pixels covered by the HUD bar (top) and the footer player (bottom). */
  safeTop: number
  safeBottom: number
}

export interface Camera {
  /** CSS pixels per plan pixel. */
  zoom: number
  /** Plan point at the centre of the safe area. */
  cx: number
  cy: number
}

/** Where the plan's origin lands on screen, in CSS pixels, at `zoom`. */
export interface CameraView {
  zoom: number
  offsetX: number
  offsetY: number
}

/** The middle of the island, by the Town Hall: the initial framing centres here. */
export const CITY_FOCUS = { x: 768, y: 500 } as const

export interface ZoomLimits {
  /** Furthest out: the whole map fits in the window (contain fit); the spare sides are the sea colour. */
  min: number
  /** Closest in, and the default view. */
  max: number
}

/** How much closer than "the city painting just covers the window" the default (and closest) view sits. */
const VIEW_ZOOM_BOOST = 1.12

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function safeHeight(vp: CameraViewport): number {
  return Math.max(1, vp.height - vp.safeTop - vp.safeBottom)
}

/**
 * Zoom range for this window. min: the whole map fits in it. max (the default view): the city painting covers it, a
 * little closer (VIEW_ZOOM_BOOST); zooming in further only showed the painting's blur.
 */
export function zoomLimits(vp: CameraViewport): ZoomLimits {
  const min = Math.min(vp.width / DISTRICT_MAP.w, vp.height / DISTRICT_MAP.h)
  const cityCover = Math.max(vp.width / DISTRICT_IMAGE_WIDTH, vp.height / DISTRICT_IMAGE_HEIGHT)
  return { min, max: Math.max(min, cityCover * VIEW_ZOOM_BOOST) }
}

export function toView(cam: Camera, vp: CameraViewport): CameraView {
  return {
    zoom: cam.zoom,
    offsetX: vp.width / 2 - cam.cx * cam.zoom,
    offsetY: vp.safeTop + safeHeight(vp) / 2 - cam.cy * cam.zoom,
  }
}

function fromView(view: CameraView, vp: CameraViewport): Camera {
  return {
    zoom: view.zoom,
    cx: (vp.width / 2 - view.offsetX) / view.zoom,
    cy: (vp.safeTop + safeHeight(vp) / 2 - view.offsetY) / view.zoom,
  }
}

/**
 * Keeps the zoom in range. Along an axis where the map is larger than the window it may be panned edge to edge, never
 * past an edge; along an axis where it is smaller it is centred.
 */
export function clampCamera(cam: Camera, vp: CameraViewport): Camera {
  const limits = zoomLimits(vp)
  const zoom = clamp(Number.isFinite(cam.zoom) ? cam.zoom : limits.max, limits.min, limits.max)
  const view = toView({ zoom, cx: Number.isFinite(cam.cx) ? cam.cx : CITY_FOCUS.x, cy: Number.isFinite(cam.cy) ? cam.cy : CITY_FOCUS.y }, vp)
  const offsetX = clampEdges(view.offsetX, vp.width - (DISTRICT_MAP.x + DISTRICT_MAP.w) * zoom, -DISTRICT_MAP.x * zoom)
  const offsetY = clampEdges(view.offsetY, vp.height - (DISTRICT_MAP.y + DISTRICT_MAP.h) * zoom, -DISTRICT_MAP.y * zoom)
  return fromView({ zoom, offsetX, offsetY }, vp)
}

/** Clamps an offset between its edge limits; when they cross (the map is narrower than the window), centres it. */
function clampEdges(v: number, lo: number, hi: number): number {
  return lo <= hi ? clamp(v, lo, hi) : (lo + hi) / 2
}

/** The default framing for this window: the closest zoom, centred on the middle of town. */
export function initialCamera(vp: CameraViewport): Camera {
  return clampCamera({ zoom: zoomLimits(vp).max, cx: CITY_FOCUS.x, cy: CITY_FOCUS.y }, vp)
}

/** Zooms by `factor`, keeping the plan point under screen point (`sx`, `sy`) where it is. */
export function zoomAround(cam: Camera, factor: number, sx: number, sy: number, vp: CameraViewport): Camera {
  const limits = zoomLimits(vp)
  const view = toView(cam, vp)
  const px = (sx - view.offsetX) / view.zoom
  const py = (sy - view.offsetY) / view.zoom
  const zoom = clamp(cam.zoom * factor, limits.min, limits.max)
  return clampCamera(fromView({ zoom, offsetX: sx - px * zoom, offsetY: sy - py * zoom }, vp), vp)
}

/** Moves the city by (`dx`, `dy`) screen pixels, as a drag does. */
export function panBy(cam: Camera, dx: number, dy: number, vp: CameraViewport): Camera {
  return clampCamera({ zoom: cam.zoom, cx: cam.cx - dx / cam.zoom, cy: cam.cy - dy / cam.zoom }, vp)
}

/** A camera centred on `rect` (plan pixels), or null when it is already fully visible inside the safe area. */
export function revealRect(cam: Camera, rect: CityRect, vp: CameraViewport): Camera | null {
  const view = toView(cam, vp)
  const left = view.offsetX + rect.x * view.zoom
  const top = view.offsetY + rect.y * view.zoom
  const right = left + rect.w * view.zoom
  const bottom = top + rect.h * view.zoom
  if (left >= 0 && right <= vp.width && top >= vp.safeTop && bottom <= vp.height - vp.safeBottom) return null
  return clampCamera({ zoom: cam.zoom, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 }, vp)
}

/** Eases `from` towards `to`; `alpha` in 0..1. Zoom moves in log space so zooming feels even at every level. */
export function easeCamera(from: Camera, to: Camera, alpha: number): Camera {
  return {
    zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * alpha),
    cx: from.cx + (to.cx - from.cx) * alpha,
    cy: from.cy + (to.cy - from.cy) * alpha,
  }
}

/** True when two cameras are within a fraction of a screen pixel of each other. */
export function camerasClose(a: Camera, b: Camera): boolean {
  return Math.abs(a.zoom - b.zoom) / b.zoom < 0.0005 && Math.abs(a.cx - b.cx) * b.zoom < 0.25 && Math.abs(a.cy - b.cy) * b.zoom < 0.25
}
