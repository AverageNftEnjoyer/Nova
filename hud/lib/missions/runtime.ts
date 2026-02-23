/**
 * Mission Runtime
 *
 * This file maintains backward compatibility by re-exporting all public APIs
 * from the modular structure. The actual implementations are in the subdirectories.
 *
 * Module Structure:
 * - types.ts: All type definitions
 * - utils/: Path, validation, and config utilities
 * - text/: Text cleaning and formatting
 * - web/: Web search, fetch, and quality detection
 * - output/: Source handling, formatters, and dispatch
 * - llm/: LLM providers and prompt building
 * - workflow/: Parsing, scheduling, generation, and execution
 */

import "server-only"

// ─────────────────────────────────────────────────────────────────────────────
// Type Exports
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Provider,
  WorkflowStepType,
  AiDetailLevel,
  WorkflowStep,
  WorkflowSummary,
  ParsedWorkflow,
  CompletionResult,
  CompletionOverride,
  WorkflowScheduleGate,
  WorkflowStepTrace,
  WebDocumentResult,
  WebSearchResult,
  WebSearchResponse,
  OutputResult,
} from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Exports (Main Public APIs)
// ─────────────────────────────────────────────────────────────────────────────

export { WORKFLOW_MARKER, parseMissionWorkflow } from "./workflow/parsing"
export { shouldWorkflowRunNow } from "./workflow/scheduling"
export { buildWorkflowFromPrompt } from "./workflow/generation"

// ─────────────────────────────────────────────────────────────────────────────
// LLM Exports
// ─────────────────────────────────────────────────────────────────────────────

export { completeWithConfiguredLlm } from "./llm/providers"

// ─────────────────────────────────────────────────────────────────────────────
// Output Exports
// ─────────────────────────────────────────────────────────────────────────────

export { humanizeMissionOutputText } from "./output/formatters"
export { dispatchOutput } from "./output/dispatch"

// ─────────────────────────────────────────────────────────────────────────────
// Text Exports
// ─────────────────────────────────────────────────────────────────────────────

export { generateShortTitle, formatNotificationText } from "./text/formatting"
export { cleanText, cleanScrapedText } from "./text/cleaning"

// ─────────────────────────────────────────────────────────────────────────────
// Web Exports
// ─────────────────────────────────────────────────────────────────────────────

export { isLowSignalNavigationPage, isUsableWebResult } from "./web/quality"
export { searchWebAndCollect } from "./web/search"

// ─────────────────────────────────────────────────────────────────────────────
// Utils Exports
// ─────────────────────────────────────────────────────────────────────────────

export { normalizeWorkflowStep, resolveAiDetailLevel, resolveIncludeSources } from "./utils/config"
export { hasUsableContextData } from "./utils/validation"
export { getByPath, interpolateTemplate } from "./utils/paths"
