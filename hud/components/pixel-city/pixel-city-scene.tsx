"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { cn } from "@/lib/shared/utils"
import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_WIDTH } from "./district/image-plan"
import { ImageDistrictRenderer } from "./district/image-renderer"
import type { CityPlaceId, CityRect, CitySceneHit, CitySceneRenderer, CitySceneState } from "./types"

const FRAME_INTERVAL_MS = 1000 / 20
const REDUCED_MOTION_INTERVAL_MS = 1000

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
}

interface SceneMetrics {
  /** CSS pixels per plan pixel: the city covers the screen, so this is usually fractional. */
  scale: number
  /** Where the canvas sits in the host, in CSS pixels (negative when the cover fit crops an edge). */
  offsetX: number
  offsetY: number
}

function measure(el: HTMLElement): SceneMetrics {
  const vw = Math.max(1, el.clientWidth)
  const vh = Math.max(1, el.clientHeight)
  // Cover the whole screen with the painted city, cropping the overflowing edge evenly.
  const scale = Math.max(vw / DISTRICT_IMAGE_WIDTH, vh / DISTRICT_IMAGE_HEIGHT)
  return {
    scale,
    offsetX: Math.round((vw - DISTRICT_IMAGE_WIDTH * scale) / 2),
    offsetY: Math.round((vh - DISTRICT_IMAGE_HEIGHT * scale) / 2),
  }
}

type AgentHit = Extract<CitySceneHit, { kind: "agent" }>

/**
 * Home's Nova City: the painted night city on a canvas at screen resolution, live characters and effects on top,
 * and every place as a focusable button that opens its popup. Animates at 20 fps only while `active`.
 */
export function PixelCityScene({ state, hotspots, active, onHotspot, className }: PixelCitySceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<CitySceneRenderer | null>(null)
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null)
  const [rects, setRects] = useState<Partial<Record<CityPlaceId, CityRect>>>({})
  const [agentHover, setAgentHover] = useState<AgentHit | null>(null)
  const hoverRef = useRef<AgentHit | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () =>
      setMetrics((prev) => {
        const next = measure(host)
        return prev && prev.scale === next.scale && prev.offsetX === next.offsetX && prev.offsetY === next.offsetY ? prev : next
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !metrics) return
    if (!rendererRef.current) rendererRef.current = new ImageDistrictRenderer(canvas)
    const renderer = rendererRef.current
    // Draw at device resolution so the painting and the sprites stay sharp at any window size.
    const backing = metrics.scale * (window.devicePixelRatio || 1)
    renderer.resize(DISTRICT_IMAGE_WIDTH * backing, DISTRICT_IMAGE_HEIGHT * backing)
    renderer.setState(state)
    renderer.render(performance.now() / 1000)
    setRects(renderer.hotspots())
    // `state` is applied by the effect below; listing it here would re-run resize on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return
    renderer.setState(state)
    renderer.render(performance.now() / 1000)
  }, [state, metrics])

  useEffect(() => {
    if (!active || !metrics) return
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const interval = reducedMotion ? REDUCED_MOTION_INTERVAL_MS : FRAME_INTERVAL_MS
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick)
      if (now - last < interval) return
      last = now
      rendererRef.current?.render(now / 1000)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [active, metrics])

  const scale = metrics?.scale ?? 1
  const offsetX = metrics?.offsetX ?? 0
  const offsetY = metrics?.offsetY ?? 0

  // Agents are drawn on the canvas; the host tracks the pointer so hovering one shows its tag and clicking it opens
  // Agent Tasks (even when the agent stands over a building's button: this runs in the capture phase).
  const hitAt = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | MouseEvent): AgentHit | null => {
      const host = hostRef.current
      const renderer = rendererRef.current
      if (!host || !renderer) return null
      const bounds = host.getBoundingClientRect()
      const hit = renderer.hitTest((event.clientX - bounds.left - offsetX) / scale, (event.clientY - bounds.top - offsetY) / scale)
      return hit && hit.kind === "agent" ? hit : null
    },
    [scale, offsetX, offsetY],
  )

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hit = hitAt(event)
    const prev = hoverRef.current
    if ((hit?.id ?? null) === (prev?.id ?? null) && hit?.anchorX === prev?.anchorX && hit?.anchorY === prev?.anchorY) return
    hoverRef.current = hit
    setAgentHover(hit)
  }

  const onPointerLeave = () => {
    hoverRef.current = null
    setAgentHover(null)
  }

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hitAt(event.nativeEvent)) return
    event.stopPropagation()
    event.preventDefault()
    onHotspot("tasks")
  }

  // Front-most places (lowest on screen) come last in the DOM, so where two hit rects overlap the building that is
  // visually in front takes the click.
  const placedHotspots = hotspots
    .flatMap((spot) => {
      const r = rects[spot.id]
      return r ? [{ spot, r }] : []
    })
    .sort((a, b) => a.r.y + a.r.h - (b.r.y + b.r.h))

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClickCapture={onClickCapture}
      data-scene="city"
      data-agent-hover={agentHover ? "true" : undefined}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute left-0 top-0"
        style={metrics ? { left: offsetX, top: offsetY, width: DISTRICT_IMAGE_WIDTH * scale, height: DISTRICT_IMAGE_HEIGHT * scale } : undefined}
      />
      {placedHotspots.map(({ spot, r }) => (
        <button
          key={spot.id}
          type="button"
          onClick={() => onHotspot(spot.id)}
          className="pixel-hotspot group absolute"
          style={{ left: offsetX + r.x * scale, top: offsetY + r.y * scale, width: r.w * scale, height: r.h * scale }}
          aria-label={spot.detail ? `${spot.label}: ${spot.detail}` : spot.label}
        >
          <span
            className="pixel-hotspot-marker"
            aria-hidden="true"
            style={
              r.markerX !== undefined && r.markerY !== undefined
                ? { left: (r.markerX - r.x) * scale, top: (r.markerY - r.y) * scale - 14 }
                : undefined
            }
          />
          <span className="pixel-hotspot-tag">
            <span className="pixel-hotspot-tag-label">{spot.label}</span>
            {spot.detail ? <span className="pixel-hotspot-tag-detail">{spot.detail}</span> : null}
          </span>
        </button>
      ))}
      {agentHover ? (
        <div
          className="pixel-agent-tag"
          role="status"
          style={{ left: offsetX + agentHover.anchorX * scale, top: offsetY + agentHover.anchorY * scale - 8 }}
        >
          <span className="pixel-hotspot-tag-label">{agentHover.label}</span>
          <span className="pixel-hotspot-tag-detail">{agentHover.detail}</span>
        </div>
      ) : null}
    </div>
  )
}
