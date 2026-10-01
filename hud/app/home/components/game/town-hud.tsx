"use client"

import { useState } from "react"
import Image from "next/image"
import { ScrollText } from "lucide-react"
import type { TownProgress } from "@/lib/town/types"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { GameBar } from "./game-bar"
import { formatXp, xpProgress } from "./town-ui"

interface PlayerPanelProps {
  town: TownProgressState
  /** The player's profile name and avatar (Settings > Profile). */
  name: string
  avatar: string | null
  /** Opens the Town Hall progress screen. */
  onOpen: () => void
}

/** The HUD's player panel: portrait, name, level and title, and the XP bar. Honest loading and error states, never a guess. */
export function PlayerPanel({ town, name, avatar, onOpen }: PlayerPanelProps) {
  const level = town.progress?.level
  const portrait = (
    <span className="game-player-portrait" aria-hidden="true">
      {avatar ? (
        <Image src={avatar} alt="" width={48} height={48} className="h-full w-full object-cover [image-rendering:pixelated]" unoptimized />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  )
  if (!level) {
    return (
      <div className="game-player" data-state={town.loading ? "loading" : "error"} title={town.error ?? undefined} role="status">
        {portrait}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="game-player-name">{name}</span>
          <span className="game-player-sub">{town.loading ? "Loading level…" : "Level unavailable"}</span>
        </span>
      </div>
    )
  }

  const xp = xpProgress(level)
  const next = level.level + 1
  return (
    <button
      type="button"
      onClick={onOpen}
      className="game-player"
      title={`${formatXp(level.xp)} XP total · open Town Hall`}
      aria-label={`${name}, level ${level.level}, ${level.title}. ${formatXp(xp.toNext)} XP to level ${next}. Open Town Hall progress`}
    >
      {portrait}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="game-player-name">{name}</span>
          <span className="game-player-lv" aria-hidden="true">
            LV {level.level}
          </span>
        </span>
        <span className="game-player-sub">{level.title}</span>
        <GameBar value={xp.ratio} tone="xp" label="Experience" valueText={`${formatXp(xp.into)} of ${formatXp(xp.span)} XP`} />
        <span className="game-player-xp tabular-nums">
          {formatXp(xp.toNext)} XP to Lv {next}
        </span>
      </span>
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

interface QuestsChipProps {
  town: TownProgressState
  open: boolean
  news: boolean
  onClick: () => void
}

/**
 * "Quests" among the HUD buttons, and a dot when one finished. The count is what the user can act on now: the
 * current tutorial step and today's open daily quests (milestones and building quests live in the log).
 */
export function QuestsChip({ town, open, news, onClick }: QuestsChipProps) {
  const active =
    town.progress?.quests.filter((quest) => quest.status === "active" && (quest.category === "tutorial" || quest.category === "daily")).length ?? 0
  const label = town.progress
    ? `Quests: ${active} active${news ? ", new quest completed" : ""}`
    : town.loading
      ? "Quests: loading"
      : "Quests: unavailable"
  return (
    <button type="button" onClick={onClick} className="game-hud-btn" data-active={open ? "true" : undefined} aria-label={label} title={label}>
      <ScrollText className="game-hud-btn-icon text-(--px-accent)" />
      <span className="game-hud-btn-label">Quests</span>
      {town.progress && active > 0 ? <span className="game-count tabular-nums">{active}</span> : null}
      {news ? <span className="game-dot" aria-hidden="true" /> : null}
    </button>
  )
}
