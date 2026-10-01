"use client"

import { useEffect, useRef, useState } from "react"
import { LocateFixed, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { ImageDistrictRenderer } from "./district/image-renderer"
import {
  camerasClose,
  clampCamera,
  easeCamera,
  initialCamera,
  panBy,
  revealRect,
  toView,
  zoomAround,
  zoomLimits,
  type Camera,
  type CameraView,
  type CameraViewport,
} from "./scene-camera"
import type { CityPlaceId, CityRect, CitySceneHit, CitySceneRenderer, CitySceneState } from "./types"

const FRAME_INTERVAL_MS = 1000 / 20
const REDUCED_MOTION_INTERVAL_MS = 1000
/** Camera easing time constant: the camera covers ~63% of the way to its target every this many ms. */
const EASE_TAU_MS = 90
/** A press that moves further than this (CSS px) is a drag, not a click. */
const DRAG_THRESHOLD_PX = 6
const KEY_ZOOM_STEP = 1.25
const KEY_PAN_FRACTION = 0.18
/** Space the Home HUD bar and footer player cover (CSS px); the camera keeps the whole city reachable around them. */
const DEFAULT_SAFE_TOP = 64
const DEFAULT_SAFE_BOTTOM = 76
/** Per-session camera memory (a per-viewer convenience; the scene works without it). */
const CAMERA_STORAGE_KEY = "nova.city.camera.v1"

export interface CityHotspot {
  id: CityPlaceId
  label: string
  /** Short live status shown under the label, e.g. "2 running". */
  detail?: string
}

interface PixelCitySceneProps {
  state: CitySceneState
  hotspots: readonly CityHotspot[]
  active: boolean
  onHotspot: (id: CityPlaceId) => void
  className?: string
  /** CSS pixels hidden under the HUD bar / footer; the camera lets the city be panned out from under them. */
  safeTop?: number
  safeBottom?: number
}

type AgentHit = Extract<CitySceneHit, { kind: "agent" }>

/** Imperative camera controls the buttons call into; set up by the scene's mount effect. */
interface CameraApi {
  zoomBy: (factor: number) => void
  recenter: () => void
}

interface StoredCamera {
  /** Zoom relative to the window's cover zoom, so it carries across window sizes. */
  zr: number
  cx: number
  cy: number
}

function loadStoredCamera(vp: CameraViewport): Camera | null {
  try {
    const raw = window.sessionStorage.getItem(CAMERA_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredCamera>
    if (typeof parsed.zr !== "number" || typeof parsed.cx !== "number" || typeof parsed.cy !== "number") return null
    return clampCamera({ zoom: parsed.zr * zoomLimits(vp).cover, cx: parsed.cx, cy: parsed.cy }, vp)
  } catch {
    return null
  }
}

function storeCamera(cam: Camera, vp: CameraViewport): void {
  try {
    const value: StoredCamera = { zr: cam.zoom / zoomLimits(vp).cover, cx: cam.cx, cy: cam.cy }
    window.sessionStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked (private window, previews): the camera just starts from the default framing next time.
  }
}

function sameView(a: CameraView | null, b: CameraView): boolean {
  return !!a && a.zoom === b.zoom && a.offsetX === b.offsetX && a.offsetY === b.offsetY
}

/**
 * Home's Nova City: the painted night city on a canvas at screen resolution, live characters and effects on top,
 * and every place as a focusable button that opens its popup. Animates at 20 fps only while `active`.
 *
 * A game-like camera frames it: drag (mouse or touch) to pan, wheel / pinch to zoom, arrows and +/- when focused.
 * The canvas is the viewport (device resolution); the renderer draws the plan through the camera transform, and the
 * buttons and agent tag are placed with the same transform.
 */
export function PixelCityScene({
  state,
  hotspots,
  active,
  onHotspot,
  className,
  safeTop = DEFAULT_SAFE_TOP,
  safeBottom = DEFAULT_SAFE_BOTTOM,
}: PixelCitySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CitySceneRenderer | null>(null)
  const [view, setView] = useState<CameraView | null>(null)
  const [rects, setRects] = useState<Partial<Record<CityPlaceId, CityRect>>>({})
  const [agentHover, setAgentHover] = useState<AgentHit | null>(null)
  const [dragging, setDragging] = useState(false)
  const apiRef = useRef<CameraApi | null>(null)
  const invalidateRef = useRef<() => void>(() => {})

  // Latest props for the long-lived listeners of the mount effect.
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const onHotspotRef = useRef(onHotspot)
  const safeRef = useRef({ top: safeTop, bottom: safeBottom })
  useEffect(() => {
    onHotspotRef.current = onHotspot
  }, [onHotspot])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    if (!rendererRef.current) rendererRef.current = new ImageDistrictRenderer(canvas)
    const renderer = rendererRef.current
    renderer.setState(stateRef.current)
    setRects(renderer.hotspots())
    const placeRects = renderer.hotspots()
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

    let vp: CameraViewport | null = null
    let dpr = 0
    let cam: Camera | null = null
    let target: Camera | null = null
    let lastView: CameraView | null = null
    let raf = 0
    let lastFrame = 0
    let lastAnim = 0
    let dirty = true
    let unsaved = false

    // Pointer gesture state (drag to pan, two-finger pinch); the listeners are below.
    const pointer = {
      down: false,
      dragged: false,
      suppressClick: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      pinchDist: 0,
    }
    const measureViewport = (): CameraViewport => ({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      safeTop: safeRef.current.top,
      safeBottom: safeRef.current.bottom,
    })

    const frame = (now: number) => {
      raf = 0
      if (!vp || !cam || !target) return
      const dt = lastFrame === 0 ? 16 : Math.min(100, now - lastFrame)
      lastFrame = now
      let moving = false
      if (!camerasClose(cam, target)) {
        const alpha = reducedMotion.matches ? 1 : 1 - Math.exp(-dt / EASE_TAU_MS)
        cam = clampCamera(easeCamera(cam, target, alpha), vp)
        if (camerasClose(cam, target)) cam = target
        moving = true
        dirty = true
      }
      if (dirty) {
        applyCamera()
        renderer.render(now / 1000)
        lastAnim = now
        dirty = false
      } else if (activeRef.current) {
        const interval = reducedMotion.matches ? REDUCED_MOTION_INTERVAL_MS : FRAME_INTERVAL_MS
        if (now - lastAnim >= interval) {
          renderer.render(now / 1000)
          lastAnim = now
        }
      }
      if (!moving && unsaved && !pointer.down) {
        storeCamera(cam, vp)
        unsaved = false
      }
      if (moving || activeRef.current) raf = window.requestAnimationFrame(frame)
      else lastFrame = 0
    }

    const kick = () => {
      if (!raf) raf = window.requestAnimationFrame(frame)
    }

    /** Pushes the current camera to the canvas backing, the renderer and the DOM overlay. */
    const applyCamera = () => {
      if (!vp || !cam) return
      const ratio = window.devicePixelRatio || 1
      if (ratio !== dpr) {
        dpr = ratio
        renderer.resize(vp.width * dpr, vp.height * dpr)
      }
      const raw = toView(cam, vp)
      // Snap the origin to whole device pixels so the painting and the overlay never sit half a pixel apart.
      const next: CameraView = { zoom: raw.zoom, offsetX: Math.round(raw.offsetX * dpr) / dpr, offsetY: Math.round(raw.offsetY * dpr) / dpr }
      renderer.setCamera(next.zoom * dpr, -next.offsetX / next.zoom, -next.offsetY / next.zoom)
      if (!sameView(lastView, next)) {
        lastView = next
        setView(next)
      }
    }

    /** Moves the camera: `immediate` for direct manipulation (drag, pinch), eased otherwise. */
    const moveTo = (next: Camera, immediate: boolean) => {
      if (!vp) return
      target = clampCamera(next, vp)
      if (immediate || reducedMotion.matches) cam = target
      dirty = true
      unsaved = true
      kick()
    }

    const onResize = () => {
      const next = measureViewport()
      if (vp && next.width === vp.width && next.height === vp.height && next.safeTop === vp.safeTop && next.safeBottom === vp.safeBottom) return
      const first = !vp
      vp = next
      renderer.resize(vp.width * (window.devicePixelRatio || 1), vp.height * (window.devicePixelRatio || 1))
      dpr = window.devicePixelRatio || 1
      if (first || !cam || !target) {
        cam = loadStoredCamera(vp) ?? initialCamera(vp)
        target = cam
      } else {
        cam = clampCamera(cam, vp)
        target = clampCamera(target, vp)
      }
      dirty = true
      kick()
    }
    onResize()
    const observer = new ResizeObserver(onResize)
    observer.observe(host)

    // ── Pointer: drag to pan, two-finger pinch, agent hover ─────────────────────
    const touches = new Map<number, { x: number; y: number }>()

    const local = (event: { clientX: number; clientY: number }) => {
      const bounds = host.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }

    // Agents are drawn on the canvas; the host tracks the pointer so hovering one shows its tag and clicking it opens
    // Agent Tasks (even when the agent stands over a building's button).
    const agentAt = (event: { clientX: number; clientY: number }): AgentHit | null => {
      if (!vp || !cam) return null
      const p = local(event)
      const v = lastView ?? toView(cam, vp)
      const hit = renderer.hitTest((p.x - v.offsetX) / v.zoom, (p.y - v.offsetY) / v.zoom)
      return hit && hit.kind === "agent" ? hit : null
    }

    let hover: AgentHit | null = null
    const setHover = (hit: AgentHit | null) => {
      if ((hit?.id ?? null) === (hover?.id ?? null) && hit?.anchorX === hover?.anchorX && hit?.anchorY === hover?.anchorY) return
      hover = hit
      setAgentHover(hit)
    }

    const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-camera-controls]")

    const onPointerDown = (event: PointerEvent) => {
      if (isControl(event.target)) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      const p = local(event)
      if (event.pointerType === "touch") touches.set(event.pointerId, p)
      if (touches.size === 2) {
        // Second finger: pinch. It is a gesture, never a click.
        const [a, b] = [...touches.values()]
        pointer.pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        pointer.lastX = (a.x + b.x) / 2
        pointer.lastY = (a.y + b.y) / 2
        pointer.dragged = true
        setDragging(true)
        try {
          host.setPointerCapture(event.pointerId)
        } catch {
          // The pointer may already be gone.
        }
        return
      }
      pointer.down = true
      pointer.dragged = false
      pointer.startX = pointer.lastX = p.x
      pointer.startY = pointer.lastY = p.y
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!vp || !target) return
      const p = local(event)
      if (event.pointerType === "touch" && touches.has(event.pointerId)) touches.set(event.pointerId, p)
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        let next = target
        if (pointer.pinchDist > 0 && dist > 0) next = zoomAround(next, dist / pointer.pinchDist, mx, my, vp)
        next = panBy(next, mx - pointer.lastX, my - pointer.lastY, vp)
        pointer.pinchDist = dist
        pointer.lastX = mx
        pointer.lastY = my
        moveTo(next, true)
        return
      }
      if (pointer.down) {
        if (!pointer.dragged && Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > DRAG_THRESHOLD_PX) {
          pointer.dragged = true
          setDragging(true)
          setHover(null)
          try {
            host.setPointerCapture(event.pointerId)
          } catch {
            // The pointer may already be gone.
          }
        }
        if (pointer.dragged) {
          moveTo(panBy(target, p.x - pointer.lastX, p.y - pointer.lastY, vp), true)
          pointer.lastX = p.x
          pointer.lastY = p.y
          return
        }
      }
      if (event.pointerType === "mouse") setHover(agentAt(event))
    }

    const onPointerEnd = (event: PointerEvent) => {
      touches.delete(event.pointerId)
      if (touches.size === 1) {
        // One finger lifted from a pinch: carry on panning with the other.
        const [rest] = [...touches.values()]
        pointer.down = true
        pointer.lastX = rest.x
        pointer.lastY = rest.y
        pointer.pinchDist = 0
        return
      }
      if (touches.size > 0) return
      if (!pointer.down && !pointer.dragged) return
      pointer.down = false
      if (pointer.dragged) {
        // The click that follows this release belongs to the drag, not to whatever building is under the pointer.
        pointer.suppressClick = true
        window.setTimeout(() => {
          pointer.suppressClick = false
        }, 0)
      }
      pointer.dragged = false
      setDragging(false)
      kick()
    }

    const onPointerLeave = () => {
      if (!pointer.down) setHover(null)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (isControl(event.target)) return
      if (pointer.suppressClick) {
        pointer.suppressClick = false
        event.stopPropagation()
        event.preventDefault()
        return
      }
      if (!agentAt(event)) return
      event.stopPropagation()
      event.preventDefault()
      onHotspotRef.current("tasks")
    }

    // ── Wheel / trackpad ────────────────────────────────────────────────────────
    const onWheel = (event: WheelEvent) => {
      if (!vp || !target) return
      event.preventDefault()
      const p = local(event)
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? vp.height : 1
      const dy = event.deltaY * unit
      const dx = event.deltaX * unit
      if (event.ctrlKey) {
        // Trackpad pinch (Chromium reports it as a ctrl+wheel): follow the fingers directly.
        moveTo(zoomAround(target, Math.exp(-dy * 0.01), p.x, p.y, vp), true)
        return
      }
      let next = zoomAround(target, Math.exp(-dy * 0.0015), p.x, p.y, vp)
      if (dx !== 0) next = panBy(next, -dx, 0, vp)
      moveTo(next, false)
    }

    // ── Keyboard ────────────────────────────────────────────────────────────────
    const onKeyDown = (event: KeyboardEvent) => {
      if (!vp || !target || event.altKey || event.ctrlKey || event.metaKey) return
      if (isControl(event.target)) return
      const cx = vp.width / 2
      const cy = vp.safeTop + (vp.height - vp.safeTop - vp.safeBottom) / 2
      const stepX = vp.width * KEY_PAN_FRACTION
      const stepY = vp.height * KEY_PAN_FRACTION
      let next: Camera | null = null
      switch (event.key) {
        case "ArrowLeft":
          next = panBy(target, stepX, 0, vp)
          break
        case "ArrowRight":
          next = panBy(target, -stepX, 0, vp)
          break
        case "ArrowUp":
          next = panBy(target, 0, stepY, vp)
          break
        case "ArrowDown":
          next = panBy(target, 0, -stepY, vp)
          break
        case "+":
        case "=":
          next = zoomAround(target, KEY_ZOOM_STEP, cx, cy, vp)
          break
        case "-":
        case "_":
          next = zoomAround(target, 1 / KEY_ZOOM_STEP, cx, cy, vp)
          break
        case "0":
        case "Home":
          next = initialCamera(vp)
          break
        default:
          return
      }
      event.preventDefault()
      moveTo(next, false)
    }

    // ── Focus: tabbing to a place that is off screen pans to it ──────────────────
    const resetAncestorScroll = () => {
      // Focusing a clipped button makes the browser scroll the nearest scroll container to it, which would slide the
      // whole Home layout; the camera does the moving instead.
      for (let el: HTMLElement | null = host; el; el = el.parentElement) {
        if (el.scrollTop !== 0) el.scrollTop = 0
        if (el.scrollLeft !== 0) el.scrollLeft = 0
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target
      if (!(el instanceof HTMLElement)) return
      resetAncestorScroll()
      window.requestAnimationFrame(resetAncestorScroll)
      const id = el.dataset.place as CityPlaceId | undefined
      if (!id || !vp || !target || !el.matches(":focus-visible")) return
      const rect = placeRects[id]
      if (!rect) return
      const next = revealRect(target, rect, vp)
      if (next) moveTo(next, false)
    }

    const onMotionChange = () => kick()

    host.addEventListener("pointerdown", onPointerDown)
    host.addEventListener("pointermove", onPointerMove)
    host.addEventListener("pointerup", onPointerEnd)
    host.addEventListener("pointercancel", onPointerEnd)
    host.addEventListener("pointerleave", onPointerLeave)
    host.addEventListener("click", onClickCapture, true)
    host.addEventListener("wheel", onWheel, { passive: false })
    host.addEventListener("keydown", onKeyDown)
    host.addEventListener("focusin", onFocusIn)
    reducedMotion.addEventListener("change", onMotionChange)

    invalidateRef.current = () => {
      dirty = true
      kick()
    }
    apiRef.current = {
      zoomBy: (factor) => {
        if (!vp || !target) return
        moveTo(zoomAround(target, factor, vp.width / 2, vp.safeTop + (vp.height - vp.safeTop - vp.safeBottom) / 2, vp), false)
      },
      recenter: () => {
        if (vp) moveTo(initialCamera(vp), false)
      },
    }

    return () => {
      observer.disconnect()
      host.removeEventListener("pointerdown", onPointerDown)
      host.removeEventListener("pointermove", onPointerMove)
      host.removeEventListener("pointerup", onPointerEnd)
      host.removeEventListener("pointercancel", onPointerEnd)
      host.removeEventListener("pointerleave", onPointerLeave)
      host.removeEventListener("click", onClickCapture, true)
      host.removeEventListener("wheel", onWheel)
      host.removeEventListener("keydown", onKeyDown)
      host.removeEventListener("focusin", onFocusIn)
      reducedMotion.removeEventListener("change", onMotionChange)
      if (raf) window.cancelAnimationFrame(raf)
      if (vp && cam) storeCamera(cam, vp)
      invalidateRef.current = () => {}
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    stateRef.current = state
    rendererRef.current?.setState(state)
    invalidateRef.current()
  }, [state])

  useEffect(() => {
    activeRef.current = active
    invalidateRef.current()
  }, [active])

  useEffect(() => {
    safeRef.current = { top: safeTop, bottom: safeBottom }
  }, [safeTop, safeBottom])

  const zoom = view?.zoom ?? 1
  const offsetX = view?.offsetX ?? 0
  const offsetY = view?.offsetY ?? 0

  // Front-most places (lowest on screen) come last in the DOM, so where two hit rects overlap the building that is
  // visually in front takes the click.
  const placedHotspots = view
    ? hotspots
        .flatMap((spot) => {
          const r = rects[spot.id]
          return r ? [{ spot, r }] : []
        })
        .sort((a, b) => a.r.y + a.r.h - (b.r.y + b.r.h))
    : []

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      role="application"
      aria-roledescription="city map"
      aria-label="Nova City. Drag or use the arrow keys to look around, scroll or press plus and minus to zoom, 0 to recenter."
      className={cn("pixel-camera absolute inset-0 overflow-clip", className)}
      data-scene="city"
      data-agent-hover={agentHover ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      {placedHotspots.map(({ spot, r }) => (
        <button
          key={spot.id}
          type="button"
          data-place={spot.id}
          onClick={() => onHotspot(spot.id)}
          className="pixel-hotspot group absolute"
          style={{ left: offsetX + r.x * zoom, top: offsetY + r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
          aria-label={spot.detail ? `${spot.label}: ${spot.detail}` : spot.label}
        >
          <span
            className="pixel-hotspot-marker"
            aria-hidden="true"
            style={
              r.markerX !== undefined && r.markerY !== undefined
                ? { left: (r.markerX - r.x) * zoom, top: (r.markerY - r.y) * zoom - 14 }
                : undefined
            }
          />
          <span className="pixel-hotspot-tag">
            <span className="pixel-hotspot-tag-label">{spot.label}</span>
            {spot.detail ? <span className="pixel-hotspot-tag-detail">{spot.detail}</span> : null}
          </span>
        </button>
      ))}
      {agentHover && !dragging ? (
        <div
          className="pixel-agent-tag"
          role="status"
          style={{ left: offsetX + agentHover.anchorX * zoom, top: offsetY + agentHover.anchorY * zoom - 8 }}
        >
          <span className="pixel-hotspot-tag-label">{agentHover.label}</span>
          <span className="pixel-hotspot-tag-detail">{agentHover.detail}</span>
        </div>
      ) : null}
      <div className="pixel-camera-controls" data-camera-controls="" style={{ bottom: safeBottom + 10 }}>
        <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => apiRef.current?.zoomBy(1 / KEY_ZOOM_STEP)} aria-label="Zoom out" title="Zoom out (-)">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => apiRef.current?.zoomBy(KEY_ZOOM_STEP)} aria-label="Zoom in" title="Zoom in (+)">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => apiRef.current?.recenter()} aria-label="Recenter the city" title="Recenter (0)">
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
