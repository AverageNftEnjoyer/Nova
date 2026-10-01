"use client"

import { useState } from "react"
import { ScrollText } from "lucide-react"
import type { TownProgress } from "@/lib/town/types"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { GameBar } from "./game-bar"
import { formatXp, xpProgress } from "./town-ui"

interface TownLevelBadgeProps {
  town: TownProgressState
  /** Opens the Town Hall progress screen. */
  onOpen: () => void
}

/** Level number, level title and the XP bar, beside the wordmark. Honest loading and error states, never a guess. */
export function TownLevelBadge({ town, onOpen }: TownLevelBadgeProps) {
  const level = town.progress?.level
  if (!level) {
    return (
      <div className="game-level-badge" data-state={town.loading ? "loading" : "error"} title={town.error ?? undefined} role="status">
        <span className="game-level-num" aria-hidden="true">
          <span className="game-level-lv">LV</span>
          <span>{town.loading ? "·" : "?"}</span>
        </span>
        <span className="font-pixel text-[13px] text-(--px-muted)">{town.loading ? "Loading level…" : "Level unavailable"}</span>
      </div>
    )
  }

  const xp = xpProgress(level)
  const next = level.level + 1
  return (
    <button
      type="button"
      onClick={onOpen}
      className="game-level-badge"
      title={`${formatXp(level.xp)} XP total · open Town Hall`}
      aria-label={`Level ${level.level}, ${level.title}. ${formatXp(xp.toNext)} XP to level ${next}. Open Town Hall progress`}
    >
      <span className="game-level-num" aria-hidden="true">
        <span className="game-level-lv">LV</span>
        <span>{level.level}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="pixel-label truncate text-(--px-accent)">{level.title}</span>
          <span className="shrink-0 font-pixel text-[12px] tabular-nums text-(--px-muted)">
            {formatXp(xp.toNext)} XP to Lv {next}
          </span>
        </span>
        <GameBar value={xp.ratio} tone="xp" label="Experience" valueText={`${formatXp(xp.into)} of ${formatXp(xp.span)} XP`} />
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
 * "Quests" in the top-right chips, and a dot when one finished. The count is what the user can act on now: the
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
    <button type="button" onClick={onClick} className="pixel-chip relative" data-active={open ? "true" : undefined} aria-label={label} title={label}>
      <ScrollText className="h-4 w-4 text-(--px-accent)" />
      <span className="hidden md:inline">Quests</span>
      {town.progress && active > 0 ? <span className="game-count tabular-nums">{active}</span> : null}
      {news ? <span className="game-dot" aria-hidden="true" /> : null}
    </button>
  )
}
