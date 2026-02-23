"use client"

import type { Mission, MissionNode } from "@/lib/missions/types"
import type { GeneratedMissionSummary, WorkflowStep } from "../types"

function cloneMission(mission: Mission): Mission {
  return JSON.parse(JSON.stringify(mission)) as Mission
}

function toWorkflowTransformFormat(value: unknown): WorkflowStep["transformFormat"] {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "text" || normalized === "json" || normalized === "markdown" || normalized === "table") return normalized
  if (normalized === "html") return "markdown"
  return undefined
}

function toWorkflowStep(node: MissionNode): Partial<WorkflowStep> | null {
  const base = { id: node.id, title: node.label }
  if (node.type === "schedule-trigger") {
    return {
      ...base,
      type: "trigger",
      triggerMode: node.triggerMode,
      triggerTime: node.triggerTime,
      triggerTimezone: node.triggerTimezone,
      triggerDays: node.triggerDays,
      triggerIntervalMinutes: Number.isFinite(Number(node.triggerIntervalMinutes))
        ? String(node.triggerIntervalMinutes)
        : undefined,
    }
  }
  if (node.type === "web-search") {
    return {
      ...base,
      type: "fetch",
      fetchSource: "web",
      fetchMethod: "GET",
      fetchQuery: String(node.query || ""),
      fetchIncludeSources: node.includeSources === true,
    }
  }
  if (node.type === "http-request") {
    return {
      ...base,
      type: "fetch",
      fetchSource: "api",
      fetchMethod: node.method === "POST" ? "POST" : "GET",
      fetchUrl: String(node.url || ""),
      fetchSelector: node.selector,
    }
  }
  if (node.type === "rss-feed") {
    return {
      ...base,
      type: "fetch",
      fetchSource: "rss",
      fetchMethod: "GET",
      fetchUrl: String(node.url || ""),
    }
  }
  if (node.type === "coinbase") {
    return {
      ...base,
      type: "coinbase",
      coinbaseIntent: node.intent,
      coinbaseParams: {
        assets: Array.isArray(node.assets) ? node.assets : undefined,
        quoteCurrency: node.quoteCurrency,
        thresholdPct: node.thresholdPct,
        cadence: node.cadence,
        transactionLimit: node.transactionLimit,
        includePreviousArtifactContext: node.includePreviousArtifactContext,
      },
      coinbaseFormat: node.format
        ? {
          style: node.format.style,
          includeRawMetadata: node.format.includeRawMetadata,
        }
        : undefined,
    }
  }
  if (node.type === "ai-summarize" || node.type === "ai-generate") {
    return {
      ...base,
      type: "ai",
      aiPrompt: String(node.prompt || ""),
      aiIntegration: node.integration,
      aiModel: node.model,
      aiDetailLevel: "detailLevel" in node ? node.detailLevel : undefined,
    }
  }
  if (node.type === "format" || node.type === "code" || node.type === "dedupe") {
    return {
      ...base,
      type: "transform",
      transformAction: node.type === "dedupe" ? "dedupe" : node.type === "code" ? "normalize" : "format",
      transformInstruction: node.type === "format" ? node.template : node.type === "code" ? node.code : undefined,
      transformFormat: node.type === "format" ? toWorkflowTransformFormat(node.outputFormat) : undefined,
    }
  }
  if (node.type === "condition") {
    const rule = Array.isArray(node.rules) ? node.rules[0] : undefined
    return {
      ...base,
      type: "condition",
      conditionField: rule?.field,
      conditionOperator: rule?.operator as WorkflowStep["conditionOperator"],
      conditionValue: rule?.value,
      conditionLogic: node.logic,
    }
  }
  if (node.type === "novachat-output" || node.type === "telegram-output" || node.type === "discord-output" || node.type === "email-output" || node.type === "webhook-output" || node.type === "slack-output") {
    const outputChannel: WorkflowStep["outputChannel"] =
      node.type === "telegram-output"
        ? "telegram"
        : node.type === "discord-output"
          ? "discord"
          : node.type === "email-output"
            ? "email"
            : node.type === "webhook-output"
              ? "webhook"
              : "novachat"
    return {
      ...base,
      type: "output",
      outputChannel,
      outputTemplate: "messageTemplate" in node ? node.messageTemplate : undefined,
    }
  }
  return null
}

