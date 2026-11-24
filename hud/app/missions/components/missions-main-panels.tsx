"use client"

import { useState } from "react"
import { Network, Plus, Sparkles } from "lucide-react"

import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SearchInput,
  SkeletonRows,
  Stat,
  StatGroup,
  StatusDot,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  type StatusTone,
} from "@/components/ui"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { MissionTemplate } from "@/lib/missions/templates"
import type { MissionQueueMetrics } from "../api"
import { AI_PROVIDER_LABELS } from "../constants"
import { formatIntegrationLabel } from "../helpers"
import { describeNextRun, describeTrigger, formatRelativeTime } from "../schedule-display"
import type { MissionListItem, MissionRunProgress, MissionRuntimeStatus } from "../types"
import { MissionActionMenu } from "./mission-action-menu"

export interface MissionRowActions {
  onRunNow: (mission: MissionListItem) => void
  onEdit: (mission: MissionListItem) => void
  onOpenCanvas: (missionId: string) => void
  onDuplicate: (mission: MissionListItem) => void
  onToggleEnabled: (mission: MissionListItem) => void
  onDelete: (mission: MissionListItem) => void
}

interface MissionsMainPanelsProps {
  templates: MissionTemplate[]
  integrationsSettings: IntegrationsSettings
  novaMissionPrompt: string
  novaGeneratingMission: boolean
  searchQuery: string
  statusFilter: string
  loading: boolean
  totalCount: number
  stats: { total: number; enabled: number; totalRuns: number; successRate: number }
  filteredSchedules: MissionListItem[]
  busyById: Record<string, boolean>
  runProgress: MissionRunProgress | null
  missionRuntimeStatusById: Record<string, MissionRuntimeStatus>
  missionQueueMetrics: MissionQueueMetrics | null
  formatStatusTime: (value: number) => string
  actions: MissionRowActions
  onNovaMissionPromptChange: (value: string) => void
  onSearchQueryChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onApplyTemplate: (templateId: string) => void
  onGenerateMissionDraft: () => void
  onCreateMission: () => void
}

interface LastRunView {
  tone: StatusTone
  label: string
}

function lastRunView(
  mission: MissionListItem,
  runState: MissionRunProgress | null,
  runtimeStatus: MissionRuntimeStatus | undefined,
  formatStatusTime: (value: number) => string,
): LastRunView {
  if (runState?.running) {
    const total = Math.max(runState.steps.length, 1)
    const runningIndex = runState.steps.findIndex((step) => step.status === "running")
    const done = runState.steps.filter((step) => step.status === "completed" || step.status === "skipped").length
    const step = runningIndex >= 0 ? runningIndex + 1 : Math.min(done + 1, total)
    return { tone: "running", label: `Running ${step}/${total}` }
  }
  if (runtimeStatus?.kind === "running") return { tone: "running", label: `Running ${runtimeStatus.step}/${runtimeStatus.total}` }
  if (runtimeStatus?.kind === "queued") return { tone: "info", label: `Queued ${formatStatusTime(runtimeStatus.at)}` }
  if (runtimeStatus?.kind === "completed") return { tone: "success", label: `Succeeded ${formatStatusTime(runtimeStatus.at)}` }
  if (runtimeStatus?.kind === "failed") return { tone: "danger", label: `Failed ${formatStatusTime(runtimeStatus.at)}` }
  if (mission.lastRunAt) {
    const relative = formatRelativeTime(mission.lastRunAt)
    return { tone: "idle", label: relative ? `Ran ${relative}` : "Ran before" }
  }
  return { tone: "idle", label: "Never run" }
}

