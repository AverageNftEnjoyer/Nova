/**
 * Nova City's camera: pure math for panning and zooming the painted city inside the Home window.
 *
 * Coordinates: "plan" pixels are the painting's own pixels (DISTRICT_IMAGE_WIDTH x DISTRICT_IMAGE_HEIGHT); "screen"
 * pixels are CSS pixels inside the scene host. The camera is a zoom (CSS pixels per plan pixel) plus the plan point
 * shown at the centre of the safe area, the band between the HUD bar and the footer player.
 */

import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_WIDTH } from "./district/image-plan"
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

export interface ZoomLimits {
  /** Whole city visible inside the safe area. */
  min: number
  /** City covers the whole window (no empty band on any side). */
  cover: number
  max: number
}

/** The middle of the city, just under Nova HQ's tower: the initial framing centres here. */
export const CITY_FOCUS = { x: 1290, y: 700 } as const

/** Upper zoom bound: at least 2 CSS px per plan pixel, and at least twice the cover zoom on very large screens. */
const MAX_ZOOM_FLOOR = 2
const MAX_ZOOM_OVER_COVER = 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function safeHeight(vp: CameraViewport): number {
  return Math.max(1, vp.height - vp.safeTop - vp.safeBottom)
}

export function zoomLimits(vp: CameraViewport): ZoomLimits {
  const cover = Math.max(vp.width / DISTRICT_IMAGE_WIDTH, vp.height / DISTRICT_IMAGE_HEIGHT)
  const min = Math.min(vp.width / DISTRICT_IMAGE_WIDTH, safeHeight(vp) / DISTRICT_IMAGE_HEIGHT)
  return { min, cover, max: Math.max(MAX_ZOOM_FLOOR, cover * MAX_ZOOM_OVER_COVER) }
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
 * Keeps the zoom in range and the painting on screen. Along an axis where the city is larger than the window it may
 * be panned edge to edge; vertically the edges may also come out from under the HUD and the footer so nothing stays
 * hidden. Along an axis where the city is smaller, it is centred (in the safe area, vertically).
 */
export function clampCamera(cam: Camera, vp: CameraViewport): Camera {
  const limits = zoomLimits(vp)
  const zoom = clamp(Number.isFinite(cam.zoom) ? cam.zoom : limits.cover, limits.min, limits.max)
  const view = toView({ zoom, cx: Number.isFinite(cam.cx) ? cam.cx : CITY_FOCUS.x, cy: Number.isFinite(cam.cy) ? cam.cy : CITY_FOCUS.y }, vp)
  const iw = DISTRICT_IMAGE_WIDTH * zoom
  const ih = DISTRICT_IMAGE_HEIGHT * zoom
  const sh = safeHeight(vp)
  const offsetX = iw <= vp.width ? (vp.width - iw) / 2 : clamp(view.offsetX, vp.width - iw, 0)
  const offsetY = ih <= sh ? vp.safeTop + (sh - ih) / 2 : clamp(view.offsetY, vp.height - vp.safeBottom - ih, vp.safeTop)
  return fromView({ zoom, offsetX, offsetY }, vp)
}

/** The default framing for this window: the city covers the window, centred on the middle of town. */
export function initialCamera(vp: CameraViewport): Camera {
  return clampCamera({ zoom: zoomLimits(vp).cover, cx: CITY_FOCUS.x, cy: CITY_FOCUS.y }, vp)
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

/**
 * A camera that shows `rect` (plan pixels) inside the safe area, or null when it is already fully visible there.
 * Zooms out only when the rect cannot fit at the current zoom.
 */
export function revealRect(cam: Camera, rect: CityRect, vp: CameraViewport, margin = 24): Camera | null {
  const view = toView(cam, vp)
  const left = view.offsetX + rect.x * view.zoom
  const top = view.offsetY + rect.y * view.zoom
  const right = left + rect.w * view.zoom
  const bottom = top + rect.h * view.zoom
  if (left >= 0 && right <= vp.width && top >= vp.safeTop && bottom <= vp.height - vp.safeBottom) return null
  const fit = Math.min((vp.width - margin * 2) / rect.w, (safeHeight(vp) - margin * 2) / rect.h)
  return clampCamera({ zoom: Math.min(cam.zoom, fit), cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 }, vp)
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