function applyStepToNode(node: MissionNode, step: Partial<WorkflowStep>): MissionNode {
  const nextNode = { ...node }
  if (typeof step.title === "string" && step.title.trim()) {
    nextNode.label = step.title.trim()
  }
  if (step.type === "ai" && (nextNode.type === "ai-summarize" || nextNode.type === "ai-generate")) {
    if (typeof step.aiPrompt === "string" && step.aiPrompt.trim()) nextNode.prompt = step.aiPrompt
    if (step.aiIntegration) nextNode.integration = step.aiIntegration
    if (typeof step.aiModel === "string") nextNode.model = step.aiModel
    if ("detailLevel" in nextNode && step.aiDetailLevel) {
      ;(nextNode as MissionNode & { detailLevel?: "concise" | "standard" | "detailed" }).detailLevel = step.aiDetailLevel
    }
    return nextNode
  }
  if (step.type === "fetch") {
    if (nextNode.type === "web-search") {
      if (typeof step.fetchQuery === "string") nextNode.query = step.fetchQuery
      return nextNode
    }
    if (nextNode.type === "http-request") {
      if (typeof step.fetchUrl === "string") nextNode.url = step.fetchUrl
      if (step.fetchMethod === "POST" || step.fetchMethod === "GET") nextNode.method = step.fetchMethod
      return nextNode
    }
    if (nextNode.type === "rss-feed") {
      if (typeof step.fetchUrl === "string") nextNode.url = step.fetchUrl
      return nextNode
    }
  }
  if (step.type === "condition" && nextNode.type === "condition") {
    const currentRule = Array.isArray(nextNode.rules) && nextNode.rules[0] ? nextNode.rules[0] : { field: "", operator: "exists" as const }
    nextNode.rules = [{
      ...currentRule,
      field: typeof step.conditionField === "string" ? step.conditionField : currentRule.field,
      operator: (step.conditionOperator || currentRule.operator) as typeof currentRule.operator,
      value: typeof step.conditionValue === "string" ? step.conditionValue : currentRule.value,
    }]
    if (step.conditionLogic === "all" || step.conditionLogic === "any") nextNode.logic = step.conditionLogic
    return nextNode
  }
  if (step.type === "trigger" && nextNode.type === "schedule-trigger") {
    if (step.triggerMode === "once" || step.triggerMode === "daily" || step.triggerMode === "weekly" || step.triggerMode === "interval") {
      nextNode.triggerMode = step.triggerMode
    }
    if (typeof step.triggerTime === "string") nextNode.triggerTime = step.triggerTime
    if (typeof step.triggerTimezone === "string") nextNode.triggerTimezone = step.triggerTimezone
    if (Array.isArray(step.triggerDays)) nextNode.triggerDays = step.triggerDays
    if (typeof step.triggerIntervalMinutes === "string" && /^\d+$/.test(step.triggerIntervalMinutes)) {
      nextNode.triggerIntervalMinutes = Number.parseInt(step.triggerIntervalMinutes, 10)
    }
    return nextNode
  }
  return nextNode
}

export function missionToWorkflowSummaryForAutofix(mission: Mission): GeneratedMissionSummary {
  const workflowSteps = mission.nodes
    .map((node) => toWorkflowStep(node))
    .filter((row): row is Partial<WorkflowStep> => Boolean(row))
  return {
    description: mission.description || "",
    workflowSteps,
  }
}

export function applyAutofixSummaryToMission(mission: Mission, summary: GeneratedMissionSummary): Mission {
  const nextMission = cloneMission(mission)
  const steps = Array.isArray(summary.workflowSteps) ? summary.workflowSteps : []
  const stepsById = new Map(steps.map((step) => [String(step.id || ""), step]))
  nextMission.nodes = nextMission.nodes.map((node) => {
    const step = stepsById.get(node.id)
    if (!step) return node
    return applyStepToNode(node, step)
  })
  if (typeof summary.description === "string" && summary.description.trim()) {
    nextMission.description = summary.description.trim()
  }
  nextMission.updatedAt = new Date().toISOString()
  return nextMission
}
