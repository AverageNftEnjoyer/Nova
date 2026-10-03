"use client"

import { useEffect, useId, useRef, useState, type Ref } from "react"
import { Map as MapIcon } from "lucide-react"
import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_SRC, DISTRICT_IMAGE_WIDTH, DISTRICT_PLACES } from "@/components/pixel-city/district/image-plan"
import { ROOMS, ROOM_IDS, type RoomId } from "./room-registry"

/** One pin per room, at the middle of its building on the city painting (the same plan pixels the city is mapped in). */
const PINS = ROOM_IDS.flatMap((id) => {
  const place = DISTRICT_PLACES.find((candidate) => candidate.id === ROOMS[id].place)
  if (!place) return []
  return [{ id, name: ROOMS[id].building, left: ((place.hit.x + place.hit.w / 2) / DISTRICT_IMAGE_WIDTH) * 100, top: ((place.hit.y + place.hit.h / 2) / DISTRICT_IMAGE_HEIGHT) * 100 }]
})

/** Fetches the map's picture ahead of time so the fast-travel map opens drawn, never as a black box. */
export function preloadTravelMap(): void {
  const image = new Image()
  image.src = DISTRICT_IMAGE_SRC
}

interface RoomTravelMapProps {
  /** The room the player is in. */
  roomId: RoomId
  /** Fast travel: open another room. */
  onTravel: (roomId: RoomId) => void
  /** Leave the room for the city. */
  onLeave: () => void
  /** The map button, which takes focus when the room opens. */
  buttonRef: Ref<HTMLButtonElement>
  /** Reports the map opening / closing so the stage can make room for it. */
  onOpenChange?: (open: boolean) => void
}

/**
 * The way out of an immersive room: a map button in the bottom-left corner. It opens the city map with a pin on every
 * room; a pin travels straight to that room, and "Back to the world" returns to the city. Esc closes the map first.
 */
export function RoomTravelMap({ roomId, onTravel, onLeave, buttonRef, onOpenChange }: RoomTravelMapProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  const setOpenState = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Capture phase: the room's own Escape handler (leave the room) must not also run.
      event.stopPropagation()
      setOpen(false)
      onOpenChange?.(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>("[data-current]")?.focus()
  }, [open])

  return (
    <>
      {/* The same round icon button as the home HUD's rail (game-hud.tsx RailOrb): label as a tooltip plaque. */}
      <span className="game-orb stage-map-orb">
        <button
          ref={buttonRef}
          type="button"
          className="pixel-orb-btn"
          data-active={open ? "true" : undefined}
          onClick={() => setOpenState(!open)}
          aria-label={open ? "Close the map" : "Open the map: fast travel or back to the world"}
          aria-expanded={open}
        >
          <MapIcon aria-hidden="true" />
        </button>
        <span className="pixel-plaque pixel-plaque--frame game-tip" data-side="right" aria-hidden="true">
          Map
        </span>
      </span>
      {open ? (
        <div ref={panelRef} className="stage-map" role="group" aria-labelledby={titleId}>
          <div className="stage-map-head">
            <h2 id={titleId} className="stage-map-title">Fast travel</h2>
          </div>
          <div className="stage-map-view" style={{ aspectRatio: `${DISTRICT_IMAGE_WIDTH} / ${DISTRICT_IMAGE_HEIGHT}` }}>
            {/* A plain img: the city painting, shown small as the map. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={DISTRICT_IMAGE_SRC} alt="" className="stage-map-img" draggable={false} />
            {PINS.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className="stage-map-pin"
                style={{ left: `${pin.left}%`, top: `${pin.top}%` }}
                data-current={pin.id === roomId ? "true" : undefined}
                aria-label={pin.id === roomId ? `${pin.name} (you are here)` : `Travel to ${pin.name}`}
                onClick={() => {
                  setOpenState(false)
                  if (pin.id !== roomId) onTravel(pin.id)
                }}
              >
                <span className="stage-map-pin-name" aria-hidden="true">{pin.name}</span>
              </button>
            ))}
          </div>
          <div className="stage-map-foot">
            <button type="button" className="stage-map-leave" onClick={onLeave}>
              Back to the world
            </button>
            <button type="button" className="stage-map-close" onClick={() => setOpenState(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
