"use client"

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/shared/utils"
import type { TownBuilding } from "@/lib/town/types"
import { GameBar } from "../game/game-bar"
import { formatXp, INTEGRATION_LABELS } from "../game/town-ui"
import { PixelEmblem } from "../pixel/pixel-window"
import { PIXEL_WINDOW_THEMES } from "../pixel/window-themes"
import { RoomBackdrop } from "./room-backdrop"
import { useRoomPicture } from "./room-picture"
import { RoomIntegrationSetup } from "./room-integration-setup"
import { RoomStage } from "./room-stage"
import { sectionId, type RoomDefinition, type RoomId, type RoomPanelId, type RoomSectionId } from "./room-registry"

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
  renderPanel: (panel: RoomPanelId, variant: RoomPanelVariant, controls: RoomPanelControls) => ReactNode
  /** Immersive rooms: the room's main action, on the painted portal (or under the picture when compact). */
  stageAction?: { label: string; /** Switch the screen to this section of the room. */ section: RoomSectionId; onPrefetch?: () => void }
  /** Buttons on the frame's top strip (e.g. open the full page). */
  actions?: ReactNode
  onClose: () => void
  /** Fast travel: open another room (immersive rooms' map). */
  onTravel: (roomId: RoomId) => void
}

/** "window": the pixel window's solid panel. "holo": drawn on an immersive stage's hologram screen. */
export type RoomPanelVariant = "window" | "holo"

/** What a panel can ask of its room. */
export interface RoomPanelControls {
  /** Switch the room to another of its sections (e.g. to Runs after a launch). */
  showSection: (section: RoomSectionId) => void
}

type RoomStyle = CSSProperties & Record<`--${string}`, string>

/**
 * One building's room: a large pixel window with the room's picture as a vista along the top (room-backdrop.tsx), the
 * building's live status on plaques over it, and the room's sections as tabs on a solid panel below, so the picture
 * never sits behind text. Escape and the scrim close it; focus moves in on open and back out on close.
 */
export function BuildingRoom({ room, initialSection, detail, connected, building, icon, renderPanel, stageAction, actions, onClose, onTravel }: BuildingRoomProps) {
  const titleId = useId()
  const tabsId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const sections = room.sections
  const [active, setActive] = useState<RoomSectionId>(() =>
    initialSection && sections.some((section) => sectionId(section) === initialSection) ? initialSection : sectionId(sections[0]),
  )
  const current = sections.find((section) => sectionId(section) === active) ?? sections[0]
  const picture = useRoomPicture(room.stage ? room.backgrounds : [])
  const immersive = Boolean(room.stage) && picture.status !== "none"
  const currentIndex = sections.indexOf(current)
  const stepSection = (step: number) => setActive(sectionId(sections[(currentIndex + step + sections.length) % sections.length]))
  const showSection = useCallback(
    (target: RoomSectionId) => {
      if (sections.some((section) => sectionId(section) === target)) setActive(target)
    },
    [sections],
  )
  const controls: RoomPanelControls = { showSection }
  // Sections marked keepAlive stay mounted (hidden) once visited, so their forms keep what was typed.
  const [visited, setVisited] = useState<ReadonlySet<RoomSectionId>>(() => new Set([active]))
  if (!visited.has(active)) setVisited(new Set([...visited, active]))
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])
  const firstSection = sectionId(sections[0])

  /** Draws every section's body: the current one, plus keepAlive sections already visited (hidden while not current). */
  const renderBodies = (variant: RoomPanelVariant): ReactNode =>
    sections.map((section) => {
      const id = sectionId(section)
      const isCurrent = id === sectionId(current)
      if (!isCurrent && !(section.kind === "data" && section.keepAlive && visited.has(id))) return null
      return (
        <div key={id} className="room-section" hidden={!isCurrent}>
          {section.kind === "setup" ? (
            room.integration ? <RoomIntegrationSetup key={room.integration} setup={room.integration} /> : null
          ) : (
            renderPanel(section.panel, variant, controls)
          )}
        </div>
      )
    })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // A picker's open menu, or the fullscreen automation canvas, takes Escape first.
      if (document.querySelector('[aria-haspopup="listbox"][aria-expanded="true"], [data-escape-owner]')) return
      // Leaving a keepAlive section (the creation view) goes back to the first one; the next Escape leaves the room.
      const here = sections.find((section) => sectionId(section) === activeRef.current)
      if (here?.kind === "data" && here.keepAlive && activeRef.current !== firstSection) {
        setActive(firstSection)
        return
      }
      onClose()
    }
    // Capture phase: runs before a picker's own Escape handler closes its menu, so the guard below still sees it open.
    window.addEventListener("keydown", onKey, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      previous?.focus()
    }
  }, [onClose, sections, firstSection])

  const style: RoomStyle = {
    "--pw-accent": room.accent,
    "--pw-accent-2": room.accent2,
    "--px-accent": room.accent,
    "--room-accent": room.accent,
    "--room-accent-2": room.accent2,
  }

  if (room.stage && immersive) {
    const multi = sections.length > 1
    const previousSection = sections[(currentIndex - 1 + sections.length) % sections.length]
    const nextSection = sections[(currentIndex + 1) % sections.length]
    const panel = (
      <>
        <div className="holo-head">
          <h2 id={titleId} className="holo-title">
            <span className="holo-name">{room.building}</span>
            <span className="holo-role">{room.role}</span>
          </h2>
          <div className="holo-chips">
            <RoomStatus room={room} detail={detail} connected={connected} building={building} />
          </div>
          {actions ? <div className="holo-actions">{actions}</div> : null}
        </div>
        {multi ? (
          <div role="tablist" aria-label={`${room.building} sections`} className="holo-tabs">
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
                  className="holo-tab"
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
          role={multi ? "tabpanel" : "region"}
          aria-labelledby={multi ? `${tabsId}-${sectionId(current)}` : titleId}
          className="holo-body"
          data-kind={current.kind}
        >
          {renderBodies("holo")}
        </div>
      </>
    )
    return (
      <RoomStage
        stage={room.stage}
        src={picture.status === "ready" ? picture.src : null}
        titleId={titleId}
        accent={room.accent}
        roomId={room.id}
        screen={panel}
        onPrev={multi ? () => stepSection(-1) : undefined}
        onNext={multi ? () => stepSection(1) : undefined}
        prevLabel={multi ? `Previous page: ${previousSection.label}` : undefined}
        nextLabel={multi ? `Next page: ${nextSection.label}` : undefined}
        portal={stageAction ? { label: stageAction.label, onActivate: () => showSection(stageAction.section), onPrefetch: stageAction.onPrefetch } : undefined}
        onBack={onClose}
        onTravel={onTravel}
        backRef={closeRef}
      />
    )
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
              {renderBodies("window")}
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
