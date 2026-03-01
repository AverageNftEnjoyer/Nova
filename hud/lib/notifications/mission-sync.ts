import "server-only"

import { buildMission, deleteMission, loadMissions, upsertMission } from "@/lib/missions/store"
import type { Mission, MissionConnection, MissionNode, ScheduleTriggerNode } from "@/lib/missions/types"
import { parseMissionWorkflow } from "@/lib/missions/workflow/parsing"
import type { NotificationSchedule } from "@/lib/notifications/store"
import { resolveTimezone } from "@/lib/shared/timezone"

const DEFAULT_TIME = "09:00"
const DEFAULT_TRIGGER_ID = "n-trigger"
const DEFAULT_OUTPUT_ID = "n-output"
const VALID_WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])
const OUTPUT_NODE_TYPES = new Set(["telegram-output", "discord-output", "email-output", "webhook-output", "slack-output"])

function normalizeScheduleMode(value: unknown): ScheduleTriggerNode["triggerMode"] {
  const mode = String(value || "daily").trim().toLowerCase()
  if (mode === "once" || mode === "daily" || mode === "weekly" || mode === "interval") return mode
  return "daily"
}

function normalizeScheduleDays(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const days = value
    .map((day) => String(day || "").trim().toLowerCase())
    .filter((day) => VALID_WEEKDAYS.has(day))
  if (days.length === 0) return undefined
  return Array.from(new Set(days))
}

function normalizeIntervalMinutes(value: unknown): number | undefined {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return undefined
  const floored = Math.floor(minutes)
  if (floored < 1) return undefined
  return Math.min(1440, floored)
}

function normalizeTime(value: string | undefined): string {
  const raw = String(value || "").trim()
  return /^\d{2}:\d{2}$/.test(raw) ? raw : DEFAULT_TIME
}

function normalizeTimezone(value: string | undefined): string {
  return resolveTimezone(value)
}

function buildOutputNode(params: {
  integration: string
  chatIds: string[]
  fallbackLabel: string
  existingOutput?: MissionNode
}): MissionNode {
  const { integration, chatIds, fallbackLabel, existingOutput } = params
  const outputId = String(existingOutput?.id || DEFAULT_OUTPUT_ID).trim() || DEFAULT_OUTPUT_ID
  const outputLabel = String(existingOutput?.label || fallbackLabel).trim() || fallbackLabel
  const outputPosition = existingOutput?.position || { x: 420, y: 200 }
  const channel = String(integration || "").trim().toLowerCase()

  if (channel === "discord") {
    return {
      ...(existingOutput && existingOutput.type === "discord-output" ? existingOutput : {}),
      id: outputId,
      type: "discord-output",
      label: outputLabel,
      position: outputPosition,
      webhookUrls: chatIds,
    } satisfies MissionNode
  }

  if (channel === "email") {
    return {
      ...(existingOutput && existingOutput.type === "email-output" ? existingOutput : {}),
      id: outputId,
      type: "email-output",
      label: outputLabel,
      position: outputPosition,
      recipients: chatIds,
      subject: fallbackLabel,
    } satisfies MissionNode
  }

  if (channel === "webhook") {
    const fallbackUrl =
      existingOutput && existingOutput.type === "webhook-output"
        ? String(existingOutput.url || "").trim()
        : ""
    return {
      ...(existingOutput && existingOutput.type === "webhook-output" ? existingOutput : {}),
      id: outputId,
      type: "webhook-output",
      label: outputLabel,
      position: outputPosition,
      url: String(chatIds[0] || fallbackUrl).trim(),
      method: "POST",
    } satisfies MissionNode
  }

  return {
    ...(existingOutput && existingOutput.type === "telegram-output" ? existingOutput : {}),
    id: outputId,
    type: "telegram-output",
    label: outputLabel,
    position: outputPosition,
    chatIds,
  } satisfies MissionNode
}