export function MissionsMainPanels({
  templates,
  integrationsSettings,
  novaMissionPrompt,
  novaGeneratingMission,
  searchQuery,
  statusFilter,
  loading,
  totalCount,
  stats,
  filteredSchedules,
  busyById,
  runProgress,
  missionRuntimeStatusById,
  missionQueueMetrics,
  formatStatusTime,
  actions,
  onNovaMissionPromptChange,
  onSearchQueryChange,
  onStatusFilterChange,
  onApplyTemplate,
  onGenerateMissionDraft,
  onCreateMission,
}: MissionsMainPanelsProps) {
  const filtersActive = searchQuery.trim().length > 0 || statusFilter !== "all"
  const providerLabel = AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider]
  const [nowMs] = useState(() => Date.now())

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <StatGroup>
          <Stat size="sm" label="Missions" value={<span className="tabular-nums">{stats.total}</span>} />
          <Stat size="sm" label="Active" value={<span className="tabular-nums">{stats.enabled}</span>} />
          <Stat size="sm" label="Runs" value={<span className="tabular-nums">{stats.totalRuns}</span>} />
          <Stat
            size="sm"
            label="Success rate"
            value={<span className="tabular-nums">{stats.totalRuns > 0 ? `${stats.successRate}%` : "None yet"}</span>}
          />
        </StatGroup>

        <Panel flush>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
            <SearchInput
              value={searchQuery}
              onValueChange={onSearchQueryChange}
              placeholder="Search missions"
              size="sm"
              containerClassName="w-full max-w-72"
            />
            <Tabs value={statusFilter} onValueChange={onStatusFilterChange} variant="segmented">
              <TabsList aria-label="Filter by status">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="enabled">Active</TabsTrigger>
                <TabsTrigger value="disabled">Paused</TabsTrigger>
              </TabsList>
            </Tabs>
            {missionQueueMetrics ? (
              <dl className="ml-auto flex items-center gap-4 text-xs text-muted" aria-label="Run queue">
                <div className="flex gap-1.5"><dt>Queued</dt><dd className="font-mono text-fg tabular-nums">{missionQueueMetrics.queueDepth}</dd></div>
                <div className="flex gap-1.5"><dt>Due</dt><dd className="font-mono text-fg tabular-nums">{missionQueueMetrics.dueDepth}</dd></div>
                <div className="flex gap-1.5"><dt>Lag</dt><dd className="font-mono text-fg tabular-nums">{missionQueueMetrics.lagSeconds}s</dd></div>
                <div className="flex gap-1.5"><dt>Failures</dt><dd className="font-mono text-fg tabular-nums">{Math.round(missionQueueMetrics.failureRate * 100)}%</dd></div>
              </dl>
            ) : null}
          </div>

          {loading ? (
            <SkeletonRows rows={5} />
          ) : totalCount === 0 ? (
            <EmptyState
              icon={<Network />}
              title="No missions yet"
              description="Start from a template, generate a draft from a description, or build one step by step."
              action={<Button onClick={onCreateMission}><Plus />New mission</Button>}
            />
          ) : filteredSchedules.length === 0 ? (
            <EmptyState
              size="compact"
              title="No missions match"
              description={filtersActive ? "Change the search or status filter." : undefined}
              action={filtersActive ? (
                <Button variant="secondary" size="sm" onClick={() => { onSearchQueryChange(""); onStatusFilterChange("all") }}>
                  Clear filters
                </Button>
              ) : undefined}
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Mission</Th>
                  <Th>Trigger</Th>
                  <Th numeric>Steps</Th>
                  <Th>Enabled</Th>
                  <Th>Last run</Th>
                  <Th>Next run</Th>
                  <Th numeric>Runs</Th>
                  <Th className="w-10"><span className="sr-only">Actions</span></Th>
                </tr>
              </THead>
              <TBody>
                {filteredSchedules.map((mission) => {
                  const busy = Boolean(busyById[mission.id])
                  const runState = runProgress && runProgress.missionId === mission.id ? runProgress : null
                  const last = lastRunView(mission, runState, missionRuntimeStatusById[mission.id], formatStatusTime)
                  const runs = Number.isFinite(mission.runCount) ? Number(mission.runCount) : 0
                  const successes = Number.isFinite(mission.successCount) ? Number(mission.successCount) : 0
                  const stepCount = Array.isArray(mission.workflowSteps) ? mission.workflowSteps.length : 0
                  const description = String(mission.description || mission.message || "").trim()
                  return (
                    <Tr key={mission.id}>
                      <Td className="max-w-0 w-[34%]">
                        <button
                          type="button"
                          onClick={() => actions.onOpenCanvas(mission.id)}
                          className="block max-w-full truncate text-left font-medium text-fg hover:underline focus-visible:underline"
                        >
                          {mission.label || "Untitled mission"}
                        </button>
                        <p className="truncate text-xs text-muted">
                          {description || `Delivers to ${formatIntegrationLabel(mission.integration)}`}
                        </p>
                      </Td>
                      <Td>
                        <span className="text-fg">{describeTrigger(mission)}</span>
                        <span className="block font-mono text-2xs text-faint">{mission.timezone}</span>
                      </Td>
                      <Td numeric mono>{stepCount}</Td>
                      <Td>
                        <Switch
                          size="sm"
                          checked={mission.enabled}
                          disabled={busy}
                          onCheckedChange={() => actions.onToggleEnabled(mission)}
                          aria-label={mission.enabled ? `Pause ${mission.label}` : `Activate ${mission.label}`}
                        />
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <StatusDot tone={last.tone} />
                          <span className={last.tone === "idle" ? "text-muted" : "text-fg"}>{last.label}</span>
                        </span>
                      </Td>
                      <Td muted className="whitespace-nowrap tabular-nums">{describeNextRun(mission, nowMs)}</Td>
                      <Td numeric mono>
                        {runs}
                        {runs > 0 ? <span className="ml-1.5 text-faint">{Math.round((successes / runs) * 100)}%</span> : null}
                      </Td>
                      <Td className="pr-2 text-right">
                        <MissionActionMenu
                          mission={mission}
                          busy={busy}
                          onRunNow={() => actions.onRunNow(mission)}
                          onEdit={() => actions.onEdit(mission)}
                          onOpenCanvas={() => actions.onOpenCanvas(mission.id)}
                          onDuplicate={() => actions.onDuplicate(mission)}
                          onToggleEnabled={() => actions.onToggleEnabled(mission)}
                          onDelete={() => actions.onDelete(mission)}
                        />
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Generate a draft"
          description={`Drafted by your ${providerLabel} model, saved only after review.`}
          icon={<Sparkles />}
        >
          <div className="flex flex-col gap-2">
            <Textarea
              value={novaMissionPrompt}
              onChange={(e) => onNovaMissionPromptChange(e.target.value)}
              placeholder="Every weekday at 8am, summarize overnight BTC moves and send them to Telegram."
              aria-label="Describe the mission"
              autoGrow
              minRows={3}
              maxRows={8}
            />
            <Button
              variant="secondary"
              onClick={onGenerateMissionDraft}
              loading={novaGeneratingMission}
              disabled={!novaMissionPrompt.trim()}
              className="self-start"
            >
              Generate draft
            </Button>
          </div>
        </Panel>

        <Panel title="Templates" description="Start from a blueprint, then edit it." flush>
          {templates.length === 0 ? (
            <EmptyState size="compact" title="No templates available" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {templates.map((template) => (
                <li key={template.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{template.label}</p>
                    <p className="line-clamp-2 text-xs text-muted">{template.description}</p>
                    {template.tags.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {template.tags.slice(0, 3).map((tag, index) => (
                          <Badge key={`${template.id}-${tag}-${index}`}>{tag}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => onApplyTemplate(template.id)} aria-label={`Use template ${template.label}`}>
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </aside>
    </div>
  )
}
