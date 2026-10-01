"use client"

import { useState, type ReactNode } from "react"
import { cn } from "@/lib/shared/utils"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { TownBuilding, TownProgress, TownQuest } from "@/lib/town/types"
import type { TownProgressState } from "../../hooks/use-town-progress"
import { GameBar } from "./game-bar"
import { TownUnavailable } from "./quest-log-window"
import { formatXp, INTEGRATION_LABELS, integrationBuildingName, questPlace, questRatio, xpProgress } from "./town-ui"

export interface TownHallIntegration {
  setup: IntegrationSetupKey
  label: string
  icon: ReactNode
}

type TownHallTab = "progress" | "integrations"

interface TownHallBodyProps {
  town: TownProgressState
  /** Home's integrations grid, kept as its own tab. */
  integrationsGrid: ReactNode
  /** Icons and names for the buildings list (Home's integration nodes). */
  integrations: readonly TownHallIntegration[]
  onSetup: (setup: IntegrationSetupKey) => void
}

/** Town Hall: the town's progress screen, with the integrations grid it always had on its second tab. */
export function TownHallBody({ town, integrationsGrid, integrations, onSetup }: TownHallBodyProps) {
  // Open on Integrations when the tutorial sent the user here to connect something, else on the town's progress.
  const [tab, setTab] = useState<TownHallTab>(() => {
    const progress = town.progress
    const current = progress?.tutorial.active ? progress.quests.find((quest) => quest.id === progress.tutorial.currentQuestId) : undefined
    return current && current.status === "active" && questPlace(current) === "integrations" ? "integrations" : "progress"
  })
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div role="tablist" aria-label="Town Hall" className="flex shrink-0 gap-1.5">
        {(
          [
            ["progress", "Progress"],
            ["integrations", "Integrations"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="pixel-btn pixel-btn--ghost game-tab" data-active={tab === id ? "true" : undefined}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1">
        {tab === "integrations" ? (
          integrationsGrid
        ) : town.progress ? (
          <TownProgressPanel progress={town.progress} error={town.error} integrations={integrations} onSetup={onSetup} />
        ) : (
          <TownUnavailable town={town} />
        )}
      </div>
    </div>
  )
}

interface TownProgressPanelProps {
  progress: TownProgress
  error: string | null
  integrations: readonly TownHallIntegration[]
  onSetup: (setup: IntegrationSetupKey) => void
}

function TownProgressPanel({ progress, error, integrations, onSetup }: TownProgressPanelProps) {
  const { level } = progress
  const xp = xpProgress(level)
  const sources = [...progress.sources].sort((a, b) => b.xp - a.xp)
  const nextMilestones = progress.quests.filter((quest) => quest.category === "milestone" && quest.status === "active").slice(0, 3)
  const builtCount = progress.buildings.filter((building) => building.connected).length

  return (
    <div className="game-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      {error ? <p className="font-pixel text-[12px] text-(--px-red)">Showing the last update: {error}</p> : null}

      <section className="pixel-card flex items-center gap-3" aria-label="Town level">
        <span className="game-level-num game-level-num--lg" aria-hidden="true">
          <span className="game-level-lv">LV</span>
          <span>{level.level}</span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="pixel-label pixel-label--rare text-[14px]!">{level.title}</span>
            <span className="font-pixel text-[13px] tabular-nums text-(--px-text)">{formatXp(level.xp)} XP total</span>
          </div>
          <GameBar value={xp.ratio} tone="xp" label="Experience" valueText={`${formatXp(xp.into)} of ${formatXp(xp.span)} XP`} />
          <div className="flex justify-between gap-3 font-pixel text-[13px] tabular-nums text-(--px-muted)">
            <span>
              {formatXp(xp.into)} / {formatXp(xp.span)} XP
            </span>
            <span>
              {formatXp(xp.toNext)} XP to Lv {level.level + 1}
            </span>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Buildings" value={`${builtCount}/${progress.buildings.length}`} />
        <Stat label="Quests done" value={`${progress.quests.filter((quest) => quest.status === "completed").length}/${progress.quests.length}`} />
      </dl>

      <section aria-labelledby="town-xp-sources">
        <h3 id="town-xp-sources" className="pixel-label mb-1.5 text-(--px-text)">
          What earned XP
        </h3>
        {sources.length === 0 ? (
          <p className="pixel-card font-pixel text-[14px] text-(--px-muted)">Nothing yet. Finish a quest to earn your first XP.</p>
        ) : (
          <table className="game-table w-full">
            <thead>
              <tr>
                <th scope="col" className="text-left">
                  Source
                </th>
                <th scope="col" className="text-right">
                  Count
                </th>
                <th scope="col" className="text-right">
                  XP
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id} data-zero={source.xp === 0 ? "true" : undefined}>
                  <td>{source.label}</td>
                  <td className="text-right tabular-nums text-(--px-muted)">{formatXp(source.count)}</td>
                  <td className="text-right tabular-nums text-(--px-accent)">{formatXp(source.xp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {nextMilestones.length ? (
        <section aria-labelledby="town-next-unlocks">
          <h3 id="town-next-unlocks" className="pixel-label mb-1.5 text-(--px-text)">
            Next milestones
          </h3>
          <ul className="flex flex-col gap-1.5">
            {nextMilestones.map((quest) => (
              <MilestoneRow key={quest.id} quest={quest} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="town-buildings">
        <h3 id="town-buildings" className="pixel-label mb-1.5 text-(--px-text)">
          Buildings
        </h3>
        {progress.buildings.length === 0 ? (
          <p className="pixel-card font-pixel text-[14px] text-(--px-muted)">No buildings reported yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-1.5">
            {progress.buildings.map((building) => (
              <BuildingRow key={building.integration} building={building} integration={integrations.find((node) => node.setup === building.integration)} onSetup={onSetup} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pixel-card flex flex-col gap-1">
      <dt className="pixel-label text-(--px-muted)">{label}</dt>
      <dd className="font-pixel text-[20px] tabular-nums text-(--px-text)">{value}</dd>
    </div>
  )
}

function MilestoneRow({ quest }: { quest: TownQuest }) {
  return (
    <li className="pixel-card flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-pixel text-[14px] text-(--px-text)">{quest.title}</span>
      <GameBar value={questRatio(quest)} label={quest.title} valueText={`${quest.progress} of ${quest.goal}`} className="w-24 shrink-0" />
      <span className="w-20 shrink-0 text-right font-pixel text-[13px] tabular-nums text-(--px-accent)">+{formatXp(quest.xpReward)} XP</span>
    </li>
  )
}

function BuildingRow({ building, integration, onSetup }: { building: TownBuilding; integration?: TownHallIntegration; onSetup: (setup: IntegrationSetupKey) => void }) {
  const label = integration?.label ?? INTEGRATION_LABELS[building.integration]
  const buildingName = integrationBuildingName(building.integration)
  const next = building.nextLevelUses
  return (
    <li className="pixel-card flex min-w-0 items-center gap-2" data-connected={building.connected ? "true" : "false"} data-state={building.connected ? undefined : "locked"}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">{integration?.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate font-pixel text-[13px] text-(--px-text)">{buildingName ?? label}</span>
          {buildingName ? <span className="truncate font-pixel text-[12px] text-(--px-muted)">{label}</span> : null}
        </span>
        {building.connected ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("pixel-label", building.level >= 2 ? "pixel-label--rare" : "pixel-label--common")}>Lv {building.level}</span>
            <span className="game-pips" aria-label={`Level ${building.level} of 3`}>
              {[1, 2, 3].map((pip) => (
                <span key={pip} className="game-pip" data-on={building.level >= pip ? "true" : undefined} />
              ))}
            </span>
            <span className="truncate font-pixel text-[12px] tabular-nums text-(--px-muted)">
              {next !== null ? `${formatXp(building.uses)}/${formatXp(next)} uses` : `${formatXp(building.uses)} uses · max`}
            </span>
          </span>
        ) : (
          <span className="pixel-label pixel-label--off">Empty lot</span>
        )}
      </span>
      {!building.connected ? (
        <button type="button" onClick={() => onSetup(building.integration)} className="pixel-btn pixel-btn--teal game-sm shrink-0" aria-label={`Set up ${label}`}>
          Build
        </button>
      ) : null}
    </li>
  )
}
