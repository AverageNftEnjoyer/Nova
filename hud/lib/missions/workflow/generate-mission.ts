/**
 * Mission Generation — V.26
 *
 * Wraps the existing workflow generation engine and converts the output
 * to the new Mission format (nodes[] + connections[]).
 */

import "server-only"

import type { IntegrationsStoreScope } from "@/lib/integrations/server-store"
import type { Mission, MissionCategory, Provider } from "../types"
import { migrateLegacyScheduleToMission } from "../store"
import { buildWorkflowFromPrompt } from "./generation"
import { WORKFLOW_MARKER } from "./parsing"
import type { NotificationSchedule } from "@/lib/notifications/store"

export interface BuildMissionResult {
  mission: Mission
  provider: Provider
  model: string
}

/**
 * Build a Mission from a natural language prompt.
 * Delegates to the existing workflow generation engine, then converts
 * the result to the new Mission node-graph format.
 */
export async function buildMissionFromPrompt(
  prompt: string,
  options?: {
    userId?: string
    scope?: IntegrationsStoreScope
    chatIds?: string[]
    integration?: string
  },
): Promise<BuildMissionResult> {
  const { workflow, provider, model } = await buildWorkflowFromPrompt(prompt, options?.scope)

  // Build a synthetic NotificationSchedule from the workflow result
  // so we can use the existing migration logic
  const now = new Date().toISOString()
  const summary = workflow.summary
  const steps = workflow.summary?.workflowSteps || []
  const description = summary?.description || prompt

  // Build the message in the old format (description + WORKFLOW_MARKER + JSON)
  const workflowJson = JSON.stringify({ ...summary, workflowSteps: steps }, null, 2)
  const message = `${description}\n\n${WORKFLOW_MARKER}\n${workflowJson}`

  const legacySchedule: NotificationSchedule = {
    id: crypto.randomUUID(),
    userId: options?.userId || "",
    integration: workflow.integration || options?.integration || "telegram",
    label: workflow.label || "New Mission",
    message,
    time: summary?.schedule?.time || "09:00",
    timezone: summary?.schedule?.timezone || "America/New_York",
    enabled: true,
    chatIds: options?.chatIds || [],
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
  }

  const mission = migrateLegacyScheduleToMission(legacySchedule)

  // Ensure status is "draft" for newly generated missions
  const result: Mission = {
    ...mission,
    status: "draft",
    description,
  }

  return { mission: result, provider, model }
}

/**
 * Guess category from mission label and steps.
 * Re-exported for UI use.
 */
export function guessMissionCategory(label: string, tags: string[] = []): MissionCategory {
  const text = `${label} ${tags.join(" ")}`.toLowerCase()
  if (/crypto|bitcoin|eth|coinbase|portfolio|pnl/.test(text)) return "finance"
  if (/market|stock|trading|earnings|forex/.test(text)) return "finance"
  if (/deploy|uptime|error|monitor|devops|ci|cd/.test(text)) return "devops"
  if (/seo|lead|ad|campaign|marketing/.test(text)) return "marketing"
  if (/research|brief|news|digest|summary|headline/.test(text)) return "research"
  if (/ecommerce|order|product|shop|inventory/.test(text)) return "ecommerce"
  if (/hr|employee|onboard|leave|payroll/.test(text)) return "hr"
  if (/security|threat|cve|vuln|breach/.test(text)) return "security"
  if (/content|blog|post|social|tweet/.test(text)) return "content"
  if (/weather|remind|habit|travel|personal/.test(text)) return "personal"
  return "research"
}
