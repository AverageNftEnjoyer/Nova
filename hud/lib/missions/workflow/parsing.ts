/**
 * Workflow Parsing
 *
 * Functions for parsing mission workflow definitions.
 */

import { parseJsonObject } from "../text/cleaning.ts"
import { normalizeWorkflowStep } from "../utils/config.ts"
import type { ParsedWorkflow, WorkflowSummary } from "../types/index"

export const WORKFLOW_MARKER = "[NOVA WORKFLOW]"

/**
 * Parse a mission workflow from a message string.
 */
export function parseMissionWorkflow(message: string): ParsedWorkflow {
  const raw = String(message || "")
  const idx = raw.indexOf(WORKFLOW_MARKER)
  const description = idx < 0 ? raw.trim() : raw.slice(0, idx).trim()
  if (idx < 0) return { description, summary: null }

  const maybe = parseJsonObject(raw.slice(idx + WORKFLOW_MARKER.length))
  if (!maybe) return { description, summary: null }

  const summary = maybe as unknown as WorkflowSummary
  const stepsRaw = Array.isArray(summary.workflowSteps) ? summary.workflowSteps : []
  summary.workflowSteps = stepsRaw.map((s, i) => normalizeWorkflowStep(s, i))
  return { description, summary }
}
