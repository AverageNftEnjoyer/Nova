"use client"

import { useEffect, useRef, useState } from "react"
import { LocateFixed, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { DISTRICT_MAP, DISTRICT_PLACES, DISTRICT_SEA_COLOR } from "./district/image-plan"
import { clampCamera, initialCamera, toView, zoomLimits, type Camera, type CameraView, type CameraViewport } from "./scene-camera"
import type { CityBootPhase } from "./boot"
import type { CityWorld } from "./world/world-types"
import type { ResidentId } from "@/lib/town/residents"
import { agentResidentId, type CityPlaceId, type CityRect, type CitySceneHit, type CitySceneState } from "./types"

/** Plan-pixel box of a resident's focusable button around its feet (a figure is ~27 px tall). */
const RESIDENT_BOX_W = 20
const RESIDENT_BOX_H = 34
/** A press that moves further than this (CSS px) is a drag, not a click. */
const DRAG_THRESHOLD_PX = 6
const KEY_ZOOM_STEP = 1.25
const KEY_PAN_FRACTION = 0.18
/** Space the Home HUD bar and footer player cover (CSS px); the camera keeps the whole city reachable around them. */
const DEFAULT_SAFE_TOP = 12
const DEFAULT_SAFE_BOTTOM = 12
/** Per-session camera memory (a per-viewer convenience; the scene works without it). */
const CAMERA_STORAGE_KEY = "nova.city.camera.v1"
const CAMERA_SAVE_DELAY_MS = 400

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
  /**
   * The world moved to the next real load stage (charts while the engine chunk loads, engine once it has, map once
   * the painting is decoded, gates once the first frame is drawn). Home's boot screen follows this.
   */
  onBoot?: (phase: CityBootPhase) => void
  /** A resident was clicked or activated (an agent, or an integration's worker): open its card. Without it, clicking one opens the "tasks" place. */
  onResident?: (id: ResidentId) => void
  className?: string
  /** CSS pixels hidden under the HUD bar / footer; the camera lets the city be panned out from under them. */
  safeTop?: number
  safeBottom?: number
}

type ResidentHit = Extract<CitySceneHit, { kind: "resident" }>
type RendererKind = "pending" | "pixi" | "static"

/** Every place's hit rectangle in plan pixels (static art data). */
const PLACE_RECTS: Partial<Record<CityPlaceId, CityRect>> = Object.fromEntries(DISTRICT_PLACES.map((place) => [place.id, place.hit]))

interface StoredCamera {
  /** Zoom relative to the window's closest zoom, so it carries across window sizes. */
  zr: number
  cx: number
  cy: number
}

function loadStoredCamera(vp: CameraViewport): Camera | null {
  try {
    const raw = window.sessionStorage.getItem(CAMERA_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredCamera>
    if (typeof parsed.cx !== "number" || typeof parsed.cy !== "number") return null
    const zr = typeof parsed.zr === "number" ? parsed.zr : 1
    return clampCamera({ zoom: zr * zoomLimits(vp).max, cx: parsed.cx, cy: parsed.cy }, vp)
  } catch {
    return null
  }
}

function storeCamera(cam: Camera, vp: CameraViewport): void {
  try {
    const value: StoredCamera = { zr: cam.zoom / zoomLimits(vp).max, cx: cam.cx, cy: cam.cy }
    window.sessionStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage blocked (private window, previews): the camera just starts from the default framing next time.
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])
  return reduced
}

/**
 * Home's U.B Agents City: the painted city as a PixiJS (WebGL) world (world/pixi-world.ts) with a pixi-viewport camera, live
 * characters, ambient life and a day/night cycle, and every place as a focusable DOM button that opens its popup.
 *
 * The map always covers the window and the camera cannot leave it; drag (mouse or touch, with inertia), wheel and
 * pinch zoom between the cover fit and the default closest view, arrow keys pan, +/- zoom, 0 recentres. Clicking a
 * building glides the camera to it and then opens its room. The canvas draws the world; the buttons and the resident
 * tag are placed with the camera's transform (`view`), and each resident's button follows its figure (placed
 * imperatively every frame, so React does not re-render 60 times a second for it).
 *
 * Without WebGL the map is shown as a static image (default framing) with the same buttons over it.
 */
