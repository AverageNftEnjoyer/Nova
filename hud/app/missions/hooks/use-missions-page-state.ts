"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { type FluidSelectOption } from "@/components/ui/fluid-select"
import { getCachedBackgroundVideoObjectUrl, isBackgroundAssetImage, loadBackgroundVideoObjectUrl } from "@/lib/media/backgroundVideoStorage"
import { normalizeIntegrationCatalog, type IntegrationCatalogItem } from "@/lib/integrations/catalog"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations/client-store"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type ThemeBackgroundType } from "@/lib/userSettings"

import {
  AI_PROVIDER_LABELS,
  FALLBACK_OUTPUT_CHANNEL_OPTIONS,
  QUICK_TEMPLATE_OPTIONS,
  STEP_TYPE_OPTIONS,
} from "../constants"
import {
  buildMissionFromPrompt,
  createMissionSchedule,
  deleteMissionSchedule,
  fetchIntegrationCatalog as fetchIntegrationCatalogApi,
  fetchSchedules as fetchSchedulesApi,
  requestNovaSuggest,
  triggerMissionScheduleStream,
  updateMissionSchedule,
  type BuildMissionResponse,
  type NovaSuggestResponse,
} from "../api"
import {
  buildBuilderWorkflowStepsFromMeta,
  getDefaultModelForProvider,
  hexToRgba,
  isWorkflowStepType,
  normalizeAiDetailLevel,
  normalizeCachedBackground,
  normalizeFetchIncludeSources,
  normalizePriority,
  parseMissionWorkflowMeta,
  resolveCustomBackgroundIsImage,
  resolveThemeBackground,
  sanitizeOutputRecipients,
} from "../helpers"
import { useMissionsSpotlight } from "./use-missions-spotlight"
import { useAutoClearStatus, useAutoDismissRunProgress, useMissionActionMenuDismiss } from "./use-missions-transient-effects"
import type {
  AiIntegrationType,
  MissionActionMenuState,
  MissionRunProgress,
  MissionRunStepTrace,
  MissionRuntimeStatus,
  MissionStatusMessage,
  NotificationSchedule,
  WorkflowStep,
  WorkflowStepType,
} from "../types"

interface UseMissionsPageStateInput {
  isLight: boolean
}

