"use client"

import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react"
import { RoomTravelMap } from "./room-travel-map"
import type { RoomId, RoomStageDefinition, StageCircle, StageEllipse } from "./room-registry"

/**
 * Immersive room shell (docs/frontend/nova-city-rooms.md, "Immersive rooms"). The room's picture fills the viewport
 * (cover-fit, never letterboxed, never altered) and everything interactive is positioned in fractions of the picture's
 * own box, so it stays locked to the artwork at any window size. The "screen" slot is the painted screen's inner area;
 * crystals and the portal are optional painted spots that become real buttons. When the painted screen would be too
 * small to use (or the window is narrow) the menu leaves the picture and stacks under it as a full-width panel.
 */

type StageStyle = CSSProperties & Record<`--${string}`, string | number>

const DEFAULT_MIN_SCREEN_PX = 560
const COMPACT_WIDTH_PX = 700

interface ViewportSize {
  width: number
  height: number
}

function readViewport(): ViewportSize {
  return typeof window === "undefined" ? { width: 1920, height: 1080 } : { width: window.innerWidth, height: window.innerHeight }
}

/** True when the overlaid screen would be unusable: a narrow window, or the cover-fit screen under `minScreenPx` wide. */
export function isStageCompact(stage: RoomStageDefinition, viewport: ViewportSize): boolean {
  if (viewport.width < COMPACT_WIDTH_PX) return true
  const ratio = stage.aspect[0] / stage.aspect[1]
  const pictureWidth = Math.max(viewport.width, viewport.height * ratio)
  return pictureWidth * stage.screen.w < (stage.minScreenPx ?? DEFAULT_MIN_SCREEN_PX)
}

export function useStageCompact(stage: RoomStageDefinition): boolean {
  const [viewport, setViewport] = useState<ViewportSize>(readViewport)
  useEffect(() => {
    const onResize = () => setViewport(readViewport())
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return isStageCompact(stage, viewport)
}

function pct(value: number): string {
  return `${(value * 100).toFixed(4)}%`
}

export interface RoomStageTab {
  id: string
  label: string
}

interface RoomStagePortal {
  /** The label on the plaque under the glowing spot (also its accessible name). */
  label: string
  onActivate: () => void
  onPrefetch?: () => void
}

interface RoomStageProps {
  stage: RoomStageDefinition
  /** The picture (already known to load), or null while it is loading. */
  src: string | null
  /** Accessible name source: the id of the heading inside `screen`. */
  titleId: string
  accent: string
  roomId: string
  /** The menu: drawn inside the painted screen, or stacked under the picture when compact. */
  screen: ReactNode
  /** Previous / next tab buttons on the painted crystals; omitted when the room has one tab. */
  onPrev?: () => void
  onNext?: () => void
  prevLabel?: string
  nextLabel?: string
  portal?: RoomStagePortal
  /** Extra hotspots, positioned by the caller in % of the picture (children of the picture box). */
  children?: ReactNode
  /** Leave the room for the city. */
  onBack: () => void
  /** Fast travel to another room from the map. */
  onTravel: (roomId: RoomId) => void
  /** The map button (it takes focus when the room opens). */
  backRef: Ref<HTMLButtonElement>
}

/** Keeps Tab inside the stage (it covers the whole app, so focus must not wander to the hidden city behind). */
function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return
  const root = event.currentTarget
  const focusable = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(
    (element) => element.getClientRects().length > 0,
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function circleStyle(circle: StageCircle, aspect: number): CSSProperties {
  const w = circle.r * 2
  return { left: pct(circle.cx - circle.r), top: pct(circle.cy - (circle.r * aspect)), width: pct(w), height: pct(circle.r * 2 * aspect) }
}

function ellipseStyle(ellipse: StageEllipse): CSSProperties {
  return { left: pct(ellipse.cx - ellipse.rx), top: pct(ellipse.cy - ellipse.ry), width: pct(ellipse.rx * 2), height: pct(ellipse.ry * 2) }
}

export function RoomStage({ stage, src, titleId, accent, roomId, screen, onPrev, onNext, prevLabel, nextLabel, portal, children, onBack, onTravel, backRef }: RoomStageProps) {
  const [mapOpen, setMapOpen] = useState(false)
  const compact = useStageCompact(stage)
  const ratio = stage.aspect[0] / stage.aspect[1]
  const style: StageStyle = {
    "--stage-ratio": ratio,
    "--stage-holo": stage.tone.holo,
    "--stage-holo-mid": stage.tone.holoMid,
    "--stage-holo-deep": stage.tone.holoDeep,
    "--stage-stone": stage.tone.stone,
    "--stage-amber": stage.tone.amber,
    "--stage-rug": stage.tone.rug,
    "--stage-chamfer": pct(stage.screen.chamfer / stage.screen.w),
    "--room-accent": accent,
  }
  const { screen: area } = stage
  // The picture is 1/ratio as tall as it is wide; a circle of radius r (of width) is 2r*ratio tall, as a fraction of height.
  const circleAspect = ratio

  const back = <RoomTravelMap roomId={roomId as RoomId} onTravel={onTravel} onLeave={onBack} buttonRef={backRef} onOpenChange={setMapOpen} />

  const picture = (
    // A plain img: optional, user-supplied artwork (see room-backdrop.tsx); never altered, drawn pixel-crisp.
    // eslint-disable-next-line @next/next/no-img-element
    src ? <img src={src} alt="" className="stage-picture" draggable={false} /> : null
  )

  return (
    <div
      className="pixel-ui room-stage"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-room={roomId}
      data-map-open={mapOpen ? "true" : undefined}
      data-compact={compact ? "true" : undefined}
      style={style}
      onKeyDown={trapTab}
    >
      {compact ? (
        <div className="stage-scroll">
          <div className="stage-compact-top">{back}</div>
          <div className="stage-compact-picture">{picture}</div>
          <div className="stage-compact-menu">
            <div className="holo holo--panel">{screen}</div>
            {portal ? (
              <button type="button" className="holo-btn stage-compact-portal" onClick={portal.onActivate} onPointerEnter={portal.onPrefetch} onFocus={portal.onPrefetch}>
                {portal.label}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
        {back}
        <div className="stage-box">
          {picture}
          <div
            className="stage-screen"
            style={{ left: pct(area.x), top: pct(area.y), width: pct(area.w), height: pct(area.h) }}
          >
            <div className="holo holo--screen">{screen}</div>
          </div>
          {stage.crystals && onPrev && onNext ? (
            <>
              <button type="button" className="stage-crystal" style={circleStyle(stage.crystals.prev, circleAspect)} onClick={onPrev} aria-label={prevLabel ?? "Previous page"} title={prevLabel ?? "Previous page"} />
              <button type="button" className="stage-crystal" style={circleStyle(stage.crystals.next, circleAspect)} onClick={onNext} aria-label={nextLabel ?? "Next page"} title={nextLabel ?? "Next page"} />
            </>
          ) : null}
          {stage.portal && portal ? (
            <button
              type="button"
              className="stage-portal"
              style={ellipseStyle(stage.portal)}
              onClick={portal.onActivate}
              onPointerEnter={portal.onPrefetch}
              onFocus={portal.onPrefetch}
              aria-label={portal.label}
            >
              <span className="stage-portal-label" aria-hidden="true">{portal.label}</span>
            </button>
          ) : null}
          {children}
        </div>
        </>
      )}
    </div>
  )
}
