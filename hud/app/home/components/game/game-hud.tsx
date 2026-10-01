"use client"

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"
import { CloudSun, Music, Settings, User } from "lucide-react"
import { WindowControls } from "@/components/window/window-controls"
import { cn } from "@/lib/shared/utils"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { PlayerPanel, QuestsChip } from "./town-hud"

const DRAG: CSSProperties = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG: CSSProperties = { WebkitAppRegion: "no-drag" } as CSSProperties

interface HudButtonProps {
  icon: ReactNode
  label: string
  /** Short value under/beside the label (e.g. the temperature). */
  value?: string
  title?: string
  ariaLabel?: string
  active?: boolean
  onClick: () => void
  children?: ReactNode
}

/** One large labelled HUD button. The label collapses to the icon below 1280px (pixel-ui.css). */
function HudButton({ icon, label, value, title, ariaLabel, active, onClick, children }: HudButtonProps) {
  return (
    <button type="button" onClick={onClick} className="game-hud-btn" data-active={active ? "true" : undefined} aria-label={ariaLabel ?? label} title={title ?? label}>
      {icon}
      <span className="game-hud-btn-label">
        {label}
        {value ? <span className="game-hud-btn-value tabular-nums">{value}</span> : null}
      </span>
      {children}
    </button>
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
  /** Reports the HUD's bottom edge in px (it changes with width and scale) so the camera can keep the city clear of it. */
  onHeight: (px: number) => void
}

/**
 * Home's game HUD: logo and player panel on the left, large labelled buttons and the window controls on the right.
 * The bar doubles as the window drag area; every interactive part opts out of dragging.
 */
export function GameHud(props: GameHudProps) {
  const { town, profileName, profileAvatar, presence, onHeight } = props
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => onHeight(Math.ceil(el.getBoundingClientRect().bottom))
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeight])

  return (
    <header ref={ref} className="game-hud absolute inset-x-0 top-0 z-10" style={DRAG}>
      <div className="game-hud-left" style={NO_DRAG}>
        <div className="min-w-0 select-none">
          <button type="button" onClick={props.onHome} className="pixel-wordmark game-hud-logo" aria-label="Home">
            NovaAIO
          </button>
          <p className="pixel-wordmark game-hud-presence">
            <span className={cn("h-2 w-2 shrink-0", presence.dotClassName)} aria-hidden="true" />
            <span className={presence.textClassName}>{presence.label}</span>
          </p>
        </div>
        <PlayerPanel town={town} name={profileName} avatar={profileAvatar} onOpen={props.onOpenTownHall} />
      </div>

      <div className="game-hud-right" style={NO_DRAG}>
        <QuestsChip town={town} open={props.questLogOpen} news={props.questNews} onClick={props.onOpenQuests} />
        <HudButton
          icon={<Music className="game-hud-btn-icon text-(--px-accent-2)" />}
          label="Music"
          title={props.musicPlaying ? "Music: playing" : "Music"}
          ariaLabel={props.musicPlaying ? "Music: playing" : "Music"}
          active={props.musicOpen}
          onClick={props.onOpenMusic}
        >
          {props.musicPlaying ? <span className="game-dot game-dot--live" aria-hidden="true" /> : null}
        </HudButton>
        <HudButton
          icon={<CloudSun className="game-hud-btn-icon text-(--px-accent)" />}
          label="Weather"
          value={props.weatherValue}
          title={props.weatherTitle}
          ariaLabel={props.weatherAriaLabel}
          onClick={props.onOpenWeather}
        />
        <HudButton icon={<User className="game-hud-btn-icon text-(--px-green)" />} label="Profile" title="Profile" onClick={props.onOpenProfile} />
        <HudButton icon={<Settings className="game-hud-btn-icon" />} label="Settings" ariaLabel="Open settings" title="Settings" onClick={props.onOpenSettings} />
        <WindowControls />
      </div>
    </header>
  )
}