function ensureScheduleConnection(
  connections: MissionConnection[],
  triggerNodeId: string,
  outputNodeId: string,
): MissionConnection[] {
  const hasLink = connections.some((connection) =>
    connection.sourceNodeId === triggerNodeId && connection.targetNodeId === outputNodeId)
  if (hasLink) return connections
  return [
    ...connections,
    {
      id: `c-${triggerNodeId}-${outputNodeId}`,
      sourceNodeId: triggerNodeId,
      sourcePort: "main",
      targetNodeId: outputNodeId,
      targetPort: "main",
    },
  ]
}

function normalizeStringArray(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).sort()
}

function buildMissionSyncSnapshot(mission: Mission): Record<string, unknown> {
  const triggerNode = mission.nodes.find((node) => node.type === "schedule-trigger") as ScheduleTriggerNode | undefined
  const outputNode = mission.nodes.find((node) => OUTPUT_NODE_TYPES.has(node.type))
  return {
    label: String(mission.label || "").trim(),
    description: String(mission.description || "").trim(),
    status: String(mission.status || "").trim(),
    integration: String(mission.integration || "").trim().toLowerCase(),
    chatIds: normalizeStringArray(Array.isArray(mission.chatIds) ? mission.chatIds : []),
    timezone: String(mission.settings?.timezone || "").trim(),
    trigger: triggerNode
      ? {
          mode: String(triggerNode.triggerMode || "").trim().toLowerCase(),
          time: String(triggerNode.triggerTime || "").trim(),
          timezone: String(triggerNode.triggerTimezone || "").trim(),
          days: normalizeStringArray(Array.isArray(triggerNode.triggerDays) ? triggerNode.triggerDays : []),
          interval: Number.isFinite(Number(triggerNode.triggerIntervalMinutes)) ? Number(triggerNode.triggerIntervalMinutes) : null,
        }
      : null,
    output: outputNode
      ? {
          type: outputNode.type,
          chatIds: outputNode.type === "telegram-output"
            ? normalizeStringArray(Array.isArray(outputNode.chatIds) ? outputNode.chatIds : [])
            : undefined,
          webhookUrls: outputNode.type === "discord-output"
            ? normalizeStringArray(Array.isArray(outputNode.webhookUrls) ? outputNode.webhookUrls : [])
            : undefined,
          recipients: outputNode.type === "email-output"
            ? normalizeStringArray(Array.isArray(outputNode.recipients) ? outputNode.recipients : [])
            : undefined,
          url: outputNode.type === "webhook-output" ? String(outputNode.url || "").trim() : undefined,
        }
      : null,
  }
}