export function useMissionsPageState({ isLight }: UseMissionsPageStateInput) {
  const router = useRouter()
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [background, setBackground] = useState<ThemeBackgroundType>(() => {
    const cached = readShellUiCache()
    return normalizeCachedBackground(cached.background) ?? resolveThemeBackground(isLight)
  })
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(() => {
    const cached = readShellUiCache().backgroundVideoUrl
    if (cached) return cached
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    return getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
  })
  const [backgroundMediaIsImage, setBackgroundMediaIsImage] = useState<boolean>(() => resolveCustomBackgroundIsImage())
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const [schedules, setSchedules] = useState<NotificationSchedule[]>([])
  const [baselineById, setBaselineById] = useState<Record<string, NotificationSchedule>>({})
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<MissionStatusMessage>(null)
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})
  const [deployingMission, setDeployingMission] = useState(false)
  const [pendingDeleteMission, setPendingDeleteMission] = useState<NotificationSchedule | null>(null)
  const [missionActionMenu, setMissionActionMenu] = useState<MissionActionMenuState | null>(null)

  const [newLabel, setNewLabel] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [newTime, setNewTime] = useState("09:00")
  const [detectedTimezone, setDetectedTimezone] = useState("America/New_York")
  const [newPriority, setNewPriority] = useState("medium")
  const [newScheduleMode, setNewScheduleMode] = useState("daily")
  const [newScheduleDays, setNewScheduleDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"])
  const [integrationsSettings, setIntegrationsSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null)
  const [missionActive, setMissionActive] = useState(true)
  const [tagInput, setTagInput] = useState("")
  const [missionTags, setMissionTags] = useState<string[]>([])
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([])
  const [collapsedStepIds, setCollapsedStepIds] = useState<Record<string, boolean>>({})
  const [integrationCatalog, setIntegrationCatalog] = useState<IntegrationCatalogItem[]>([])
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null)
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null)
  const [novaSuggestingByStepId, setNovaSuggestingByStepId] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [missionBoardView, setMissionBoardView] = useState<"grid" | "list">("grid")
  const [novaMissionPrompt, setNovaMissionPrompt] = useState("")
  const [novaGeneratingMission, setNovaGeneratingMission] = useState(false)
  const [runImmediatelyOnCreate, setRunImmediatelyOnCreate] = useState(false)
  const [runProgress, setRunProgress] = useState<MissionRunProgress | null>(null)
  const [missionRuntimeStatusById, setMissionRuntimeStatusById] = useState<Record<string, MissionRuntimeStatus>>({})
  const runProgressAnimationTimerRef = useRef<number | null>(null)

  const catalogApiById = useMemo(() => {
    const next: Record<string, IntegrationCatalogItem> = {}
    for (const item of integrationCatalog) {
      if (item.kind !== "api") continue
      next[item.id] = item
    }
    return next
  }, [integrationCatalog])

  const apiFetchIntegrationOptions = useMemo<FluidSelectOption[]>(
    () =>
      integrationCatalog
        .filter((item) => item.kind === "api" && item.connected)
        .map((item) => ({ value: item.id, label: item.label })),
    [integrationCatalog],
  )

  const outputChannelOptions = useMemo<FluidSelectOption[]>(() => {
    const connected = integrationCatalog
      .filter((item) => item.kind === "channel" && item.connected)
      .map((item) => ({ value: item.id, label: item.label }))

    const combined = connected.length > 0
      ? [...connected, ...FALLBACK_OUTPUT_CHANNEL_OPTIONS]
      : FALLBACK_OUTPUT_CHANNEL_OPTIONS

    const deduped: FluidSelectOption[] = []
    const seen = new Set<string>()
    for (const option of combined) {
      const value = String(option.value || "").trim().toLowerCase()
      if (!value || seen.has(value)) continue
      seen.add(value)
      deduped.push({ value, label: option.label })
    }
    return deduped
  }, [integrationCatalog])

  const formatStatusTime = useCallback((value: number) => {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }, [])

  const listSectionRef = useRef<HTMLElement | null>(null)
  const createSectionRef = useRef<HTMLElement | null>(null)
  const heroHeaderRef = useRef<HTMLDivElement | null>(null)
  const builderBodyRef = useRef<HTMLDivElement | null>(null)
  const builderFooterRef = useRef<HTMLDivElement | null>(null)
  const headerActionsRef = useRef<HTMLDivElement | null>(null)
  const missionActionMenuRef = useRef<HTMLDivElement | null>(null)

  const configuredAiIntegrationOptions = useMemo<FluidSelectOption[]>(() => {
    const options: FluidSelectOption[] = []
    if (integrationsSettings.openai.connected || integrationsSettings.openai.apiKeyConfigured) {
      options.push({ value: "openai", label: AI_PROVIDER_LABELS.openai })
    }
    if (integrationsSettings.claude.connected || integrationsSettings.claude.apiKeyConfigured) {
      options.push({ value: "claude", label: AI_PROVIDER_LABELS.claude })
    }
    if (integrationsSettings.grok.connected || integrationsSettings.grok.apiKeyConfigured) {
      options.push({ value: "grok", label: AI_PROVIDER_LABELS.grok })
    }
    if (integrationsSettings.gemini.connected || integrationsSettings.gemini.apiKeyConfigured) {
      options.push({ value: "gemini", label: AI_PROVIDER_LABELS.gemini })
    }
    return options
  }, [integrationsSettings])

  const resolveDefaultAiIntegration = useCallback((): AiIntegrationType => {
    if (configuredAiIntegrationOptions.length > 0) {
      return configuredAiIntegrationOptions[0].value as AiIntegrationType
    }
    return integrationsSettings.activeLlmProvider
  }, [configuredAiIntegrationOptions, integrationsSettings.activeLlmProvider])

  const createWorkflowStep = useCallback((type: WorkflowStepType, titleOverride?: string): WorkflowStep => {
    const id = `${type}-${Date.now()}-${Math.random()}`
    if (type === "trigger") {
      return {
        id,
        type,
        title: titleOverride ?? "Mission triggered",
        triggerMode: "daily",
        triggerTime: "09:00",
        triggerTimezone: detectedTimezone || "America/New_York",
        triggerDays: ["mon", "tue", "wed", "thu", "fri"],
        triggerIntervalMinutes: "30",
      }
    }
    if (type === "fetch") {
      return {
        id,
        type,
        title: titleOverride ?? "Fetch source data",
        fetchSource: "web",
        fetchMethod: "GET",
        fetchApiIntegrationId: "",
        fetchUrl: "",
        fetchQuery: "",
        fetchHeaders: "",
        fetchSelector: "a[href]",
        fetchRefreshMinutes: "15",
        fetchIncludeSources: true,
      }
    }
    if (type === "transform") {
      return {
        id,
        type,
        title: titleOverride ?? "Transform payload",
        transformAction: "normalize",
        transformFormat: "markdown",
        transformInstruction: "",
      }
    }
    if (type === "condition") {
      return {
        id,
        type,
        title: titleOverride ?? "Evaluate conditions",
        conditionField: "priority",
        conditionOperator: "contains",
        conditionValue: "high",
        conditionLogic: "all",
        conditionFailureAction: "skip",
      }
    }
    if (type === "output") {
      return {
        id,
        type,
        title: titleOverride ?? "Send notification",
        outputChannel: "telegram",
        outputTiming: "immediate",
        outputTime: "09:00",
        outputFrequency: "once",
        outputRepeatCount: "3",
        outputRecipients: "",
        outputTemplate: "",
      }
    }
    const aiIntegration = resolveDefaultAiIntegration()
    const aiModel = getDefaultModelForProvider(aiIntegration, integrationsSettings)
    return {
      id,
      type,
      title: titleOverride ?? "New AI Process step",
      aiPrompt: "",
      aiIntegration,
      aiModel,
      aiDetailLevel: "standard",
    }
  }, [detectedTimezone, integrationsSettings, resolveDefaultAiIntegration])

  const setItemBusy = useCallback((id: string, busy: boolean) => {
    setBusyById((prev) => ({ ...prev, [id]: busy }))
  }, [])

  const resetMissionBuilder = useCallback(() => {
    setEditingMissionId(null)
    setNewLabel("")
    setNewDescription("")
    setNewTime("09:00")
    setNewPriority("medium")
    setNewScheduleMode("daily")
    setNewScheduleDays(["mon", "tue", "wed", "thu", "fri"])
    setMissionActive(true)
    setTagInput("")
    setMissionTags([])
    setWorkflowSteps([])
    setCollapsedStepIds({})
    setRunImmediatelyOnCreate(false)
  }, [])

  const applyTemplate = useCallback((templateId: string) => {
    const template = QUICK_TEMPLATE_OPTIONS.find((item) => item.id === templateId)
    if (!template) return
    setEditingMissionId(null)
    setNewPriority(template.priority)
    setNewLabel(template.title)
    setNewDescription(template.description)
    setNewTime(template.time)
    setMissionTags(template.tags)
    // Create base workflow steps and then apply template-specific overrides
    setWorkflowSteps(
      template.steps.map((step) => {
        const baseStep = createWorkflowStep(step.type, step.title)
        // Apply template-specific properties
        return {
          ...baseStep,
          // Fetch step overrides
          ...(step.fetchQuery ? { fetchQuery: step.fetchQuery } : {}),
          ...(step.fetchSource ? { fetchSource: step.fetchSource } : {}),
          ...(step.fetchUrl ? { fetchUrl: step.fetchUrl } : {}),
          ...(step.fetchIncludeSources !== undefined ? { fetchIncludeSources: step.fetchIncludeSources } : {}),
          // AI step overrides
          ...(step.aiPrompt ? { aiPrompt: step.aiPrompt } : {}),
          ...(step.aiIntegration ? { aiIntegration: step.aiIntegration } : {}),
          ...(step.aiDetailLevel ? { aiDetailLevel: step.aiDetailLevel } : {}),
          // Trigger overrides
          ...(step.triggerMode ? { triggerMode: step.triggerMode } : {}),
          ...(step.triggerIntervalMinutes ? { triggerIntervalMinutes: step.triggerIntervalMinutes } : {}),
          // Condition overrides
          ...(step.conditionField ? { conditionField: step.conditionField } : {}),
          ...(step.conditionOperator ? { conditionOperator: step.conditionOperator } : {}),
          ...(step.conditionValue ? { conditionValue: step.conditionValue } : {}),
          ...(step.conditionFailureAction ? { conditionFailureAction: step.conditionFailureAction } : {}),
          // Output overrides
          ...(step.outputChannel ? { outputChannel: step.outputChannel } : {}),
          ...(step.outputTiming ? { outputTiming: step.outputTiming } : {}),
        }
      }),
    )
    setCollapsedStepIds({})
    setBuilderOpen(true)
  }, [createWorkflowStep])

  const toggleScheduleDay = useCallback((day: string) => {
    setNewScheduleDays((prev) => (
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]
    ))
  }, [])

  const addWorkflowStep = useCallback((type: WorkflowStepType) => {
    setWorkflowSteps((prev) => [...prev, createWorkflowStep(type)])
  }, [createWorkflowStep])

  const toggleWorkflowStepCollapsed = useCallback((id: string) => {
    setCollapsedStepIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const updateWorkflowStepTitle = useCallback((id: string, title: string) => {
    setWorkflowSteps((prev) => prev.map((step) => (step.id === id ? { ...step, title } : step)))
  }, [])

  const updateWorkflowStep = useCallback((id: string, updates: Partial<WorkflowStep>) => {
    setWorkflowSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...updates } : step)))
  }, [])

  const updateWorkflowStepAi = useCallback(
    (id: string, updates: Partial<Pick<WorkflowStep, "aiPrompt" | "aiModel" | "aiIntegration" | "aiDetailLevel">>) => {
      setWorkflowSteps((prev) => (
        prev.map((step) => {
          if (step.id !== id || step.type !== "ai") return step
          const nextIntegration = (updates.aiIntegration ?? step.aiIntegration ?? resolveDefaultAiIntegration()) as AiIntegrationType
          const nextModel = updates.aiModel ?? step.aiModel ?? getDefaultModelForProvider(nextIntegration, integrationsSettings)
          return {
            ...step,
            ...updates,
            aiIntegration: nextIntegration,
            aiModel: nextModel,
          }
        })
      ))
    },
    [integrationsSettings, resolveDefaultAiIntegration],
  )

  const removeWorkflowStep = useCallback((id: string) => {
    setWorkflowSteps((prev) => prev.filter((step) => step.id !== id))
    setCollapsedStepIds((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const toPendingRunSteps = useCallback((steps: Array<Partial<WorkflowStep>> | undefined): MissionRunStepTrace[] => {
    const nowIso = new Date().toISOString()
    if (!Array.isArray(steps) || steps.length === 0) {
      return [{ stepId: "output", type: "output", title: "Run mission output", status: "running", startedAt: nowIso }]
    }
    return steps.map((step, index) => ({
      stepId: String(step.id || `step-${index + 1}`),
      type: String(step.type || "output"),
      title: (() => {
        const rawTitle = String(step.title || STEP_TYPE_OPTIONS.find((option) => option.type === step.type)?.label || `Step ${index + 1}`)
        const channel = String(step.outputChannel || "").trim().toLowerCase()
        if (String(step.type || "").toLowerCase() !== "output") return rawTitle
        if (channel === "novachat" && /telegram/i.test(rawTitle)) return rawTitle.replace(/telegram/ig, "NovaChat")
        if (channel === "novachat" && /^send notification$/i.test(rawTitle)) return "Send to NovaChat"
        return rawTitle
      })(),
      status: index === 0 ? "running" : "pending",
      startedAt: index === 0 ? nowIso : undefined,
    }))
  }, [])

  const stopRunProgressAnimation = useCallback(() => {
    if (runProgressAnimationTimerRef.current !== null) {
      window.clearInterval(runProgressAnimationTimerRef.current)
      runProgressAnimationTimerRef.current = null
    }
  }, [])

  const startRunProgressAnimation = useCallback((missionId: string) => {
    stopRunProgressAnimation()
    setRunProgress((prev) => {
      if (!prev || !prev.running || prev.missionId !== missionId) return prev
      if (!Array.isArray(prev.steps) || prev.steps.length === 0) return prev
      const nowIso = new Date().toISOString()
      const runningIndex = prev.steps.findIndex((step) => step.status === "running")
      if (runningIndex >= 0) {
        return {
          ...prev,
          steps: prev.steps.map((step, index) => (
            index === runningIndex
              ? { ...step, startedAt: step.startedAt || nowIso }
              : step
          )),
        }
      }
      return {
        ...prev,
        steps: prev.steps.map((step, index) => ({
          ...step,
          status: index === 0 ? "running" : "pending",
          startedAt: index === 0 ? (step.startedAt || nowIso) : step.startedAt,
        })),
      }
    })
  }, [stopRunProgressAnimation])

  const normalizeRunStepTraces = useCallback(
    (
      raw: unknown,
      fallbackSteps: MissionRunStepTrace[],
    ): MissionRunStepTrace[] => {
      if (!Array.isArray(raw)) return fallbackSteps
      const mapped = raw
        .map((item, index): MissionRunStepTrace | null => {
          if (!item || typeof item !== "object") return null
          const next = item as {
            stepId?: string
            type?: string
            title?: string
            status?: string
            detail?: string
            startedAt?: string
            endedAt?: string
          }
          const status = String(next.status || "").toLowerCase()
          const normalizedStatus: "pending" | "running" | "completed" | "failed" | "skipped" =
            status === "running" || status === "completed" || status === "failed" || status === "skipped"
              ? status
              : "pending"
          return {
            stepId: String(next.stepId || `step-${index + 1}`),
            type: String(next.type || "output"),
            title: (() => {
              const rawTitle = String(next.title || `Step ${index + 1}`)
              const detail = String(next.detail || "")
              if (String(next.type || "").toLowerCase() === "output" && /via\s+novachat/i.test(detail) && /telegram/i.test(rawTitle)) {
                return rawTitle.replace(/telegram/ig, "NovaChat")
              }
              return rawTitle
            })(),
            status: normalizedStatus,
            detail: typeof next.detail === "string" && next.detail.trim() ? next.detail.trim() : undefined,
            startedAt: typeof next.startedAt === "string" && next.startedAt.trim() ? next.startedAt : undefined,
            endedAt: typeof next.endedAt === "string" && next.endedAt.trim() ? next.endedAt : undefined,
          }
        })
        .filter((item): item is MissionRunStepTrace => item !== null)
      return mapped.length > 0 ? mapped : fallbackSteps
    },
    [],
  )

  const applyStreamingStepTrace = useCallback((missionId: string, trace: {
    stepId?: string
    type?: string
    title?: string
    status?: string
    detail?: string
    startedAt?: string
    endedAt?: string
  }) => {
    setRunProgress((prev) => {
      if (!prev || prev.missionId !== missionId || !Array.isArray(prev.steps) || prev.steps.length === 0) return prev
      const stepId = String(trace.stepId || "").trim()
      const matchIndex = stepId
        ? prev.steps.findIndex((step) => step.stepId === stepId)
        : prev.steps.findIndex((step) => String(step.type || "").toLowerCase() === String(trace.type || "").toLowerCase() && step.status === "running")
      if (matchIndex < 0) return prev
      const statusRaw = String(trace.status || "").toLowerCase()
      const status: MissionRunStepTrace["status"] =
        statusRaw === "completed" || statusRaw === "failed" || statusRaw === "skipped" || statusRaw === "running"
          ? statusRaw
          : "pending"
      const finished = status === "completed" || status === "failed" || status === "skipped"
      const nextIndex = matchIndex + 1
      const nextStartedAt = typeof trace.endedAt === "string" && trace.endedAt.trim() ? trace.endedAt : new Date().toISOString()
      return {
        ...prev,
        steps: prev.steps.map((step, index) => {
          if (index === matchIndex) {
            return {
              ...step,
              title: String(trace.title || step.title || `Step ${index + 1}`),
              status,
              detail: typeof trace.detail === "string" && trace.detail.trim() ? trace.detail.trim() : step.detail,
              startedAt: typeof trace.startedAt === "string" && trace.startedAt.trim() ? trace.startedAt : step.startedAt,
              endedAt: typeof trace.endedAt === "string" && trace.endedAt.trim() ? trace.endedAt : step.endedAt,
            }
          }
          if (finished && index === nextIndex && step.status === "pending") {
            return {
              ...step,
              status: "running",
              startedAt: step.startedAt || nextStartedAt,
            }
          }
          return step
        }),
      }
    })
  }, [])

  const mapWorkflowStepsForBuilder = useCallback(
    (rawSteps: Array<Partial<WorkflowStep>> | undefined, fallbackTime: string, fallbackTimezone: string): WorkflowStep[] => {
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
        return [
          createWorkflowStep("trigger", "Mission triggered"),
          createWorkflowStep("output", "Send notification"),
        ]
      }

      const mapped = rawSteps.map((step) => {
        const resolvedType: WorkflowStepType = isWorkflowStepType(String(step.type || "")) ? String(step.type) as WorkflowStepType : "output"
        const base = createWorkflowStep(resolvedType, typeof step.title === "string" ? step.title : undefined)

        if (resolvedType === "trigger") {
          return {
            ...base,
            title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
            triggerMode: step.triggerMode === "once" || step.triggerMode === "daily" || step.triggerMode === "weekly" || step.triggerMode === "interval"
              ? step.triggerMode
              : base.triggerMode,
            triggerTime: typeof step.triggerTime === "string" && /^\d{2}:\d{2}$/.test(step.triggerTime) ? step.triggerTime : (fallbackTime || base.triggerTime),
            triggerTimezone: typeof step.triggerTimezone === "string" && step.triggerTimezone.trim() ? step.triggerTimezone.trim() : (fallbackTimezone || base.triggerTimezone),
            triggerDays: Array.isArray(step.triggerDays) && step.triggerDays.length > 0 ? step.triggerDays.map((day) => String(day)) : base.triggerDays,
            triggerIntervalMinutes: typeof step.triggerIntervalMinutes === "string" && step.triggerIntervalMinutes.trim() ? step.triggerIntervalMinutes : base.triggerIntervalMinutes,
          } as WorkflowStep
        }

        if (resolvedType === "fetch") {
          return {
            ...base,
            title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
            fetchSource: step.fetchSource === "api" || step.fetchSource === "web" || step.fetchSource === "calendar" || step.fetchSource === "crypto" || step.fetchSource === "rss" || step.fetchSource === "database"
              ? step.fetchSource
              : base.fetchSource,
            fetchMethod: (String(step.fetchMethod || "").toUpperCase() === "POST" ? "POST" : "GET") as "GET" | "POST",
            fetchApiIntegrationId: typeof step.fetchApiIntegrationId === "string" ? step.fetchApiIntegrationId : base.fetchApiIntegrationId,
            fetchUrl: typeof step.fetchUrl === "string" ? step.fetchUrl : base.fetchUrl,
            fetchQuery: typeof step.fetchQuery === "string" ? step.fetchQuery : base.fetchQuery,
            fetchHeaders: typeof step.fetchHeaders === "string" ? step.fetchHeaders : base.fetchHeaders,
            fetchSelector: typeof step.fetchSelector === "string" ? step.fetchSelector : base.fetchSelector,
            fetchRefreshMinutes: typeof step.fetchRefreshMinutes === "string" && step.fetchRefreshMinutes.trim() ? step.fetchRefreshMinutes : base.fetchRefreshMinutes,
            fetchIncludeSources: normalizeFetchIncludeSources(step.fetchIncludeSources),
          } as WorkflowStep
        }

        if (resolvedType === "transform") {
          return {
            ...base,
            title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
            transformAction: step.transformAction === "normalize" || step.transformAction === "dedupe" || step.transformAction === "aggregate" || step.transformAction === "format" || step.transformAction === "enrich"
              ? step.transformAction
              : base.transformAction,
            transformFormat: step.transformFormat === "text" || step.transformFormat === "json" || step.transformFormat === "markdown" || step.transformFormat === "table"
              ? step.transformFormat
              : base.transformFormat,
            transformInstruction: typeof step.transformInstruction === "string" ? step.transformInstruction : base.transformInstruction,
          } as WorkflowStep
        }

        if (resolvedType === "condition") {
          return {
            ...base,
            title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
            conditionField: typeof step.conditionField === "string" ? step.conditionField : base.conditionField,
            conditionOperator: step.conditionOperator === "contains" || step.conditionOperator === "equals" || step.conditionOperator === "not_equals" || step.conditionOperator === "greater_than" || step.conditionOperator === "less_than" || step.conditionOperator === "regex" || step.conditionOperator === "exists"
              ? step.conditionOperator
              : base.conditionOperator,
            conditionValue: typeof step.conditionValue === "string" ? step.conditionValue : base.conditionValue,
            conditionLogic: (step.conditionLogic === "any" ? "any" : "all") as "all" | "any",
            conditionFailureAction: step.conditionFailureAction === "notify" || step.conditionFailureAction === "stop" ? step.conditionFailureAction : "skip",
          } as WorkflowStep
        }

        if (resolvedType === "ai") {
          const aiIntegration = step.aiIntegration === "openai" || step.aiIntegration === "claude" || step.aiIntegration === "grok" || step.aiIntegration === "gemini"
            ? step.aiIntegration
            : resolveDefaultAiIntegration()
          return {
            ...base,
            title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
            aiPrompt: typeof step.aiPrompt === "string" ? step.aiPrompt : base.aiPrompt,
            aiIntegration,
            aiModel: typeof step.aiModel === "string" && step.aiModel.trim() ? step.aiModel : getDefaultModelForProvider(aiIntegration, integrationsSettings),
            aiDetailLevel: normalizeAiDetailLevel(step.aiDetailLevel),
          } as WorkflowStep
        }

        return {
          ...base,
          title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
          outputChannel: step.outputChannel === "novachat" || step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
            ? step.outputChannel
            : base.outputChannel,
          outputTiming: step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate",
          outputTime: typeof step.outputTime === "string" && /^\d{2}:\d{2}$/.test(step.outputTime) ? step.outputTime : (fallbackTime || base.outputTime),
          outputFrequency: step.outputFrequency === "multiple" ? "multiple" : "once",
          outputRepeatCount: typeof step.outputRepeatCount === "string" && step.outputRepeatCount.trim() ? step.outputRepeatCount : base.outputRepeatCount,
          outputRecipients: sanitizeOutputRecipients(
            step.outputChannel === "novachat" || step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
              ? step.outputChannel
              : base.outputChannel,
            typeof step.outputRecipients === "string" ? step.outputRecipients : base.outputRecipients,
          ),
          outputTemplate: typeof step.outputTemplate === "string" ? step.outputTemplate : base.outputTemplate,
        } as WorkflowStep
      })

      return mapped
    },
    [createWorkflowStep, integrationsSettings, resolveDefaultAiIntegration],
  )

  const generateMissionDraftFromPrompt = useCallback(async () => {
    const prompt = novaMissionPrompt.trim()
    if (!prompt) {
      setStatus({ type: "error", message: "Enter a prompt for Nova to generate a mission." })
      return
    }

    setNovaGeneratingMission(true)
    setStatus(null)
    try {
      const response = await buildMissionFromPrompt({
        prompt,
        deploy: false,
        timezone: (detectedTimezone || "America/New_York").trim(),
        enabled: true,
      })
      const data = response.data as BuildMissionResponse
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!response.ok) {
        throw new Error([data?.error || "Failed to generate mission draft.", data?.debug ? `(${data.debug})` : ""].filter(Boolean).join(" "))
      }

      const summary = data.workflow?.summary
      if (!summary) throw new Error("Nova returned an invalid mission draft.")

      const generatedTime = typeof summary.schedule?.time === "string" && /^\d{2}:\d{2}$/.test(summary.schedule.time) ? summary.schedule.time : "09:00"
      const generatedTimezone = typeof summary.schedule?.timezone === "string" && summary.schedule.timezone.trim()
        ? summary.schedule.timezone.trim()
        : (detectedTimezone || "America/New_York")
      const generatedMode = summary.schedule?.mode === "weekly" || summary.schedule?.mode === "once" ? summary.schedule.mode : "daily"
      const generatedDays = Array.isArray(summary.schedule?.days) && summary.schedule?.days.length > 0
        ? summary.schedule.days.map((day) => String(day))
        : ["mon", "tue", "wed", "thu", "fri"]

      setEditingMissionId(null)
      setNewLabel(String(data.workflow?.label || "Generated Mission").trim() || "Generated Mission")
      setNewDescription(String(summary.description || prompt).trim())
      setNewTime(generatedTime)
      setDetectedTimezone(generatedTimezone)
      setNewPriority(normalizePriority(summary.priority))
      setNewScheduleMode(generatedMode)
      setNewScheduleDays(generatedDays)
      setMissionActive(summary.missionActive !== false)
      setTagInput("")
      setMissionTags(Array.isArray(summary.tags) ? summary.tags.map((tag) => String(tag)).filter(Boolean) : [])
      setWorkflowSteps(mapWorkflowStepsForBuilder(summary.workflowSteps, generatedTime, generatedTimezone))
      setCollapsedStepIds({})
      setBuilderOpen(true)
      setNovaMissionPrompt("")

      const providerLabel = String(data.provider || integrationsSettings.activeLlmProvider).toUpperCase()
      const modelLabel = String(data.model || getDefaultModelForProvider(integrationsSettings.activeLlmProvider, integrationsSettings))
      setStatus({
        type: "success",
        message: `Draft generated with ${providerLabel} (${modelLabel}). ${String(data.debug || "").trim() || ""} Review before saving.`.replace(/\s+/g, " ").trim(),
      })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Nova mission generation failed." })
    } finally {
      setNovaGeneratingMission(false)
    }
  }, [detectedTimezone, integrationsSettings, mapWorkflowStepsForBuilder, novaMissionPrompt, router])

  const novaSuggestForAiStep = useCallback(async (stepId: string) => {
    const step = workflowSteps.find((item) => item.id === stepId && item.type === "ai")
    if (!step || step.type !== "ai") return

    const provider = integrationsSettings.activeLlmProvider
    const model = getDefaultModelForProvider(provider, integrationsSettings)

    setNovaSuggestingByStepId((prev) => ({ ...prev, [stepId]: true }))
    setStatus(null)

    try {
      const stepTitle = String(step.title || "").trim() || "AI Process"
      const response = await requestNovaSuggest({
        stepTitle,
      })
      const data = response.data as NovaSuggestResponse
      if (!response.ok) {
        throw new Error(data?.error || "Nova suggest request failed.")
      }

      const suggestedPrompt = String(data?.prompt || "").trim()
      if (!suggestedPrompt) throw new Error("Nova returned an empty suggestion.")
      updateWorkflowStepAi(stepId, {
        aiIntegration: provider,
        aiModel: model,
        aiPrompt: suggestedPrompt,
      })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Nova suggest failed." })
    } finally {
      setNovaSuggestingByStepId((prev) => ({ ...prev, [stepId]: false }))
    }
  }, [integrationsSettings, updateWorkflowStepAi, workflowSteps])

  const moveWorkflowStepByDrop = useCallback((fromId: string, toId: string) => {
    setWorkflowSteps((prev) => {
      const fromIndex = prev.findIndex((step) => step.id === fromId)
      const toIndex = prev.findIndex((step) => step.id === toId)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }, [])

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim()
    if (!trimmed) return
    setMissionTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setTagInput("")
  }, [tagInput])

  const removeTag = useCallback((tag: string) => {
    setMissionTags((prev) => prev.filter((item) => item !== tag))
  }, [])

  const playClickSound = useCallback(() => {
    try {
      const settings = loadUserSettings()
      if (!settings.app.soundEnabled) return
      const audio = new Audio("/sounds/click.mp3")
      audio.volume = 0.9
      audio.currentTime = 0
      void audio.play().catch(() => {})
    } catch {}
  }, [])

  const refreshSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetchSchedulesApi()
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Unauthorized")
      }
      const data = response.data
      const next = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
      setSchedules(next)
      const baseline: Record<string, NotificationSchedule> = {}
      for (const item of next) baseline[item.id] = item
      setBaselineById(baseline)
    } catch {
      setStatus({ type: "error", message: "Failed to load missions." })
      setSchedules([])
      setBaselineById({})
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const refreshIntegrationSettings = () => {
      setIntegrationsSettings(loadIntegrationsSettings())
    }
    refreshIntegrationSettings()
    const onUpdated = () => refreshIntegrationSettings()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener("storage", onUpdated)
    return () => {
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener("storage", onUpdated)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | null = null
    const refreshCatalog = async () => {
      try {
        const response = await fetchIntegrationCatalogApi()
        const payload = response.data
        if (cancelled) return
        setIntegrationCatalog(normalizeIntegrationCatalog(payload.catalog))
      } catch {
        if (!cancelled) {
          setIntegrationCatalog([])
          if (refreshTimer === null) {
            refreshTimer = window.setTimeout(() => {
              refreshTimer = null
              if (!cancelled) void refreshCatalog()
            }, 15000)
          }
        }
      }
    }

    void refreshCatalog()
    const onUpdated = () => {
      void refreshCatalog()
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener("storage", onUpdated)
    return () => {
      cancelled = true
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
        refreshTimer = null
      }
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener("storage", onUpdated)
    }
  }, [])

  useAutoClearStatus(status, setStatus)
  useMissionActionMenuDismiss({
    missionActionMenu,
    missionActionMenuRef,
    setMissionActionMenu,
  })

  useEffect(() => {
    if (configuredAiIntegrationOptions.length === 0) return
    const allowed = new Set(configuredAiIntegrationOptions.map((option) => option.value as AiIntegrationType))
    const fallbackIntegration = configuredAiIntegrationOptions[0].value as AiIntegrationType
    setWorkflowSteps((prev) => (
      prev.map((step) => {
        if (step.type !== "ai") return step
        const aiIntegration = step.aiIntegration && allowed.has(step.aiIntegration) ? step.aiIntegration : fallbackIntegration
        const aiModel = step.aiModel && step.aiModel.trim().length > 0
          ? step.aiModel
          : getDefaultModelForProvider(aiIntegration, integrationsSettings)
        return { ...step, aiIntegration, aiModel }
      })
    ))
  }, [configuredAiIntegrationOptions, integrationsSettings])

  useLayoutEffect(() => {
    const cached = readShellUiCache()
    const userSettings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? userSettings.app.orbColor
    const nextBackground = normalizeCachedBackground(cached.background) ?? resolveThemeBackground(isLight)
    const nextSpotlight = cached.spotlightEnabled ?? (userSettings.app.spotlightEnabled ?? true)
    setOrbColor(nextOrbColor)
    setBackground(nextBackground)
    setBackgroundMediaIsImage(isBackgroundAssetImage(userSettings.app.customBackgroundVideoMimeType, userSettings.app.customBackgroundVideoFileName))
    setSpotlightEnabled(nextSpotlight)
    writeShellUiCache({
      orbColor: nextOrbColor,
      background: nextBackground,
      spotlightEnabled: nextSpotlight,
    })

    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof localTimezone === "string" && localTimezone.trim().length > 0) {
      setDetectedTimezone(localTimezone)
    }
  }, [isLight])

  useEffect(() => {
    void refreshSchedules()
  }, [refreshSchedules])

  useEffect(() => {
    const refresh = () => {
      const userSettings = loadUserSettings()
      setOrbColor(userSettings.app.orbColor)
      const nextBackground = resolveThemeBackground(isLight)
      setBackground(nextBackground)
      setBackgroundMediaIsImage(isBackgroundAssetImage(userSettings.app.customBackgroundVideoMimeType, userSettings.app.customBackgroundVideoFileName))
      setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: userSettings.app.orbColor,
        background: nextBackground,
        spotlightEnabled: userSettings.app.spotlightEnabled ?? true,
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [isLight])

  useEffect(() => {
    let cancelled = false
    if (isLight || background !== "customVideo") return

    const uiCached = readShellUiCache().backgroundVideoUrl
    if (uiCached) {
      setBackgroundVideoUrl(uiCached)
    }
    const app = loadUserSettings().app
    setBackgroundMediaIsImage(isBackgroundAssetImage(app.customBackgroundVideoMimeType, app.customBackgroundVideoFileName))
    const selectedAssetId = app.customBackgroundVideoAssetId
    const cached = getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
    if (cached) {
      setBackgroundVideoUrl(cached)
      writeShellUiCache({ backgroundVideoUrl: cached })
    }
    void loadBackgroundVideoObjectUrl(selectedAssetId || undefined)
      .then((url) => {
        if (cancelled) return
        setBackgroundVideoUrl(url)
        writeShellUiCache({ backgroundVideoUrl: url })
      })
      .catch(() => {
        if (cancelled) return
        const fallback = readShellUiCache().backgroundVideoUrl
        if (!fallback) setBackgroundVideoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [background, isLight])

  useLayoutEffect(() => {
    const nextBackground = resolveThemeBackground(isLight)
    setBackground(nextBackground)
    writeShellUiCache({ background: nextBackground })
  }, [isLight])

  useMissionsSpotlight({
    spotlightEnabled,
    builderOpen,
    createSectionRef,
    listSectionRef,
    headerActionsRef,
    builderBodyRef,
    builderFooterRef,
  })

  const updateLocalSchedule = useCallback((id: string, patch: Partial<NotificationSchedule>) => {
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const deployMissionFromBuilder = useCallback(async () => {
    const label = newLabel.trim()
    const description = newDescription.trim()
    const message = description
    const time = newTime.trim()
    const timezone = (detectedTimezone || "America/New_York").trim()
    const isEditing = Boolean(editingMissionId)

    if (!label) {
      setStatus({ type: "error", message: "Mission name is required." })
      return
    }
    if (!message) {
      setStatus({ type: "error", message: "Mission description is required." })
      return
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setStatus({ type: "error", message: "Time must be HH:mm (24h)." })
      return
    }
    if (newScheduleMode !== "daily" && newScheduleDays.length === 0) {
      setStatus({ type: "error", message: "Select at least one day for weekly/once schedules." })
      return
    }
    if (workflowSteps.length === 0) {
      setStatus({ type: "error", message: "Add at least one workflow step." })
      return
    }

    const workflowStepsForSave = workflowSteps.map((step) => {
      if (step.type !== "output") return step
      const outputChannel = step.outputChannel === "novachat" || step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
        ? step.outputChannel
        : "telegram"
      const outputTiming = step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate"
      const outputFrequency = step.outputFrequency === "multiple" ? "multiple" : "once"
      const outputRepeatCount = outputFrequency === "multiple"
        ? (typeof step.outputRepeatCount === "string" && /^\d{1,2}$/.test(step.outputRepeatCount) ? step.outputRepeatCount : "3")
        : "1"
      return {
        ...step,
        outputChannel,
        outputTiming,
        outputFrequency,
        outputRepeatCount,
        outputTime: time,
        outputRecipients: "",
        outputTemplate: "",
      }
    })

    const derivedIntegration = (
      workflowStepsForSave.find((step) => step.type === "output")?.outputChannel?.trim().toLowerCase() || "telegram"
    )
    const derivedApiCalls = Array.from(
      new Set(
        workflowStepsForSave.flatMap((step) => {
          if (step.type === "fetch") {
            if (step.fetchApiIntegrationId) return [`INTEGRATION:${step.fetchApiIntegrationId}`]
            if (step.fetchUrl?.trim()) return [`${step.fetchMethod === "POST" ? "POST" : "GET"} ${step.fetchUrl.trim()}`]
            return [`FETCH:${step.fetchSource || "api"}`]
          }
          if (step.type === "ai") return [`LLM:${step.aiIntegration || integrationsSettings.activeLlmProvider}`]
          if (step.type === "output") return [`OUTPUT:${step.outputChannel || "telegram"}`]
          return []
        }),
      ),
    )

    setBuilderOpen(false)
    setDeployingMission(true)
    setStatus(null)
    try {
      const workflowSummary = {
        description,
        priority: newPriority,
        schedule: {
          mode: newScheduleMode,
          days: newScheduleDays,
          time,
          timezone,
        },
        missionActive,
        tags: missionTags,
        apiCalls: derivedApiCalls,
        workflowSteps: workflowStepsForSave,
      }

      const payload = {
        integration: derivedIntegration,
        label,
        message: `${message}\n\n[NOVA WORKFLOW]\n${JSON.stringify(workflowSummary)}`,
        time,
        timezone,
        enabled: missionActive,
        chatIds: [],
      }
      const response = isEditing
        ? await updateMissionSchedule({
          id: editingMissionId,
          ...payload,
          resetLastSent: true,
        })
        : await createMissionSchedule(payload)
      const data = response.data as { schedule?: NotificationSchedule; error?: string }
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!response.ok) throw new Error(data?.error || (isEditing ? "Failed to save mission" : "Failed to create mission"))

      const createdSchedule = data?.schedule
      // Immediately add the new mission to the list so it shows up right away
      if (!isEditing && createdSchedule) {
        setSchedules((prev) => [createdSchedule, ...prev])
      }

      let immediateRunNovachatQueued = false
      if (runImmediatelyOnCreate) {
        const runScheduleId = isEditing
          ? (typeof editingMissionId === "string" ? editingMissionId.trim() : "")
          : (typeof data?.schedule?.id === "string" ? data.schedule.id.trim() : "")
        if (!runScheduleId) {
          throw new Error(
            isEditing
              ? "Mission was saved but immediate run could not start (missing schedule id)."
              : "Mission was created but immediate run could not start (missing schedule id).",
          )
        }
        const pendingSteps = toPendingRunSteps(workflowStepsForSave as Array<Partial<WorkflowStep>>)
        const runningTotal = Math.max(pendingSteps.length, 1)
        setMissionRuntimeStatusById((prev) => ({
          ...prev,
          [runScheduleId]: { kind: "running", step: 1, total: runningTotal },
        }))
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: true,
          success: false,
          steps: pendingSteps,
        })
        startRunProgressAnimation(runScheduleId)
        const triggerData = await triggerMissionScheduleStream(runScheduleId, (event) => {
          if (event.type === "step" && event.trace) {
            applyStreamingStepTrace(runScheduleId, event.trace)
          }
        })
        immediateRunNovachatQueued = Boolean(triggerData?.novachatQueued)
        const finalizedSteps = normalizeRunStepTraces(triggerData?.stepTraces, pendingSteps)
        stopRunProgressAnimation()
        if (!triggerData?.ok) {
        const failedAt = Date.now()
        setMissionRuntimeStatusById((prev) => ({
          ...prev,
          [runScheduleId]: { kind: "failed", at: failedAt },
        }))
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: false,
          success: false,
            reason: triggerData?.error || triggerData?.reason || "Immediate run failed.",
            steps: finalizedSteps,
            outputResults: Array.isArray(triggerData?.results) ? triggerData.results : [],
            novachatQueued: immediateRunNovachatQueued,
          })
          if (Array.isArray(triggerData?.results) && triggerData.results.length > 0) {
            console.debug("[missions] output results", triggerData.results)
          }
          throw new Error(triggerData?.error || (isEditing ? "Mission was saved but immediate run failed." : "Mission was created but immediate run failed."))
        }
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: false,
          success: Boolean(triggerData?.ok),
          reason: triggerData?.reason,
          steps: finalizedSteps,
          outputResults: Array.isArray(triggerData?.results) ? triggerData.results : [],
          novachatQueued: immediateRunNovachatQueued,
        })
        if (Array.isArray(triggerData?.results) && triggerData.results.length > 0) {
          console.debug("[missions] output results", triggerData.results)
        }
        if (triggerData?.schedule) {
          updateLocalSchedule(runScheduleId, triggerData.schedule)
          setBaselineById((prev) => ({ ...prev, [runScheduleId]: triggerData.schedule as NotificationSchedule }))
        } else {
          setSchedules((prev) =>
            prev.map((item) =>
              item.id === runScheduleId
                ? {
                    ...item,
                    runCount: (Number.isFinite(item.runCount) ? Number(item.runCount) : 0) + 1,
                    successCount:
                      (Number.isFinite(item.successCount) ? Number(item.successCount) : 0) + (triggerData?.ok ? 1 : 0),
                    failureCount:
                      (Number.isFinite(item.failureCount) ? Number(item.failureCount) : 0) + (triggerData?.ok ? 0 : 1),
                    lastRunAt: new Date().toISOString(),
                  }
                : item,
            ),
          )
        }
        const finishedAt = Date.now()
        setMissionRuntimeStatusById((prev) => ({
          ...prev,
          [runScheduleId]: triggerData?.ok ? { kind: "completed", at: finishedAt } : { kind: "failed", at: finishedAt },
        }))
      }

      setStatus({
        type: "success",
        message: runImmediatelyOnCreate
          ? (isEditing
            ? (immediateRunNovachatQueued ? "Mission saved, run started, and NovaChat is ready." : "Mission saved and run started.")
            : (immediateRunNovachatQueued ? "Mission deployed, run started, and NovaChat is ready." : "Mission deployed and run started."))
          : (isEditing ? "Mission saved." : "Mission deployed."),
      })
      setBuilderOpen(false)
      resetMissionBuilder()
      await refreshSchedules()
    } catch (error) {
      stopRunProgressAnimation()
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to deploy mission." })
    } finally {
      setDeployingMission(false)
    }
  }, [
    detectedTimezone,
    editingMissionId,
    integrationsSettings.activeLlmProvider,
    missionActive,
    missionTags,
    newDescription,
    newLabel,
    newPriority,
    newScheduleDays,
    newScheduleMode,
    newTime,
    runImmediatelyOnCreate,
    refreshSchedules,
    resetMissionBuilder,
    router,
    toPendingRunSteps,
    normalizeRunStepTraces,
    applyStreamingStepTrace,
    startRunProgressAnimation,
    stopRunProgressAnimation,
    updateLocalSchedule,
    workflowSteps,
  ])

  const saveMission = useCallback(async (mission: NotificationSchedule) => {
    const baseline = baselineById[mission.id]
    const timeChanged = baseline ? baseline.time !== mission.time : true
    const timezoneChanged = baseline ? baseline.timezone !== (detectedTimezone || "America/New_York").trim() : true
    const enabledChanged = baseline ? baseline.enabled !== mission.enabled : true

    setItemBusy(mission.id, true)
    setStatus(null)
    try {
      const response = await updateMissionSchedule({
        id: mission.id,
        integration: mission.integration,
        label: mission.label,
        message: mission.message,
        time: mission.time,
        timezone: (detectedTimezone || "America/New_York").trim(),
        enabled: mission.enabled,
        chatIds: [],
        resetLastSent: timeChanged || timezoneChanged || enabledChanged,
      })
      const data = response.data as { schedule?: NotificationSchedule; error?: string }
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!response.ok) throw new Error(data?.error || "Failed to save mission")
      const updated = data?.schedule as NotificationSchedule | undefined
      if (updated) {
        updateLocalSchedule(mission.id, updated)
        setBaselineById((prev) => ({ ...prev, [mission.id]: updated }))
      }
      setStatus({ type: "success", message: `Mission \"${mission.label}\" saved.` })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save mission." })
      if (baseline) updateLocalSchedule(mission.id, baseline)
    } finally {
      setItemBusy(mission.id, false)
    }
  }, [baselineById, detectedTimezone, router, setItemBusy, updateLocalSchedule])

  const deleteMission = useCallback(async (id: string) => {
    setItemBusy(id, true)
    setStatus(null)
    try {
      const response = await deleteMissionSchedule(id)
      const data = response.data as { error?: string }
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!response.ok) throw new Error(data?.error || "Failed to delete mission")
      setSchedules((prev) => prev.filter((s) => s.id !== id))
      setBaselineById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setMissionRuntimeStatusById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setStatus({ type: "success", message: "Mission deleted." })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to delete mission." })
    } finally {
      setItemBusy(id, false)
    }
  }, [router, setItemBusy])

  const confirmDeleteMission = useCallback(async () => {
    if (!pendingDeleteMission) return
    await deleteMission(pendingDeleteMission.id)
    setPendingDeleteMission(null)
  }, [deleteMission, pendingDeleteMission])

  const editMissionFromActions = useCallback((mission: NotificationSchedule) => {
    const meta = parseMissionWorkflowMeta(mission.message)
    setEditingMissionId(mission.id)
    setRunImmediatelyOnCreate(false)
    setNewLabel(mission.label || "")
    setNewDescription(meta.description || mission.message || "")
    setNewTime(mission.time || "09:00")
    if (mission.timezone) setDetectedTimezone(mission.timezone)
    setMissionActive(Boolean(mission.enabled))
    if (meta.priority) setNewPriority(meta.priority)
    if (meta.mode) setNewScheduleMode(meta.mode)
    if (Array.isArray(meta.days) && meta.days.length > 0) setNewScheduleDays(meta.days)
    setMissionTags(Array.isArray(meta.tags) ? meta.tags : [])
    setWorkflowSteps(buildBuilderWorkflowStepsFromMeta({
      mission,
      rawSteps: meta.workflowSteps,
      idPrefix: "edit",
      detectedTimezone,
      integrationsSettings,
      resolveDefaultAiIntegration,
    }))
    setCollapsedStepIds({})
    setBuilderOpen(true)
  }, [detectedTimezone, integrationsSettings, resolveDefaultAiIntegration])

  const duplicateMission = useCallback(async (mission: NotificationSchedule) => {
    const meta = parseMissionWorkflowMeta(mission.message)
    setEditingMissionId(null)
    setNewLabel(`${mission.label || "Mission"} (Copy)`)
    setNewDescription(meta.description || mission.message || "")
    setNewTime(mission.time || "09:00")
    if (mission.timezone) setDetectedTimezone(mission.timezone)
    setMissionActive(Boolean(mission.enabled))
    if (meta.priority) setNewPriority(meta.priority)
    if (meta.mode) setNewScheduleMode(meta.mode)
    if (Array.isArray(meta.days) && meta.days.length > 0) setNewScheduleDays(meta.days)
    setMissionTags(Array.isArray(meta.tags) ? meta.tags : [])
    setWorkflowSteps(buildBuilderWorkflowStepsFromMeta({
      mission,
      rawSteps: meta.workflowSteps,
      idPrefix: "duplicate",
      detectedTimezone,
      integrationsSettings,
      resolveDefaultAiIntegration,
    }))
    setCollapsedStepIds({})
    setRunImmediatelyOnCreate(false)
    setBuilderOpen(true)
    setStatus({ type: "success", message: "Mission duplicated into builder. Configure and deploy." })
  }, [detectedTimezone, integrationsSettings, resolveDefaultAiIntegration])

  const runMissionNow = useCallback(async (mission: NotificationSchedule) => {
    setStatus(null)
    const meta = parseMissionWorkflowMeta(mission.message)
    const pendingSteps = toPendingRunSteps(meta.workflowSteps)
    const runningTotal = Math.max(pendingSteps.length, 1)
    setMissionRuntimeStatusById((prev) => ({
      ...prev,
      [mission.id]: { kind: "running", step: 1, total: runningTotal },
    }))
    setRunProgress({
      missionId: mission.id,
      missionLabel: mission.label || "Untitled mission",
      running: true,
      success: false,
      steps: pendingSteps,
    })
    startRunProgressAnimation(mission.id)
    try {
      const data = await triggerMissionScheduleStream(mission.id, (event) => {
        if (event.type === "step" && event.trace) {
          applyStreamingStepTrace(mission.id, event.trace)
        }
      })
      const finalizedSteps = normalizeRunStepTraces(data?.stepTraces, pendingSteps)
      stopRunProgressAnimation()
      setRunProgress({
        missionId: mission.id,
        missionLabel: mission.label || "Untitled mission",
        running: false,
        success: Boolean(data?.ok),
        reason: data?.reason,
        steps: finalizedSteps,
        outputResults: Array.isArray(data?.results) ? data.results : [],
        novachatQueued: Boolean(data?.novachatQueued),
      })
      if (Array.isArray(data?.results) && data.results.length > 0) {
        console.debug("[missions] output results", data.results)
      }
      if (data?.schedule) {
        updateLocalSchedule(mission.id, data.schedule)
        setBaselineById((prev) => ({ ...prev, [mission.id]: data.schedule as NotificationSchedule }))
      } else {
        setSchedules((prev) =>
          prev.map((item) =>
            item.id === mission.id
              ? {
                  ...item,
                  runCount: (Number.isFinite(item.runCount) ? Number(item.runCount) : 0) + 1,
                  successCount:
                    (Number.isFinite(item.successCount) ? Number(item.successCount) : 0) + (data?.ok ? 1 : 0),
                  failureCount:
                    (Number.isFinite(item.failureCount) ? Number(item.failureCount) : 0) + (data?.ok ? 0 : 1),
                  lastRunAt: new Date().toISOString(),
                }
              : item,
          ),
        )
      }
      const finishedAt = Date.now()
      setMissionRuntimeStatusById((prev) => ({
        ...prev,
        [mission.id]: data?.ok ? { kind: "completed", at: finishedAt } : { kind: "failed", at: finishedAt },
      }))
      if (!data?.ok) throw new Error(data?.error || "Run now failed.")
      await refreshSchedules()
      setStatus({
        type: "success",
        message: data?.novachatQueued
          ? "Mission run completed. NovaChat message queued - use Open NovaChat in the run trace."
          : "Mission run completed. Review step trace panel for details.",
      })
    } catch (error) {
      stopRunProgressAnimation()
      const failedAt = Date.now()
      setMissionRuntimeStatusById((prev) => ({
        ...prev,
        [mission.id]: { kind: "failed", at: failedAt },
      }))
      setRunProgress((prev) => prev ? {
        ...prev,
        running: false,
        success: false,
        reason: error instanceof Error ? error.message : "Run now failed.",
      } : prev)
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to run mission now." })
    }
  }, [applyStreamingStepTrace, normalizeRunStepTraces, refreshSchedules, startRunProgressAnimation, stopRunProgressAnimation, toPendingRunSteps, updateLocalSchedule])

  useEffect(() => {
    return () => {
      stopRunProgressAnimation()
    }
  }, [stopRunProgressAnimation])

  useAutoDismissRunProgress(runProgress, setRunProgress)

  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(() => [orbPalette.circle1, orbPalette.circle2], [orbPalette.circle1, orbPalette.circle2])
  const orbHoverFilter = useMemo(
    () => `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`,
    [orbPalette.circle1, orbPalette.circle2],
  )
  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const moduleHeightClass = "h-[clamp(680px,88vh,1280px)]"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const filteredSchedules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    let next = schedules.filter((mission) => {
      if (statusFilter === "enabled" && !mission.enabled) return false
      if (statusFilter === "disabled" && mission.enabled) return false
      if (!query) return true
      const blob = `${mission.label} ${mission.message} ${mission.integration} ${mission.time}`.toLowerCase()
      return blob.includes(query)
    })

    next = [...next].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return next
  }, [schedules, searchQuery, statusFilter])
  const missionStats = useMemo(() => {
    const enabled = schedules.filter((s) => s.enabled).length
    const disabled = schedules.length - enabled
    const integrations = new Set(schedules.map((s) => s.integration)).size
    const totalRuns = schedules.reduce((sum, s) => sum + (Number.isFinite(s.runCount) ? Number(s.runCount) : 0), 0)
    const successfulRuns = schedules.reduce((sum, s) => sum + (Number.isFinite(s.successCount) ? Number(s.successCount) : 0), 0)
    const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 100
    return { total: schedules.length, enabled, disabled, integrations, totalRuns, successRate }
  }, [schedules])

  return {
    orbColor,
    setOrbColor,
    background,
    setBackground,
    backgroundVideoUrl,
    setBackgroundVideoUrl,
    backgroundMediaIsImage,
    setBackgroundMediaIsImage,
    spotlightEnabled,
    setSpotlightEnabled,
    settingsOpen,
    setSettingsOpen,
    builderOpen,
    setBuilderOpen,
    mounted,
    setMounted,
    schedules,
    setSchedules,
    baselineById,
    setBaselineById,
    loading,
    setLoading,
    status,
    setStatus,
    busyById,
    setBusyById,
    deployingMission,
    setDeployingMission,
    pendingDeleteMission,
    setPendingDeleteMission,
    missionActionMenu,
    setMissionActionMenu,
    newLabel,
    setNewLabel,
    newDescription,
    setNewDescription,
    newTime,
    setNewTime,
    detectedTimezone,
    setDetectedTimezone,
    newPriority,
    setNewPriority,
    newScheduleMode,
    setNewScheduleMode,
    newScheduleDays,
    setNewScheduleDays,
    integrationsSettings,
    setIntegrationsSettings,
    editingMissionId,
    setEditingMissionId,
    missionActive,
    setMissionActive,
    tagInput,
    setTagInput,
    missionTags,
    setMissionTags,
    workflowSteps,
    setWorkflowSteps,
    collapsedStepIds,
    setCollapsedStepIds,
    integrationCatalog,
    setIntegrationCatalog,
    draggingStepId,
    setDraggingStepId,
    dragOverStepId,
    setDragOverStepId,
    novaSuggestingByStepId,
    setNovaSuggestingByStepId,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    missionBoardView,
    setMissionBoardView,
    novaMissionPrompt,
    setNovaMissionPrompt,
    novaGeneratingMission,
    setNovaGeneratingMission,
    runImmediatelyOnCreate,
    setRunImmediatelyOnCreate,
    runProgress,
    setRunProgress,
    missionRuntimeStatusById,
    setMissionRuntimeStatusById,
    catalogApiById,
    apiFetchIntegrationOptions,
    outputChannelOptions,
    formatStatusTime,
    listSectionRef,
    createSectionRef,
    heroHeaderRef,
    builderBodyRef,
    builderFooterRef,
    headerActionsRef,
    missionActionMenuRef,
    configuredAiIntegrationOptions,
    resolveDefaultAiIntegration,
    createWorkflowStep,
    setItemBusy,
    resetMissionBuilder,
    applyTemplate,
    toggleScheduleDay,
    addWorkflowStep,
    toggleWorkflowStepCollapsed,
    updateWorkflowStepTitle,
    updateWorkflowStep,
    updateWorkflowStepAi,
    removeWorkflowStep,
    toPendingRunSteps,
    normalizeRunStepTraces,
    mapWorkflowStepsForBuilder,
    generateMissionDraftFromPrompt,
    novaSuggestForAiStep,
    moveWorkflowStepByDrop,
    addTag,
    removeTag,
    playClickSound,
    refreshSchedules,
    updateLocalSchedule,
    deployMissionFromBuilder,
    saveMission,
    deleteMission,
    confirmDeleteMission,
    editMissionFromActions,
    duplicateMission,
    runMissionNow,
    orbPalette,
    floatingLinesGradient,
    orbHoverFilter,
    panelClass,
    moduleHeightClass,
    subPanelClass,
    panelStyle,
    filteredSchedules,
    missionStats,
  }
}
