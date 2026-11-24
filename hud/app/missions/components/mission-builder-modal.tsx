"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, GripVertical, Plus, Sparkles, Trash2, X } from "lucide-react"

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
  type SelectOption,
} from "@/components/ui"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { cn } from "@/lib/shared/utils"
import {
  AI_DETAIL_LEVEL_OPTIONS,
  AI_PROVIDER_LABELS,
  PRIORITY_OPTIONS,
  SCHEDULE_MODE_OPTIONS,
  STEP_CONDITION_FAILURE_OPTIONS,
  STEP_CONDITION_LOGIC_OPTIONS,
  STEP_CONDITION_OPERATOR_OPTIONS,
  STEP_FETCH_METHOD_OPTIONS,
  STEP_FETCH_SOURCE_OPTIONS,
  STEP_OUTPUT_FREQUENCY_OPTIONS,
  STEP_OUTPUT_TIMING_OPTIONS,
  STEP_TONE,
  STEP_TRANSFORM_ACTION_OPTIONS,
  STEP_TRANSFORM_FORMAT_OPTIONS,
  STEP_TYPE_OPTIONS,
  WEEKDAY_OPTIONS,
} from "../constants"
import {
  getDefaultModelForProvider,
  getModelOptionsForProvider,
  normalizeAiDetailLevel,
  renderStepIcon,
  sanitizeOutputRecipients,
} from "../helpers"
import type { WorkflowAutofixResponse } from "../api"
import type { AiIntegrationType, WorkflowStep } from "../types"
import { TimeField } from "./time-field"

const COINBASE_INTENT_OPTIONS: SelectOption[] = [
  { value: "report", label: "Portfolio report" },
  { value: "status", label: "Connection status" },
  { value: "price", label: "Spot prices" },
  { value: "portfolio", label: "Portfolio snapshot" },
  { value: "transactions", label: "Transactions" },
]

const COINBASE_CADENCE_OPTIONS: SelectOption[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
]

const COINBASE_FORMAT_STYLE_OPTIONS: SelectOption[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]

export interface MissionBuilderModalProps {
  builderOpen: boolean
  playClickSound: () => void
  setBuilderOpen: (open: boolean) => void
  newLabel: string
  setNewLabel: (value: string) => void
  newDescription: string
  setNewDescription: (value: string) => void
  newPriority: string
  setNewPriority: (value: string) => void
  tagInput: string
  setTagInput: (value: string) => void
  addTag: () => void
  missionTags: string[]
  removeTag: (tag: string) => void
  newTime: string
  setNewTime: (value: string) => void
  newScheduleDays: string[]
  toggleScheduleDay: (day: string) => void
  newScheduleMode: string
  setNewScheduleMode: (mode: string) => void
  workflowSteps: WorkflowStep[]
  workflowAutofixPreview: WorkflowAutofixResponse | null
  workflowAutofixSelectionById: Record<string, boolean>
  workflowAutofixLoading: boolean
  workflowAutofixApplying: boolean
  draggingStepId: string | null
  setDragOverStepId: (id: string | null) => void
  moveWorkflowStepByDrop: (fromId: string, toId: string) => void
  setDraggingStepId: (id: string | null) => void
  dragOverStepId: string | null
  updateWorkflowStepTitle: (id: string, title: string) => void
  toggleWorkflowStepCollapsed: (id: string) => void
  collapsedStepIds: Record<string, boolean>
  removeWorkflowStep: (id: string) => void
  detectedTimezone: string
  updateWorkflowStep: (id: string, updates: Partial<WorkflowStep>) => void
  apiFetchIntegrationOptions: SelectOption[]
  catalogApiById: Record<string, { endpoint?: string }>
  outputChannelOptions: SelectOption[]
  updateWorkflowStepAi: (
    id: string,
    updates: Partial<Pick<WorkflowStep, "aiPrompt" | "aiModel" | "aiIntegration" | "aiDetailLevel">>,
  ) => void
  resolveDefaultAiIntegration: () => AiIntegrationType
  integrationsSettings: IntegrationsSettings
  configuredAiIntegrationOptions: SelectOption[]
  novaSuggestForAiStep: (stepId: string) => Promise<void>
  novaSuggestingByStepId: Record<string, boolean>
  addWorkflowStep: (type: WorkflowStep["type"]) => void
  previewWorkflowFixes: () => Promise<void>
  toggleWorkflowAutofixSelection: (candidateId: string) => void
  applyWorkflowFixes: (strategy: "safe" | "selected") => Promise<void>
  missionActive: boolean
  setMissionActive: (updater: (prev: boolean) => boolean) => void
  runImmediatelyOnCreate: boolean
  setRunImmediatelyOnCreate: (updater: (prev: boolean) => boolean) => void
  editingMissionId: string | null
  deployMissionFromBuilder: () => Promise<void>
  deployingMission: boolean
}