export async function syncMissionFromNotificationSchedule(schedule: NotificationSchedule): Promise<Mission> {
  const scheduleId = String(schedule.id || "").trim()
  const userId = String(schedule.userId || "").trim()
  if (!scheduleId || !userId) {
    throw new Error("Notification schedule sync requires schedule id and user id.")
  }

  const parsed = parseMissionWorkflow(schedule.message)
  const summary = parsed.summary
  const summarySchedule = summary?.schedule && typeof summary.schedule === "object"
    ? summary.schedule as Record<string, unknown>
    : null
  const workflowTrigger = Array.isArray(summary?.workflowSteps)
    ? summary.workflowSteps.find((step) => String((step as { type?: string }).type || "").trim().toLowerCase() === "trigger")
    : null
  const triggerMeta = workflowTrigger && typeof workflowTrigger === "object"
    ? workflowTrigger as Record<string, unknown>
    : null

  const mode = normalizeScheduleMode(triggerMeta?.triggerMode ?? summarySchedule?.mode)
  const triggerDays = normalizeScheduleDays(triggerMeta?.triggerDays ?? summarySchedule?.days)
  const triggerIntervalMinutes = normalizeIntervalMinutes(
    triggerMeta?.triggerIntervalMinutes ?? summarySchedule?.intervalMinutes,
  )
  const time = normalizeTime(schedule.time)
  const timezone = normalizeTimezone(schedule.timezone)
  const label = String(schedule.label || "Untitled mission").trim() || "Untitled mission"
  const description = String(parsed.description || schedule.message || label).trim() || label
  const integration = String(schedule.integration || "telegram").trim().toLowerCase() || "telegram"
  const chatIds = Array.isArray(schedule.chatIds)
    ? schedule.chatIds.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  const missions = await loadMissions({ userId })
  const existing = missions.find((mission) => mission.id === scheduleId) || null

  const baseMission = existing || {
    ...buildMission({
      userId,
      label,
      description,
      integration,
      chatIds,
      nodes: [],
      connections: [],
    }),
    id: scheduleId,
    createdAt: String(schedule.createdAt || "").trim() || new Date().toISOString(),
  }

  const triggerNodeIndex = baseMission.nodes.findIndex((node) => node.type === "schedule-trigger")
  const existingTrigger = triggerNodeIndex >= 0
    ? baseMission.nodes[triggerNodeIndex] as ScheduleTriggerNode
    : null
  const triggerNodeId = String(existingTrigger?.id || DEFAULT_TRIGGER_ID).trim() || DEFAULT_TRIGGER_ID
  const triggerNode: ScheduleTriggerNode = {
    ...(existingTrigger || {}),
    id: triggerNodeId,
    type: "schedule-trigger",
    label: String(existingTrigger?.label || "Schedule Trigger").trim() || "Schedule Trigger",
    position: existingTrigger?.position || { x: 120, y: 200 },
    triggerMode: mode,
    triggerTime: time,
    triggerTimezone: timezone,
    triggerDays: mode === "weekly" ? triggerDays : undefined,
    triggerIntervalMinutes: mode === "interval" ? triggerIntervalMinutes : undefined,
  }

  const outputNodeIndex = baseMission.nodes.findIndex((node) => OUTPUT_NODE_TYPES.has(node.type))
  const existingOutput = outputNodeIndex >= 0 ? baseMission.nodes[outputNodeIndex] : undefined
  const outputNode = buildOutputNode({
    integration,
    chatIds,
    fallbackLabel: `${label} Output`,
    existingOutput,
  })

  const nodes = [...baseMission.nodes]
  if (triggerNodeIndex >= 0) nodes[triggerNodeIndex] = triggerNode
  else nodes.unshift(triggerNode)

  if (outputNodeIndex >= 0) nodes[outputNodeIndex] = outputNode
  else nodes.push(outputNode)

  const baseConnections = Array.isArray(baseMission.connections) ? baseMission.connections : []
  const shouldEnsureConnection = baseConnections.length === 0 || (triggerNodeIndex < 0 && outputNodeIndex < 0)
  const nextConnections = shouldEnsureConnection
    ? ensureScheduleConnection(baseConnections, triggerNode.id, outputNode.id)
    : baseConnections

  const mission: Mission = {
    ...baseMission,
    id: scheduleId,
    userId,
    label,
    description,
    status: schedule.enabled ? "active" : "paused",
    integration,
    chatIds,
    nodes,
    connections: nextConnections,
    settings: {
      ...baseMission.settings,
      timezone,
    },
    updatedAt: new Date().toISOString(),
  }

  if (existing) {
    const existingSnapshot = JSON.stringify(buildMissionSyncSnapshot(existing))
    const nextSnapshot = JSON.stringify(buildMissionSyncSnapshot(mission))
    if (existingSnapshot === nextSnapshot) return existing
  }

  await upsertMission(mission, userId)
  return mission
}

export async function deleteMissionForNotificationSchedule(params: {
  scheduleId: string
  userId: string
}): Promise<void> {
  const scheduleId = String(params.scheduleId || "").trim()
  const userId = String(params.userId || "").trim()
  if (!scheduleId || !userId) return
  await deleteMission(scheduleId, userId).catch(() => {})
}
