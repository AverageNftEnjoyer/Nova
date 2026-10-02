"use client"

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/shared/utils"
import type { TownBuilding } from "@/lib/town/types"
import { GameBar } from "../game/game-bar"
import { formatXp, INTEGRATION_LABELS } from "../game/town-ui"
import { PixelEmblem } from "../pixel/pixel-window"
import { PIXEL_WINDOW_THEMES } from "../pixel/window-themes"
import { RoomBackdrop } from "./room-backdrop"
import { RoomIntegrationSetup } from "./room-integration-setup"
import { sectionId, type RoomDefinition, type RoomPanelId, type RoomSectionId } from "./room-registry"

interface BuildingRoomProps {
  room: RoomDefinition
  /** The tab to open on; the room's first section when absent (or when the room has no such section). */
  initialSection?: RoomSectionId
  /** Live one-line status of the place (the same text as its city hotspot tag); empty to show none. */
  detail: string
  /** The integration's connection flag, when the room has an integration. */
  connected: boolean | null
  /** The integration's building from GET /api/town (level, uses); null while loading or for civic rooms. */
  building: TownBuilding | null
  /** The integration's brand icon, shown on the title plaque instead of the pixel emblem. */
  icon?: ReactNode
  /** Draws a data section: Home's existing module for that panel. */
  renderPanel: (panel: RoomPanelId) => ReactNode
  /** Buttons on the frame's top strip (e.g. open the full page). */
  actions?: ReactNode
  onClose: () => void
}

type RoomStyle = CSSProperties & Record<`--${string}`, string>

/**
 * One building's room: a large pixel window with the room's picture as a vista along the top (room-backdrop.tsx), the
 * building's live status on plaques over it, and the room's sections as tabs on a solid panel below, so the picture
 * never sits behind text. Escape and the scrim close it; focus moves in on open and back out on close.
 */
export function BuildingRoom({ room, initialSection, detail, connected, building, icon, renderPanel, actions, onClose }: BuildingRoomProps) {
  const titleId = useId()
  const tabsId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const sections = room.sections
  const [active, setActive] = useState<RoomSectionId>(() =>
    initialSection && sections.some((section) => sectionId(section) === initialSection) ? initialSection : sectionId(sections[0]),
  )
  const current = sections.find((section) => sectionId(section) === active) ?? sections[0]

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      previous?.focus()
    }
  }, [onClose])

  const style: RoomStyle = {
    "--pw-accent": room.accent,
    "--pw-accent-2": room.accent2,
    "--px-accent": room.accent,
    "--room-accent": room.accent,
    "--room-accent-2": room.accent2,
  }

  return (
    <div className="pixel-ui fixed inset-0 z-120 flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} className="pixel-scrim absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-room={room.id} style={style} className="pixel-window room-window relative">
        <div className="pixel-frame pixel-window-frame">
          <div className="pixel-window-body room-body relative overflow-hidden">
            <div className="room-vista">
              <RoomBackdrop sources={room.backgrounds} building={room.building} />
              <RoomStatus room={room} detail={detail} connected={connected} building={building} />
            </div>

            {sections.length > 1 ? (
              <div role="tablist" aria-label={`${room.building} sections`} className="room-tabs">
                {sections.map((section) => {
                  const id = sectionId(section)
                  return (
                    <button
                      key={id}
                      id={`${tabsId}-${id}`}
                      type="button"
                      role="tab"
                      aria-selected={id === sectionId(current)}
                      aria-controls={`${tabsId}-panel`}
                      onClick={() => setActive(id)}
                      className="pixel-btn pixel-btn--ghost game-tab"
                      data-active={id === sectionId(current) ? "true" : undefined}
                    >
                      {section.label}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div
              id={`${tabsId}-panel`}
              role={sections.length > 1 ? "tabpanel" : "region"}
              aria-labelledby={sections.length > 1 ? `${tabsId}-${sectionId(current)}` : titleId}
              className="room-panel"
              data-kind={current.kind}
            >
              {current.kind === "setup" ? (
                room.integration ? (
                  <RoomIntegrationSetup key={room.integration} setup={room.integration} />
                ) : null
              ) : (
                renderPanel(current.panel)
              )}
            </div>
          </div>
        </div>
        <div className="pixel-plaque pixel-window-plaque">
          {icon ? <span className="room-plaque-icon">{icon}</span> : <PixelEmblem theme={PIXEL_WINDOW_THEMES[room.emblem]} />}
          <h2 id={titleId} className="pixel-window-heading">
            <span className="pixel-title pixel-window-name">{room.building}</span>
            <span className="pixel-window-role">{room.role}</span>
          </h2>
        </div>
        {actions ? <div className="pixel-window-actions">{actions}</div> : null}
        <button ref={closeRef} type="button" onClick={onClose} className="pixel-close pixel-window-close" aria-label={`Close ${room.building}`} />
      </div>
    </div>
  )
}

/** The building's live status, on plaques over the picture: connection, building level and uses, or the place's tag. */
function RoomStatus({ room, detail, connected, building }: Pick<BuildingRoomProps, "room" | "detail" | "connected" | "building">) {
  const integration = room.integration
  const next = building?.nextLevelUses ?? null
  return (
    <div className="room-status">
      {integration ? (
        <span className="pixel-plaque room-status-plaque">
          <span className="room-lamp" data-on={connected ? "true" : undefined} aria-hidden="true" />
          <span>
            {INTEGRATION_LABELS[integration]} · {connected ? "Connected" : "Not connected"}
          </span>
        </span>
      ) : null}
      {integration && building && building.connected ? (
        <span className="pixel-plaque room-status-plaque room-status-level">
          <span className={cn("pixel-label", building.level >= 2 ? "pixel-label--rare" : "pixel-label--common")}>Lv {building.level}</span>
          <GameBar
            value={next !== null ? building.uses / next : 1}
            tone={next !== null ? "quest" : "done"}
            label={`${room.building} level progress`}
            valueText={next !== null ? `${building.uses} of ${next} uses` : `${building.uses} uses, max level`}
            className="room-status-bar"
          />
          <span className="tabular-nums">{next !== null ? `${formatXp(building.uses)}/${formatXp(next)} uses` : `${formatXp(building.uses)} uses · max`}</span>
        </span>
      ) : integration && building ? (
        <span className="pixel-plaque room-status-plaque">
          <span className="pixel-label pixel-label--off">Empty lot</span>
          <span>Connect to build Lv 1</span>
        </span>
      ) : null}
      {detail ? <span className="pixel-plaque room-status-plaque">{detail}</span> : null}
    </div>
  )
}