function Section({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-medium text-fg">{title}</h3>
          {description ? <p className="text-xs text-muted">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SwitchRow({ label, hint, checked, onCheckedChange }: { label: string; hint: string; checked: boolean; onCheckedChange: (next: boolean) => void }) {
  return (
    <Field label={label} hint={hint} inline className="rounded-md border border-border-subtle px-3 py-2">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  )
}

export function MissionBuilderModal(props: MissionBuilderModalProps) {
  const {
    builderOpen,
    playClickSound,
    setBuilderOpen,
    newLabel,
    setNewLabel,
    newDescription,
    setNewDescription,
    newPriority,
    setNewPriority,
    tagInput,
    setTagInput,
    addTag,
    missionTags,
    removeTag,
    newTime,
    setNewTime,
    newScheduleDays,
    toggleScheduleDay,
    newScheduleMode,
    setNewScheduleMode,
    workflowSteps,
    workflowAutofixPreview,
    workflowAutofixSelectionById,
    workflowAutofixLoading,
    workflowAutofixApplying,
    draggingStepId,
    setDragOverStepId,
    moveWorkflowStepByDrop,
    setDraggingStepId,
    dragOverStepId,
    updateWorkflowStepTitle,
    toggleWorkflowStepCollapsed,
    collapsedStepIds,
    removeWorkflowStep,
    detectedTimezone,
    updateWorkflowStep,
    apiFetchIntegrationOptions,
    catalogApiById,
    outputChannelOptions,
    updateWorkflowStepAi,
    resolveDefaultAiIntegration,
    integrationsSettings,
    configuredAiIntegrationOptions,
    novaSuggestForAiStep,
    novaSuggestingByStepId,
    addWorkflowStep,
    previewWorkflowFixes,
    toggleWorkflowAutofixSelection,
    applyWorkflowFixes,
    missionActive,
    setMissionActive,
    runImmediatelyOnCreate,
    setRunImmediatelyOnCreate,
    editingMissionId,
    deployMissionFromBuilder,
    deployingMission,
  } = props
  const [timeId] = useState(() => `mission-time-${Math.random().toString(36).slice(2, 8)}`)

  const close = () => {
    playClickSound()
    setBuilderOpen(false)
  }

  const aiProviderOptions = configuredAiIntegrationOptions.length > 0
    ? configuredAiIntegrationOptions
    : [{ value: integrationsSettings.activeLlmProvider, label: AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider] }]

  const renderStepFields = (step: WorkflowStep) => {
    switch (step.type) {
      case "trigger":
        return (
          <p className="text-xs text-muted">
            Runs on the schedule above, in your detected timezone <span className="font-mono">{detectedTimezone}</span>.
          </p>
        )
      case "fetch":
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Data source">
                <Select value={step.fetchSource ?? "web"} options={STEP_FETCH_SOURCE_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { fetchSource: next as WorkflowStep["fetchSource"] })} />
              </Field>
              <Field label="HTTP method">
                <Select mono value={step.fetchMethod ?? "GET"} options={STEP_FETCH_METHOD_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { fetchMethod: next as WorkflowStep["fetchMethod"] })} />
              </Field>
              <Field label="Refresh (minutes)">
                <Input mono inputMode="numeric" value={step.fetchRefreshMinutes ?? "15"} placeholder="15" onChange={(e) => updateWorkflowStep(step.id, { fetchRefreshMinutes: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
              </Field>
            </div>
            {step.fetchSource === "api" && apiFetchIntegrationOptions.length > 0 ? (
              <Field label="API integration">
                <Select
                  value={step.fetchApiIntegrationId ?? ""}
                  options={apiFetchIntegrationOptions}
                  onValueChange={(next) => {
                    const selected = catalogApiById[next]
                    updateWorkflowStep(step.id, { fetchApiIntegrationId: next, fetchUrl: selected?.endpoint || step.fetchUrl || "" })
                  }}
                />
              </Field>
            ) : null}
            {step.fetchSource === "web" ? (
              <p className="rounded-md bg-surface-3 px-3 py-2 text-xs text-muted">Brave search is managed for you. No endpoint or auth headers are needed.</p>
            ) : (
              <Field label="Endpoint URL">
                <Input mono value={step.fetchUrl ?? ""} placeholder="https://api.example.com/data" onChange={(e) => updateWorkflowStep(step.id, { fetchUrl: e.target.value })} />
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Query or params">
                <Input
                  value={step.fetchQuery ?? ""}
                  placeholder={step.fetchSource === "web" ? "nba last night final scores top performers" : "symbol=BTC&window=24h"}
                  onChange={(e) => updateWorkflowStep(step.id, { fetchQuery: e.target.value })}
                />
              </Field>
              <Field label="CSS selector" hint="Used when scraping a web page.">
                <Input mono value={step.fetchSelector ?? ""} placeholder="a[href]" onChange={(e) => updateWorkflowStep(step.id, { fetchSelector: e.target.value })} />
              </Field>
            </div>
            <SwitchRow
              label="Include sources in output"
              hint="Adds one source link per web request."
              checked={step.fetchIncludeSources !== false}
              onCheckedChange={(next) => updateWorkflowStep(step.id, { fetchIncludeSources: next })}
            />
            {step.fetchSource !== "web" ? (
              <Field label="Headers or auth (JSON)">
                <Textarea mono minRows={2} value={step.fetchHeaders ?? ""} placeholder='{"Authorization":"Bearer ..."}' onChange={(e) => updateWorkflowStep(step.id, { fetchHeaders: e.target.value })} />
              </Field>
            ) : null}
          </div>
        )
      case "coinbase":
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Intent">
                <Select value={step.coinbaseIntent ?? "report"} options={COINBASE_INTENT_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { coinbaseIntent: next as WorkflowStep["coinbaseIntent"] })} />
              </Field>
              <Field label="Quote currency">
                <Input
                  mono
                  value={step.coinbaseParams?.quoteCurrency ?? "USD"}
                  placeholder="USD"
                  onChange={(e) => updateWorkflowStep(step.id, { coinbaseParams: { ...(step.coinbaseParams || {}), quoteCurrency: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) } })}
                />
              </Field>
              <Field label="Cadence">
                <Select
                  value={typeof step.coinbaseParams?.cadence === "string" && step.coinbaseParams.cadence ? step.coinbaseParams.cadence : "daily"}
                  options={COINBASE_CADENCE_OPTIONS}
                  onValueChange={(next) => updateWorkflowStep(step.id, { coinbaseParams: { ...(step.coinbaseParams || {}), cadence: next } })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Assets" hint="Comma-separated, up to 8.">
                <Input
                  mono
                  value={Array.isArray(step.coinbaseParams?.assets) ? step.coinbaseParams.assets.join(",") : "BTC,ETH,SOL"}
                  placeholder="BTC,ETH,SOL"
                  onChange={(e) => updateWorkflowStep(step.id, {
                    coinbaseParams: {
                      ...(step.coinbaseParams || {}),
                      assets: e.target.value.split(",").map((item) => item.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean).slice(0, 8),
                    },
                  })}
                />
              </Field>
              <Field label="Threshold %" aside="Optional">
                <Input
                  mono
                  inputMode="decimal"
                  value={Number.isFinite(Number(step.coinbaseParams?.thresholdPct)) ? String(step.coinbaseParams?.thresholdPct) : ""}
                  placeholder="2.5"
                  onChange={(e) => {
                    const nextValue = Number.parseFloat(e.target.value.trim())
                    updateWorkflowStep(step.id, { coinbaseParams: { ...(step.coinbaseParams || {}), thresholdPct: Number.isFinite(nextValue) ? nextValue : undefined } })
                  }}
                />
              </Field>
              <Field label="Transaction limit" aside="Optional">
                <Input
                  mono
                  inputMode="numeric"
                  value={Number.isFinite(Number(step.coinbaseParams?.transactionLimit)) ? String(step.coinbaseParams?.transactionLimit) : ""}
                  placeholder="20"
                  onChange={(e) => {
                    const nextNum = Number.parseInt(e.target.value.replace(/\D/g, "").slice(0, 3) || "0", 10)
                    updateWorkflowStep(step.id, { coinbaseParams: { ...(step.coinbaseParams || {}), transactionLimit: Number.isFinite(nextNum) && nextNum > 0 ? nextNum : undefined } })
                  }}
                />
              </Field>
              <Field label="Format style">
                <Select
                  value={step.coinbaseFormat?.style ?? "standard"}
                  options={COINBASE_FORMAT_STYLE_OPTIONS}
                  onValueChange={(next) => updateWorkflowStep(step.id, { coinbaseFormat: { ...(step.coinbaseFormat || {}), style: next as NonNullable<WorkflowStep["coinbaseFormat"]>["style"] } })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SwitchRow
                label="Use prior Coinbase results"
                hint="Pulls recent step artifacts from this mission."
                checked={step.coinbaseParams?.includePreviousArtifactContext !== false}
                onCheckedChange={(next) => updateWorkflowStep(step.id, { coinbaseParams: { ...(step.coinbaseParams || {}), includePreviousArtifactContext: next } })}
              />
              <SwitchRow
                label="Keep raw metadata"
                hint="Stores tool metadata with the summary."
                checked={step.coinbaseFormat?.includeRawMetadata !== false}
                onCheckedChange={(next) => updateWorkflowStep(step.id, { coinbaseFormat: { ...(step.coinbaseFormat || {}), includeRawMetadata: next } })}
              />
            </div>
          </div>
        )
      case "transform":
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Action">
                <Select value={step.transformAction ?? "normalize"} options={STEP_TRANSFORM_ACTION_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { transformAction: next as WorkflowStep["transformAction"] })} />
              </Field>
              <Field label="Output format">
                <Select value={step.transformFormat ?? "markdown"} options={STEP_TRANSFORM_FORMAT_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { transformFormat: next as WorkflowStep["transformFormat"] })} />
              </Field>
            </div>
            <Field label="Rules">
              <Textarea
                minRows={3}
                value={step.transformInstruction ?? ""}
                placeholder="Normalize fields, dedupe by ID, sort by priority, format for output."
                onChange={(e) => updateWorkflowStep(step.id, { transformInstruction: e.target.value })}
              />
            </Field>
          </div>
        )
      case "condition":
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Field">
                <Input mono value={step.conditionField ?? ""} placeholder="priceChangePct" onChange={(e) => updateWorkflowStep(step.id, { conditionField: e.target.value })} />
              </Field>
              <Field label="Operator">
                <Select value={step.conditionOperator ?? "contains"} options={STEP_CONDITION_OPERATOR_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { conditionOperator: next as WorkflowStep["conditionOperator"] })} />
              </Field>
              <Field label="Expected value">
                <Input
                  value={step.conditionValue ?? ""}
                  placeholder="5"
                  disabled={(step.conditionOperator ?? "contains") === "exists"}
                  onChange={(e) => updateWorkflowStep(step.id, { conditionValue: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Rule logic">
                <Select value={step.conditionLogic ?? "all"} options={STEP_CONDITION_LOGIC_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { conditionLogic: next as WorkflowStep["conditionLogic"] })} />
              </Field>
              <Field label="If the condition fails">
                <Select value={step.conditionFailureAction ?? "skip"} options={STEP_CONDITION_FAILURE_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { conditionFailureAction: next as WorkflowStep["conditionFailureAction"] })} />
              </Field>
            </div>
          </div>
        )
      case "output":
        return (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Delivery channel">
              <Select
                value={step.outputChannel ?? "telegram"}
                options={outputChannelOptions}
                onValueChange={(next) => {
                  const nextChannel = next as WorkflowStep["outputChannel"]
                  updateWorkflowStep(step.id, {
                    outputChannel: nextChannel,
                    outputTime: newTime,
                    outputTiming: step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate",
                    outputFrequency: step.outputFrequency === "multiple" ? "multiple" : "once",
                    outputRepeatCount: step.outputFrequency === "multiple" ? (step.outputRepeatCount || "3") : "1",
                    outputRecipients: sanitizeOutputRecipients(nextChannel, step.outputRecipients),
                    outputTemplate: "",
                  })
                }}
              />
            </Field>
            <Field label="Notify when">
              <Select value={step.outputTiming ?? "immediate"} options={STEP_OUTPUT_TIMING_OPTIONS} onValueChange={(next) => updateWorkflowStep(step.id, { outputTiming: next as WorkflowStep["outputTiming"], outputTime: newTime })} />
            </Field>
            <Field label="Notification count">
              <Select
                value={step.outputFrequency ?? "once"}
                options={STEP_OUTPUT_FREQUENCY_OPTIONS}
                onValueChange={(next) => {
                  const outputFrequency = next as WorkflowStep["outputFrequency"]
                  updateWorkflowStep(step.id, { outputFrequency, outputRepeatCount: outputFrequency === "multiple" ? (step.outputRepeatCount || "3") : "1" })
                }}
              />
            </Field>
          </div>
        )
      case "ai": {
        const provider = step.aiIntegration ?? resolveDefaultAiIntegration()
        return (
          <div className="flex flex-col gap-3">
            <Field
              label="Prompt"
              aside={(
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => { playClickSound(); void novaSuggestForAiStep(step.id) }}
                  loading={Boolean(novaSuggestingByStepId[step.id])}
                >
                  <Sparkles />
                  Suggest a prompt
                </Button>
              )}
            >
              <Textarea minRows={3} value={step.aiPrompt ?? ""} placeholder="Describe what the model should do with the data." onChange={(e) => updateWorkflowStepAi(step.id, { aiPrompt: e.target.value })} />
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Provider">
                <Select
                  value={provider}
                  options={aiProviderOptions}
                  onValueChange={(next) => {
                    const nextIntegration = next as AiIntegrationType
                    updateWorkflowStepAi(step.id, { aiIntegration: nextIntegration, aiModel: getDefaultModelForProvider(nextIntegration, integrationsSettings) })
                  }}
                />
              </Field>
              <Field label="Model">
                <Select mono value={step.aiModel ?? ""} options={getModelOptionsForProvider(provider, integrationsSettings, step.aiModel)} onValueChange={(next) => updateWorkflowStepAi(step.id, { aiModel: next })} />
              </Field>
              <Field label="Detail level">
                <Select value={step.aiDetailLevel ?? "standard"} options={AI_DETAIL_LEVEL_OPTIONS} onValueChange={(next) => updateWorkflowStepAi(step.id, { aiDetailLevel: normalizeAiDetailLevel(next) })} />
              </Field>
            </div>
          </div>
        )
      }
      default:
        return null
    }
  }

  const noSelectedFixes = Object.values(workflowAutofixSelectionById).every((selected) => !selected)

  return (
    <Dialog open={builderOpen} onOpenChange={(open) => { if (!open) close() }} size="xl" dismissible={false} className="max-h-[86vh]">
      <DialogHeader>
        <DialogTitle>{editingMissionId ? "Edit mission" : "New mission"}</DialogTitle>
        <DialogDescription>Set a schedule and the steps it runs. Missions with branching graphs are edited on the canvas.</DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5 pt-1">
        <Section title="Details">
          <Field label="Name" required>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Daily team sync" data-autofocus />
          </Field>
          <Field label="Description" required>
            <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} minRows={2} autoGrow maxRows={6} placeholder="What does this mission accomplish?" />
          </Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
            <Field label="Priority">
              <Select value={newPriority} options={PRIORITY_OPTIONS} onValueChange={setNewPriority} />
            </Field>
            <Field label="Tags" hint="Press Enter to add a tag.">
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  placeholder="research"
                />
                <Button variant="secondary" onClick={addTag} disabled={!tagInput.trim()}>Add</Button>
              </div>
            </Field>
          </div>
          {missionTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Tags">
              {missionTags.map((tag) => (
                <Badge key={tag} variant="outline" className="pr-0.5">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="inline-flex size-4 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-fg"
                  >
                    <X />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
        </Section>

        <Section title="Schedule" description={`Times use ${detectedTimezone}.`}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[12rem_10rem_minmax(0,1fr)] md:items-end">
            <Field label="Time" id={timeId}>
              <TimeField id={timeId} value24={newTime} onChange24={setNewTime} />
            </Field>
            <Field label="Repeat">
              <Select value={newScheduleMode} options={SCHEDULE_MODE_OPTIONS} onValueChange={setNewScheduleMode} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">Days</span>
              <div role="group" aria-label="Days" className="grid grid-cols-7 gap-1">
                {WEEKDAY_OPTIONS.map((day) => {
                  const selected = newScheduleDays.includes(day.id)
                  return (
                    <button
                      key={day.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleScheduleDay(day.id)}
                      className={cn(
                        "h-8 rounded-md border text-xs font-medium transition-colors",
                        selected ? "border-accent-border bg-accent-muted text-accent-text" : "border-border text-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Steps"
          description="Steps run top to bottom. Drag the handle to reorder."
          aside={<span className="text-xs text-muted tabular-nums">{workflowSteps.length} {workflowSteps.length === 1 ? "step" : "steps"}</span>}
        >
          {workflowSteps.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted">
              No steps yet. Add a trigger and an output to get started.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {workflowSteps.map((step, index) => {
                const collapsed = Boolean(collapsedStepIds[step.id])
                return (
                  <li
                    key={step.id}
                    onDragOver={(event) => {
                      if (!draggingStepId || draggingStepId === step.id) return
                      event.preventDefault()
                      setDragOverStepId(step.id)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!draggingStepId || draggingStepId === step.id) return
                      moveWorkflowStepByDrop(draggingStepId, step.id)
                      setDraggingStepId(null)
                      setDragOverStepId(null)
                    }}
                    onDragLeave={() => {
                      if (dragOverStepId === step.id) setDragOverStepId(null)
                    }}
                    className={cn(
                      "overflow-hidden rounded-lg border border-border bg-surface-2 border-l-2",
                      dragOverStepId === step.id && "border-accent-border bg-accent-muted",
                      draggingStepId === step.id && "opacity-60",
                    )}
                    style={{ borderLeftColor: STEP_TONE[step.type] }}
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move"
                          event.dataTransfer.setData("text/plain", step.id)
                          setDraggingStepId(step.id)
                        }}
                        onDragEnd={() => {
                          setDraggingStepId(null)
                          setDragOverStepId(null)
                        }}
                        className="inline-flex size-6 cursor-grab items-center justify-center rounded-sm text-faint hover:bg-hover active:cursor-grabbing"
                        aria-label={`Drag step ${index + 1} to reorder`}
                      >
                        <GripVertical className="size-3.5" />
                      </button>
                      <span className="w-4 text-center font-mono text-2xs text-faint tabular-nums">{index + 1}</span>
                      <span style={{ color: STEP_TONE[step.type] }} className="inline-flex">{renderStepIcon(step.type, "size-3.5")}</span>
                      <Input
                        value={step.title}
                        onChange={(e) => updateWorkflowStepTitle(step.id, e.target.value)}
                        aria-label={`Step ${index + 1} name`}
                        size="sm"
                        className="border-transparent bg-transparent hover:border-border focus:border-border"
                      />
                      <span className="hidden shrink-0 text-xs text-faint sm:inline">
                        {STEP_TYPE_OPTIONS.find((option) => option.type === step.type)?.label}
                      </span>
                      <IconButton
                        size="sm"
                        aria-label={collapsed ? "Expand step details" : "Collapse step details"}
                        aria-expanded={!collapsed}
                        onClick={() => toggleWorkflowStepCollapsed(step.id)}
                      >
                        {collapsed ? <ChevronRight /> : <ChevronDown />}
                      </IconButton>
                      <IconButton size="sm" aria-label={`Remove step ${index + 1}`} onClick={() => { playClickSound(); removeWorkflowStep(step.id) }}>
                        <Trash2 />
                      </IconButton>
                    </div>
                    {!collapsed ? <div className="border-t border-border-subtle bg-surface px-3 py-3">{renderStepFields(step)}</div> : null}
                  </li>
                )
              })}
            </ol>
          )}
          <div className="flex flex-wrap gap-1.5" aria-label="Add a step">
            {STEP_TYPE_OPTIONS.map((option) => (
              <Button
                key={option.type}
                variant="outline"
                size="sm"
                onClick={() => { playClickSound(); addWorkflowStep(option.type) }}
              >
                <Plus />
                <span style={{ color: STEP_TONE[option.type] }} className="inline-flex">{renderStepIcon(option.type, "size-3.5")}</span>
                {option.label}
              </Button>
            ))}
          </div>
        </Section>

        <Section
          title="Workflow check"
          description="Preview ranked fixes. Low-risk fixes can be applied together; medium and high risk need your approval."
          aside={(
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => void previewWorkflowFixes()} loading={workflowAutofixLoading} disabled={workflowAutofixApplying}>
                Preview fixes
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void applyWorkflowFixes("safe")} disabled={workflowAutofixLoading || workflowAutofixApplying}>
                Apply safe
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void applyWorkflowFixes("selected")}
                loading={workflowAutofixApplying}
                disabled={workflowAutofixLoading || noSelectedFixes}
              >
                Apply selected
              </Button>
            </div>
          )}
        >
          {workflowAutofixPreview ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted tabular-nums">
                Issues before {workflowAutofixPreview.issueReduction.before}, after {workflowAutofixPreview.issueReduction.after}
              </p>
              {workflowAutofixPreview.candidates.length === 0 ? (
                <p className="text-sm text-muted">No fixes suggested for this workflow.</p>
              ) : (
                <ul className="max-h-48 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border">
                  {workflowAutofixPreview.candidates.map((candidate) => {
                    const needsApproval = candidate.disposition === "needs_approval"
                    const selected = Boolean(workflowAutofixSelectionById[candidate.id])
                    return (
                      <li key={candidate.id} className="flex items-start gap-2.5 px-3 py-2">
                        <Checkbox
                          checked={needsApproval ? selected : true}
                          disabled={!needsApproval}
                          onCheckedChange={() => { if (needsApproval) toggleWorkflowAutofixSelection(candidate.id) }}
                          aria-label={`Select fix ${candidate.title}`}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-fg">{candidate.title}</span>
                            <Badge tone={candidate.risk === "low" ? "success" : candidate.risk === "medium" ? "warning" : "danger"}>{candidate.risk} risk</Badge>
                            <span className="font-mono text-2xs text-faint tabular-nums">{Math.round(candidate.confidence * 100)}%</span>
                          </div>
                          <p className="text-xs text-muted">{candidate.changePreview}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </Section>
      </DialogBody>

      <DialogFooter className="justify-between">
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-fg">
            <Switch checked={missionActive} onCheckedChange={() => setMissionActive((prev) => !prev)} aria-label="Mission active" />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <Switch
              checked={runImmediatelyOnCreate}
              onCheckedChange={() => setRunImmediatelyOnCreate((prev) => !prev)}
              aria-label={editingMissionId ? "Run once after saving" : "Run once after creating"}
            />
            Run once after saving
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button onClick={() => { playClickSound(); void deployMissionFromBuilder() }} loading={deployingMission}>
            {editingMissionId ? "Save mission" : "Create mission"}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