export function PixelCityScene({
  state,
  hotspots,
  active,
  onHotspot,
  onBoot,
  onResident,
  className,
  safeTop = DEFAULT_SAFE_TOP,
  safeBottom = DEFAULT_SAFE_BOTTOM,
}: PixelCitySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<CityWorld | null>(null)
  const [renderer, setRenderer] = useState<RendererKind>("pending")
  const [view, setView] = useState<CameraView | null>(null)
  const [agentHover, setAgentHover] = useState<ResidentHit | null>(null)
  const residentButtons = useRef(new Map<string, HTMLButtonElement>())
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const remeasureRef = useRef<() => void>(() => {})
  const reducedMotion = usePrefersReducedMotion()

  // Latest props for the long-lived listeners of the mount effect.
  const stateRef = useRef(state)
  const activeRef = useRef(active)
  const onHotspotRef = useRef(onHotspot)
  const onResidentRef = useRef(onResident)
  const onBootRef = useRef(onBoot)
  const safeRef = useRef({ top: safeTop, bottom: safeBottom })
  useEffect(() => {
    onHotspotRef.current = onHotspot
    onResidentRef.current = onResident
    onBootRef.current = onBoot
  }, [onHotspot, onResident, onBoot])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let world: CityWorld | null = null
    let vp: CameraViewport
    let lastView: CameraView | null = null
    let saveTimer = 0
    let fallback = false

    const measureViewport = (): CameraViewport => ({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      safeTop: safeRef.current.top,
      safeBottom: safeRef.current.bottom,
    })
    vp = measureViewport()

    /** Moves each resident's focusable button onto its figure (imperatively: figures move every frame). */
    const placeResidents = () => {
      if (!world || !lastView) return
      const v = lastView
      for (const anchor of world.residents()) {
        const el = residentButtons.current.get(anchor.id)
        if (!el) continue
        el.style.display = anchor.visible ? "block" : "none"
        if (!anchor.visible) continue
        el.style.left = `${v.offsetX + (anchor.x - RESIDENT_BOX_W / 2) * v.zoom}px`
        el.style.top = `${v.offsetY + (anchor.y - RESIDENT_BOX_H) * v.zoom}px`
        el.style.width = `${RESIDENT_BOX_W * v.zoom}px`
        el.style.height = `${RESIDENT_BOX_H * v.zoom}px`
      }
    }

    const onView = (next: CameraView) => {
      lastView = next
      setView(next)
      host.dataset.zoom = next.zoom.toFixed(4)
      host.dataset.offset = `${next.offsetX.toFixed(1)},${next.offsetY.toFixed(1)}`
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        if (world) storeCamera(world.getCamera(), vp)
      }, CAMERA_SAVE_DELAY_MS)
    }

    const onResize = () => {
      const next = measureViewport()
      if (next.width === vp.width && next.height === vp.height && next.safeTop === vp.safeTop && next.safeBottom === vp.safeBottom) return
      vp = next
      if (world) world.resize(vp)
      else if (fallback) onView(toView(initialCamera(vp), vp))
    }
    remeasureRef.current = onResize
    const observer = new ResizeObserver(onResize)
    observer.observe(host)

    const reportBoot = (phase: CityBootPhase) => {
      if (!cancelled) onBootRef.current?.(phase)
    }

    void (async () => {
      try {
        // PixiJS is client-only and heavy: it is loaded here, never during server rendering.
        reportBoot("charts")
        const { createCityWorld } = await import("./world/pixi-world")
        // React development double-mounts the scene: the first mount is already cancelled, so skip building its world.
        if (cancelled) return
        reportBoot("engine")
        const created = await createCityWorld({
          host,
          viewport: vp,
          state: stateRef.current,
          active: activeRef.current,
          reducedMotion,
          initialCamera: (v) => loadStoredCamera(v) ?? initialCamera(v),
          onView,
          onFrame: placeResidents,
          onBoot: reportBoot,
        })
        if (cancelled) {
          created.destroy()
          return
        }
        world = created
        worldRef.current = created
        // The window may have changed size while the world was loading.
        const now = measureViewport()
        if (now.width !== vp.width || now.height !== vp.height) {
          vp = now
          created.resize(vp)
        }
        onView(created.getView())
        host.dataset.renderer = "pixi"
        host.dataset.ready = "true"
        reportBoot("gates")
        setRenderer("pixi")
      } catch (error) {
        if (cancelled) return
        console.warn("[nova-city] WebGL is unavailable; showing the static map.", error)
        fallback = true
        host.dataset.renderer = "static"
        host.dataset.ready = "true"
        reportBoot("gates")
        setRenderer("static")
        onView(toView(initialCamera(vp), vp))
      }
    })()

    // ── Pointer: click-vs-drag bookkeeping and resident hover (pan, zoom and pinch are pixi-viewport's) ─────────────
    const pointer = { down: false, dragged: false, suppressClick: false, startX: 0, startY: 0 }
    const touches = new Set<number>()

    const local = (event: { clientX: number; clientY: number }) => {
      const bounds = host.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }

    // Residents are drawn on the canvas; the host tracks the pointer. Hovering one shows its tag and clicking it opens
    // its card (even when it stands over a building's button).
    const personAt = (event: { clientX: number; clientY: number }): ResidentHit | null => {
      if (!world || !lastView) return null
      const p = local(event)
      const hit = world.hitTest((p.x - lastView.offsetX) / lastView.zoom, (p.y - lastView.offsetY) / lastView.zoom)
      return hit && hit.kind === "resident" ? hit : null
    }
    const openResident = (id: ResidentId) => {
      if (onResidentRef.current) onResidentRef.current(id)
      else onHotspotRef.current("tasks")
    }

    let hover: ResidentHit | null = null
    const setHover = (hit: ResidentHit | null) => {
      if ((hit?.id ?? null) === (hover?.id ?? null) && hit?.anchorX === hover?.anchorX && hit?.anchorY === hover?.anchorY) return
      hover = hit
      setAgentHover(hit)
    }

    const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-camera-controls]")

    const setDrag = (on: boolean) => {
      draggingRef.current = on
      setDragging(on)
      if (on) world?.setHover(null)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (isControl(event.target)) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      if (event.pointerType === "touch") touches.add(event.pointerId)
      const p = local(event)
      if (touches.size >= 2) {
        // Second finger: a pinch. It is a gesture, never a click.
        pointer.dragged = true
        setDrag(true)
        return
      }
      pointer.down = true
      pointer.dragged = false
      pointer.startX = p.x
      pointer.startY = p.y
    }

    const onPointerMove = (event: PointerEvent) => {
      const p = local(event)
      if (pointer.down && !pointer.dragged && Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > DRAG_THRESHOLD_PX) {
        pointer.dragged = true
        setHover(null)
        setDrag(true)
      }
      if (!pointer.dragged && event.pointerType === "mouse") setHover(personAt(event))
    }

    const onPointerEnd = (event: PointerEvent) => {
      touches.delete(event.pointerId)
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
      setDrag(false)
    }

    const onPointerLeave = () => {
      if (pointer.down) return
      setHover(null)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (isControl(event.target)) return
      if (pointer.suppressClick) {
        pointer.suppressClick = false
        event.stopPropagation()
        event.preventDefault()
        return
      }
      // A keyboard activation of a resident's own button is handled by that button.
      if (event.target instanceof Element && event.target.closest("[data-resident]")) return
      const hit = personAt(event)
      if (hit) {
        event.stopPropagation()
        event.preventDefault()
        openResident(hit.id)
      }
    }

    // ── Keyboard ────────────────────────────────────────────────────────────────
    const onKeyDown = (event: KeyboardEvent) => {
      if (!world || event.altKey || event.ctrlKey || event.metaKey) return
      if (isControl(event.target)) return
      const stepX = vp.width * KEY_PAN_FRACTION
      const stepY = vp.height * KEY_PAN_FRACTION
      switch (event.key) {
        case "ArrowLeft":
          world.panBy(stepX, 0)
          break
        case "ArrowRight":
          world.panBy(-stepX, 0)
          break
        case "ArrowUp":
          world.panBy(0, stepY)
          break
        case "ArrowDown":
          world.panBy(0, -stepY)
          break
        case "+":
        case "=":
          world.zoomBy(KEY_ZOOM_STEP)
          break
        case "-":
        case "_":
          world.zoomBy(1 / KEY_ZOOM_STEP)
          break
        case "0":
        case "Home":
          world.recenter()
          break
        default:
          return
      }
      event.preventDefault()
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
      if (!world || !el.matches(":focus-visible")) return
      if (el.dataset.resident) {
        const anchor = world.residents().find((candidate) => candidate.id === el.dataset.resident)
        if (anchor) world.revealRect({ x: anchor.x - RESIDENT_BOX_W, y: anchor.y - RESIDENT_BOX_H, w: RESIDENT_BOX_W * 2, h: RESIDENT_BOX_H + 6 })
        return
      }
      const id = el.dataset.place as CityPlaceId | undefined
      const rect = id ? PLACE_RECTS[id] : undefined
      if (rect) world.revealRect(rect)
    }

    host.addEventListener("pointerdown", onPointerDown)
    host.addEventListener("pointermove", onPointerMove)
    host.addEventListener("pointerup", onPointerEnd)
    host.addEventListener("pointercancel", onPointerEnd)
    host.addEventListener("pointerleave", onPointerLeave)
    host.addEventListener("click", onClickCapture, true)
    host.addEventListener("keydown", onKeyDown)
    host.addEventListener("focusin", onFocusIn)

    return () => {
      cancelled = true
      observer.disconnect()
      host.removeEventListener("pointerdown", onPointerDown)
      host.removeEventListener("pointermove", onPointerMove)
      host.removeEventListener("pointerup", onPointerEnd)
      host.removeEventListener("pointercancel", onPointerEnd)
      host.removeEventListener("pointerleave", onPointerLeave)
      host.removeEventListener("click", onClickCapture, true)
      host.removeEventListener("keydown", onKeyDown)
      host.removeEventListener("focusin", onFocusIn)
      window.clearTimeout(saveTimer)
      if (world) {
        storeCamera(world.getCamera(), vp)
        world.destroy()
      }
      worldRef.current = null
      remeasureRef.current = () => {}
      delete host.dataset.ready
      delete host.dataset.renderer
    }
    // The world is rebuilt only when the motion preference flips; every other input reaches it through refs.
  }, [reducedMotion])

  useEffect(() => {
    stateRef.current = state
    worldRef.current?.setState(state)
  }, [state])

  useEffect(() => {
    activeRef.current = active
    worldRef.current?.setActive(active)
  }, [active])

  useEffect(() => {
    safeRef.current = { top: safeTop, bottom: safeBottom }
    remeasureRef.current()
  }, [safeTop, safeBottom])

  /** A building was chosen: glide the camera to it, then open its room. */
  const openPlace = (id: CityPlaceId) => {
    const rect = PLACE_RECTS[id]
    const world = worldRef.current
    if (!world || !rect) {
      onHotspot(id)
      return
    }
    world.glideToRect(rect, () => onHotspotRef.current(id))
  }
  const hoverPlace = (id: CityPlaceId | null) => {
    if (id && draggingRef.current) return
    worldRef.current?.setHover(id)
  }

  const residentList: Array<{ id: ResidentId; label: string }> =
    renderer === "static"
      ? []
      : [
          ...state.agents.map((agent) => ({ id: agentResidentId(agent.id), label: `${agent.name}, agent` })),
          ...state.workers.map((worker) => ({ id: worker.id, label: `${worker.name}, integration worker` })),
        ]
  const zoom = view?.zoom ?? 1
  const offsetX = view?.offsetX ?? 0
  const offsetY = view?.offsetY ?? 0

  // Front-most places (lowest on screen) come last in the DOM, so where two hit rects overlap the building that is
  // visually in front takes the click.
  const placedHotspots = view
    ? hotspots
        .flatMap((spot) => {
          const r = PLACE_RECTS[spot.id]
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
      aria-label="U.B Agents City. Drag or use the arrow keys to look around, scroll or press minus and plus to zoom out and back in, 0 to recenter."
      className={cn("pixel-camera absolute inset-0 overflow-clip", className)}
      style={{ backgroundColor: DISTRICT_SEA_COLOR }}
      data-scene="city"
      data-agent-hover={agentHover ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
    >
      {renderer === "static" && view ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={DISTRICT_MAP.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute max-w-none"
          style={{ left: offsetX + DISTRICT_MAP.x * zoom, top: offsetY + DISTRICT_MAP.y * zoom, width: DISTRICT_MAP.w * zoom, height: DISTRICT_MAP.h * zoom }}
        />
      ) : null}
      {placedHotspots.map(({ spot, r }) => (
        <button
          key={spot.id}
          type="button"
          data-place={spot.id}
          onClick={() => openPlace(spot.id)}
          onPointerEnter={() => hoverPlace(spot.id)}
          onPointerLeave={() => hoverPlace(null)}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) hoverPlace(spot.id)
          }}
          onBlur={() => hoverPlace(null)}
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
          <span className="pixel-hotspot-tag-detail">Click to open its card</span>
        </div>
      ) : null}
      {residentList.map((resident) => (
        <button
          key={resident.id}
          type="button"
          data-resident={resident.id}
          ref={(el) => {
            if (el) residentButtons.current.set(resident.id, el)
            else residentButtons.current.delete(resident.id)
          }}
          onClick={() => (onResident ? onResident(resident.id) : onHotspot("tasks"))}
          className="pixel-resident"
          aria-label={resident.label}
        />
      ))}
      {renderer !== "static" ? (
        <div className="pixel-camera-controls" data-camera-controls="" style={{ bottom: safeBottom + 10 }}>
          <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => worldRef.current?.zoomBy(1 / KEY_ZOOM_STEP)} aria-label="Zoom out" title="Zoom out (-)">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => worldRef.current?.zoomBy(KEY_ZOOM_STEP)} aria-label="Zoom in" title="Zoom in (+)">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" className="pixel-chip pixel-chip--icon" onClick={() => worldRef.current?.recenter()} aria-label="Recenter the city" title="Recenter (0)">
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
