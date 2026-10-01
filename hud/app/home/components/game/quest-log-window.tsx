"use client"

import { useState } from "react"
import { Check, Lock, RotateCcw } from "lucide-react"
import type { TownQuest, TownQuestCategory } from "@/lib/town/types"
import { cn } from "@/lib/shared/utils"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { PixelWindow } from "../pixel/pixel-window"
import { GameBar } from "./game-bar"
import { formatXp, hasQuestTarget, QUEST_STATUS_LABEL, QUEST_TABS, questRatio, sortQuests } from "./town-ui"

interface QuestLogWindowProps {
  town: TownProgressState
  onClose: () => void
  onGo: (quest: TownQuest) => void
  /** Brings a hidden tutorial guide back (tutorial still active). */
  onShowTutorial: () => void
  /** Starts the tutorial over (POST /api/town/ack { tutorial: "restart" }). */
  onRestartTutorial: () => void
}

function initialTab(quests: readonly TownQuest[] | undefined): TownQuestCategory {
  if (quests?.some((quest) => quest.category === "tutorial" && quest.status === "active")) return "tutorial"
  return "daily"
}

/** The quest log: every quest by category, with progress, reward and a way to go do it. */
export function QuestLogWindow({ town, onClose, onGo, onShowTutorial, onRestartTutorial }: QuestLogWindowProps) {
  const progress = town.progress
  const [tab, setTab] = useState<TownQuestCategory>(() => initialTab(progress?.quests))
  const quests = progress ? sortQuests(progress.quests.filter((quest) => quest.category === tab)) : []

  const tutorialAction = progress
    ? progress.tutorial.active
      ? { label: "Show tutorial", run: onShowTutorial }
      : { label: "Replay tutorial", run: onRestartTutorial }
    : null

  return (
    <PixelWindow
      place="Quest log"
      theme="quest"
      role={progress ? `Level ${progress.level.level} · ${progress.level.title}` : "Quests"}
      size="md"
      onClose={onClose}
      actions={
        tutorialAction ? (
          <button type="button" onClick={tutorialAction.run} className="pixel-chip h-7! px-2! text-[13px]!" title={tutorialAction.label}>
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tutorialAction.label}</span>
          </button>
        ) : null
      }
    >
      {!progress ? (
        <TownUnavailable town={town} />
      ) : (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div role="tablist" aria-label="Quest categories" className="flex shrink-0 flex-wrap gap-1.5">
            {QUEST_TABS.map(({ category, label }) => {
              const inTab = progress.quests.filter((quest) => quest.category === category)
              const completed = inTab.filter((quest) => quest.status === "completed").length
              return (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={tab === category}
                  onClick={() => setTab(category)}
                  className="pixel-btn pixel-btn--ghost game-tab"
                  data-active={tab === category ? "true" : undefined}
                >
                  {label}
                  <span className="tabular-nums text-(--px-muted) normal-case" aria-label={`${completed} of ${inTab.length} done`}>
                    {completed}/{inTab.length}
                  </span>
                </button>
              )
            })}
          </div>
          {town.error ? <p className="shrink-0 font-pixel text-[12px] text-(--px-red)">Showing the last update: {town.error}</p> : null}
          <ul role="tabpanel" aria-label={QUEST_TABS.find((entry) => entry.category === tab)?.label} className="game-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {quests.length === 0 ? (
              <li className="pixel-card text-center font-pixel text-[14px] text-(--px-muted)">No quests here yet.</li>
            ) : (
              quests.map((quest) => <QuestCard key={quest.id} quest={quest} onGo={onGo} />)
            )}
          </ul>
        </div>
      )}
    </PixelWindow>
  )
}

function QuestCard({ quest, onGo }: { quest: TownQuest; onGo: (quest: TownQuest) => void }) {
  const done = quest.status === "completed"
  const locked = quest.status === "locked"
  const canGo = quest.status === "active" && hasQuestTarget(quest)
  return (
    <li className="pixel-card game-quest" data-status={quest.status} data-state={locked ? "locked" : quest.status === "active" ? "active" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-pixel text-[16px] leading-tight text-(--px-text)">{quest.title}</h3>
          <span className={cn("pixel-label mt-1 inline-flex items-center gap-1", done ? "pixel-label--ok" : locked ? "pixel-label--off" : "pixel-label--common")}>
            {done ? <Check className="h-3 w-3" aria-hidden="true" /> : locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
            {QUEST_STATUS_LABEL[quest.status]}
          </span>
        </div>
        <span className="shrink-0 font-pixel text-[14px] leading-tight tabular-nums text-(--px-accent)">+{formatXp(quest.xpReward)} XP</span>
      </div>
      <p className="mt-1.5 font-pixel text-[14px] leading-snug text-(--px-muted)">{quest.description}</p>
      <div className="mt-2 flex items-center gap-2">
        <GameBar
          value={questRatio(quest)}
          tone={done ? "done" : "quest"}
          label={quest.title}
          valueText={`${Math.min(quest.progress, quest.goal)} of ${quest.goal}`}
          className="flex-1"
        />
        <span className="w-14 shrink-0 text-right font-pixel text-[13px] tabular-nums text-(--px-text)">
          {Math.min(quest.progress, quest.goal)}/{quest.goal}
        </span>
        <button
          type="button"
          onClick={() => onGo(quest)}
          disabled={!canGo}
          className={cn("pixel-btn pixel-btn--teal game-sm", !canGo && "invisible")}
          aria-label={`Go: ${quest.title}`}
        >
          Go
        </button>
      </div>
    </li>
  )
}

/** Loading / API-missing state shared by the quest log and the Town Hall progress tab. */
export function TownUnavailable({ town }: { town: TownProgressState }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center" role="status">
      <span className="pixel-label pixel-label--common">{town.loading ? "Loading progress" : "Progress unavailable"}</span>
      <p className="max-w-80 font-pixel text-[13px] leading-snug text-(--px-muted)">
        {town.loading ? "Counting up your work in Nova…" : town.error || "Nova City could not load your progress."}
      </p>
      {!town.loading ? (
        <button type="button" onClick={town.refresh} className="pixel-btn pixel-btn--teal game-sm">
          Try again
        </button>
      ) : null}
    </div>
  )
}
