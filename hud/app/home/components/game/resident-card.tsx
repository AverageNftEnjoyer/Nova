"use client"

import { Settings2 } from "lucide-react"
import { WORKPLACE_NAME, agentLook, integrationWorkplace, personSheetArt, type CityIntegration } from "@/components/pixel-city"
import type { AgentTask, AgentTaskUiAction, RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import { isIntegrationSetupKey, type IntegrationSetupKey } from "@/lib/integrations/navigation"
import { integrationLabel } from "@/lib/town/quests"
import type { TownBuilding } from "@/lib/town/types"
import type { ResidentId } from "@/lib/town/residents"
import { cn } from "@/lib/shared/utils"
import { defaultAgentName, defaultWorkerName } from "../../hooks/use-city-scene-state"
import type { TownResidentsState } from "../../hooks/use-town-residents"
import { PixelWindow } from "../pixel/pixel-window"
import { AgentCard } from "./agent-card"
import { ResidentRename } from "./resident-rename"
import { integrationBuildingName } from "./town-ui"

type ActionResult = { ok: true } | { ok: false; error: string }

interface ResidentCardProps {
  residentId: ResidentId
  tasks: readonly AgentTask[]
  /** Building levels from GET /api/town (progress.buildings); empty until it has loaded. */
  buildings: readonly TownBuilding[]
  /** Integrations that are connected right now (Home's live flags). */
  connected: ReadonlySet<CityIntegration>
  residents: TownResidentsState
  onClose: () => void
  onAction: (id: string, action: AgentTaskUiAction) => Promise<ActionResult>
  onRaiseBudget: (id: string, input: RaiseAgentTaskBudgetInput) => Promise<ActionResult>
  /** Opens the full Agent Tasks popup. */
  onOpenTasks: () => void
  /** Opens one integration's setup (the router, as the rest of Home does). */
  onSetup: (integration: IntegrationSetupKey) => void
}

/**
 * The card a click on a resident opens. An agent gets its task card (what it is doing, spend, controls); an
 * integration's worker gets that integration's status, building level and a way to its setup. Both can be renamed.
 */
export function ResidentCard(props: ResidentCardProps) {
  const { residentId, tasks, residents, onClose, onAction, onRaiseBudget, onOpenTasks } = props
  if (residentId.startsWith("agent:")) {
    const taskId = residentId.slice("agent:".length)
    const task = tasks.find((candidate) => candidate.id === taskId) ?? null
    return (
      <AgentCard
        task={task}
        onClose={onClose}
        onAction={onAction}
        onRaiseBudget={onRaiseBudget}
        onOpenTasks={onOpenTasks}
        displayName={residents.names[residentId]?.trim() || undefined}
        customizer={task ? <ResidentRename residentId={residentId} defaultName={defaultAgentName(task)} residents={residents} /> : null}
      />
    )
  }
  const key = residentId.slice("integration:".length)
  if (!isIntegrationSetupKey(key)) return null
  return <IntegrationWorkerCard {...props} integration={key} />
}

function IntegrationWorkerCard({
  residentId,
  integration,
  buildings,
  connected,
  residents,
  onClose,
  onSetup,
}: ResidentCardProps & { integration: IntegrationSetupKey }) {
  const label = integrationLabel(integration)
  const isConnected = connected.has(integration as CityIntegration)
  const building = buildings.find((candidate) => candidate.integration === integration)
  const buildingName = integrationBuildingName(integration)
  const workplace = integrationWorkplace(integration as CityIntegration)
  const sheet = agentLook(workplace).sheet
  const art = personSheetArt(sheet)
  const spriteSize = art.cell * 3
  const name = residents.names[residentId]?.trim() || defaultWorkerName(integration as CityIntegration)
  const level = building?.level ?? 0
  const uses = building?.uses ?? 0
  const next = building?.nextLevelUses ?? null

  return (
    <PixelWindow place="U.B Agents worker" theme="integrations" role={label} size="md" onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="game-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <div className="flex gap-3">
            <div className="pixel-card grid shrink-0 place-items-end justify-center overflow-hidden p-0!" style={{ width: 108, height: 104 }}>
              <div
                role="img"
                aria-label={`${name}, ${label} worker`}
                style={{
                  width: spriteSize,
                  height: spriteSize,
                  backgroundImage: `url(${art.url})`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "0 0",
                  backgroundSize: `${art.columns * spriteSize}px ${art.rows * spriteSize}px`,
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="pixel-title line-clamp-2 text-left! text-[17px]! normal-case!" title={name}>
                {name}
              </h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-pixel text-[14px]">
                <span className={cn("pixel-label", isConnected ? "pixel-label--ok" : "pixel-label--off")}>{isConnected ? "Connected" : "Not connected"}</span>
                {building && level > 0 ? <span className={cn("pixel-label", level >= 2 ? "pixel-label--rare" : "pixel-label--common")}>Lv {level}</span> : null}
                <span className="truncate text-(--px-muted)">{label} worker</span>
              </p>
              <p className="mt-1.5 font-pixel text-[14px] leading-snug text-(--px-text)">
                {isConnected
                  ? `Works near the ${buildingName ?? WORKPLACE_NAME[workplace]}, keeping ${label} running for you.`
                  : `${label} is not connected, so nobody works here yet.`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="pixel-card">
              <p className="pixel-label text-(--px-muted)">Building</p>
              <p className="font-pixel text-[14px] leading-tight text-(--px-text)">{buildingName ?? "No building"}</p>
            </div>
            <div className="pixel-card">
              <p className="pixel-label text-(--px-muted)">Level</p>
              <p className="font-pixel text-[15px] tabular-nums text-(--px-text)">{building ? (level === 0 ? "Empty lot" : `Level ${level}`) : "…"}</p>
            </div>
            <div className="pixel-card">
              <p className="pixel-label text-(--px-muted)">Uses</p>
              <p className="font-pixel text-[15px] tabular-nums text-(--px-text)">{building ? uses.toLocaleString("en-US") : "…"}</p>
              {building && next !== null ? <p className="font-pixel text-[12px] tabular-nums text-(--px-muted)">next level at {next.toLocaleString("en-US")}</p> : null}
            </div>
          </div>

          <ResidentRename residentId={residentId} defaultName={defaultWorkerName(integration as CityIntegration)} residents={residents} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t-[3px] border-(--px-frame-line) pt-3">
          <button type="button" onClick={() => onSetup(integration)} className="pixel-btn pixel-btn--teal">
            <Settings2 className="h-4 w-4" />
            {isConnected ? `${label} setup` : `Connect ${label}`}
          </button>
        </div>
      </div>
    </PixelWindow>
  )
}
