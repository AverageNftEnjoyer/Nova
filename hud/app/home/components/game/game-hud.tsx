"use client"

import Image from "next/image"
import type { CSSProperties, ReactNode } from "react"
import { CloudSun, Music, Settings } from "lucide-react"
import { WindowControls } from "@/components/window/window-controls"
import { cn } from "@/lib/shared/utils"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { PlayerPanel, QuestsOrb } from "./town-hud"
import { formatXp } from "./town-ui"

const DRAG: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: "no-drag" } as CSSProperties

/** The counter's gold coin: 8x8 art pixels (outline, highlight, gold, shade), drawn crisp at any size. */
const COIN_ROWS = ["..oooo..", ".ohhggo.", "ohgggggo", "ohggggso", "oggggsso", "ogggssso", ".ogssso.", "..oooo.."]
const COIN_FILL: Record<string, string> = {
  o: "var(--px-text-line)",
  h: "color-mix(in srgb, var(--px-accent) 40%, white)",
  g: "var(--px-accent)",
  s: "color-mix(in srgb, var(--px-accent) 62%, black)",
}

function CoinIcon() {
  return (
    <svg viewBox="0 0 8 8" shapeRendering="crispEdges" className="game-chip-icon game-chip-icon--coin" aria-hidden="true">
      {COIN_ROWS.flatMap((row, y) =>
        [...row].map((cell, x) => (cell === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COIN_FILL[cell]} />)),
      )}
    </svg>
  )
}

interface RailOrbProps {
  icon: ReactNode
  /** Shown in the hover / focus tooltip plaque. */
  label: string
  ariaLabel: string
  /** The side the tooltip opens on (right by default; the bottom-right orb opens it to the left). */
  tipSide?: "right" | "left"
  active?: boolean
  onClick: () => void
  children?: ReactNode
}

/** One round icon button on the left rail. The label is a tooltip plaque (hover or keyboard focus), the aria-label always names it. */
function RailOrb({ icon, label, ariaLabel, tipSide = "right", active, onClick, children }: RailOrbProps) {
  return (
    <span className="game-orb">
      <button type="button" onClick={onClick} className="pixel-orb-btn" data-active={active ? "true" : undefined} aria-label={ariaLabel}>
        {icon}
        {children}
      </button>
      <span className="pixel-plaque pixel-plaque--frame game-tip" data-side={tipSide} aria-hidden="true">
        {label}
      </span>
    </span>
  )
}

interface GameHudProps {
  town: TownProgressState
  profileName: string
  profileAvatar: string | null
  presence: { label: string; dotClassName: string; textClassName: string }
  questLogOpen: boolean
  questNews: boolean
  musicOpen: boolean
  musicPlaying: boolean
  weatherValue: string
  weatherTitle: string
  weatherAriaLabel: string
  onHome: () => void
  onOpenTownHall: () => void
  onOpenQuests: () => void
  onOpenMusic: () => void
  onOpenWeather: () => void
  onOpenProfile: () => void
  onOpenSettings: () => void
}

/**
 * Home's game HUD, anchored to the screen's corners (docs/frontend/nova-city-day-ui.md, "Home HUD layout"):
 * top-left the portrait (Profile), wordmark and name plaque (Town Hall) with the Quests / Music rail under it; top-right
 * the window controls, XP counter and weather chip; bottom-right Settings (the camera's zoom buttons sit beside it).
 * A thin strip along the top is the frameless window's drag handle; every interactive part opts out of dragging.
 */
export function GameHud(props: GameHudProps) {
  const { town, profileName, profileAvatar, presence } = props
  const xpTotal = town.progress?.level.xp

  return (
    <>
      <div className="game-hud-drag" style={DRAG} aria-hidden="true" />

      <div className="game-hud-left" style={NO_DRAG}>
        <div className="game-hud-player">
          <span className="game-orb">
            <button type="button" onClick={props.onOpenProfile} className="pixel-orb-btn game-portrait" aria-label="Profile" title="Profile">
              <span className="game-portrait-face" aria-hidden="true">
                {profileAvatar ? (
                  <Image src={profileAvatar} alt="" width={72} height={72} className="h-full w-full object-cover [image-rendering:pixelated]" unoptimized />
                ) : (
                  profileName.charAt(0).toUpperCase()
                )}
              </span>
            </button>
          </span>
          <div className="game-hud-id">
            <div className="game-hud-wordmark select-none">
              <button type="button" onClick={props.onHome} className="pixel-wordmark game-hud-logo" aria-label="Home">
                U.B Agents
              </button>
              <p className="game-hud-presence">
                <span className={cn("h-2 w-2 shrink-0", presence.dotClassName)} aria-hidden="true" />
                <span className="pixel-wordmark">
                  <span className={presence.textClassName}>{presence.label}</span>
                </span>
              </p>
            </div>
            <PlayerPanel town={town} name={profileName} onOpen={props.onOpenTownHall} />
          </div>
        </div>

        <div className="game-hud-rail">
          <QuestsOrb town={town} open={props.questLogOpen} news={props.questNews} onClick={props.onOpenQuests} />
          <RailOrb
            icon={<Music aria-hidden="true" />}
            label="Music"
            ariaLabel={props.musicPlaying ? "Music: playing" : "Music"}
            active={props.musicOpen}
            onClick={props.onOpenMusic}
          >
            {props.musicPlaying ? <span className="pixel-orb-btn__dot game-orb-dot--live" aria-hidden="true" /> : null}
          </RailOrb>
        </div>
      </div>

      <div className="game-hud-right" style={NO_DRAG}>
        <div className="game-winctl">
          <WindowControls />
        </div>
        <div className="game-hud-counter">
          <div className="pixel-plaque game-chip" role="status" aria-label={xpTotal === undefined ? "XP total unavailable" : `${formatXp(xpTotal)} XP total`} title="XP total">
            <CoinIcon />
            <span className="tabular-nums">{xpTotal === undefined ? "—" : formatXp(xpTotal)}</span>
          </div>
          <button
            type="button"
            onClick={props.onOpenWeather}
            className="pixel-plaque game-chip"
            aria-label={props.weatherAriaLabel}
            title={props.weatherTitle}
          >
            <CloudSun className="game-chip-icon text-(--px-accent)" aria-hidden="true" />
            <span className="tabular-nums">{props.weatherValue}</span>
          </button>
        </div>
      </div>

      <div className="game-hud-br" style={NO_DRAG}>
        <RailOrb icon={<Settings aria-hidden="true" />} label="Settings" ariaLabel="Open settings" tipSide="left" onClick={props.onOpenSettings} />
      </div>
    </>
  )
}
