"use client"

import { useState } from "react"
import { ScrollText } from "lucide-react"
import type { TownProgress } from "@/lib/town/types"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { GameBar } from "./game-bar"
import { formatXp, xpProgress } from "./town-ui"

interface PlayerPanelProps {
  town: TownProgressState
  /** The player's profile name (Settings > Profile). */
  name: string
  /** Opens the Town Hall progress screen. */
  onOpen: () => void
}

/**
 * The HUD's name plaque: the player's name, level chip, title and the XP bar (the portrait is its own round button
 * beside it, see game-hud.tsx). Honest loading and error states, never a guess.
 */
export function PlayerPanel({ town, name, onOpen }: PlayerPanelProps) {
  const level = town.progress?.level
  if (!level) {
    return (
      <div className="pixel-plaque pixel-plaque--frame game-player" data-state={town.loading ? "loading" : "error"} title={town.error ?? undefined} role="status">
        <span className="game-player-name">{name}</span>
        <span className="pixel-label pixel-label--off game-player-sub">{town.loading ? "Loading level…" : "Level unavailable"}</span>
      </div>
    )
  }

  const xp = xpProgress(level)
  const next = level.level + 1
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pixel-plaque game-player"
      title={`${formatXp(level.xp)} XP total · open Town Hall`}
      aria-label={`${name}, level ${level.level}, ${level.title}. ${formatXp(xp.toNext)} XP to level ${next}. Open Town Hall progress`}
    >
      <span className="game-player-row">
        <span className="game-player-name">{name}</span>
        <span className="game-player-lv" aria-hidden="true">
          LV {level.level}
        </span>
      </span>
      <span className="game-player-row">
        <span className="pixel-label game-player-sub">{level.title}</span>
        <span className="game-player-xp tabular-nums">{formatXp(xp.toNext)} XP to Lv {next}</span>
      </span>
      <GameBar value={xp.ratio} tone="xp" label="Experience" valueText={`${formatXp(xp.into)} of ${formatXp(xp.span)} XP`} />
    </button>
  )
}

/**
 * True when a quest finished that the user has not seen in the quest log: a pending quest-complete event, or a
 * quest that completed during this session after the log was last opened. Session-only, nothing stored.
 */
export function useQuestNews(progress: TownProgress | null, logOpen: boolean): boolean {
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null)
  const completed = progress ? progress.quests.filter((quest) => quest.status === "completed").map((quest) => quest.id) : null

  // Adjust state while rendering (React's pattern for derived resets): the first load is the baseline, and opening
  // the log marks everything seen.
  if (completed && (seen === null || (logOpen && completed.some((id) => !seen.has(id))))) {
    setSeen(new Set([...(seen ?? []), ...completed]))
  }

  if (!progress || logOpen) return false
  const pendingQuestEvent = progress.pendingEvents.some((event) => event.kind === "quest-complete")
  return pendingQuestEvent || (seen !== null && (completed ?? []).some((id) => !seen.has(id)))
}

interface QuestsOrbProps {
  town: TownProgressState
  open: boolean
  news: boolean
  onClick: () => void
}

/**
 * The Quests orb on the HUD's left rail: a count badge and a news dot when one finished. The count is what the user
 * can act on now: the current tutorial step and today's open daily quests (milestones and building quests live in
 * the log).
 */
export function QuestsOrb({ town, open, news, onClick }: QuestsOrbProps) {
  const active =
    town.progress?.quests.filter((quest) => quest.status === "active" && (quest.category === "tutorial" || quest.category === "daily")).length ?? 0
  const label = town.progress
    ? `Quests: ${active} active${news ? ", new quest completed" : ""}`
    : town.loading
      ? "Quests: loading"
      : "Quests: unavailable"
  return (
    <span className="game-orb">
      <button type="button" onClick={onClick} className="pixel-orb-btn" data-active={open ? "true" : undefined} aria-label={label}>
        <ScrollText aria-hidden="true" />
        {town.progress && active > 0 ? <span className="pixel-orb-btn__badge tabular-nums">{active}</span> : null}
        {news ? <span className="pixel-orb-btn__dot" aria-hidden="true" /> : null}
      </button>
      <span className="pixel-plaque pixel-plaque--frame game-tip" aria-hidden="true">
        Quests
      </span>
    </span>
  )
}
