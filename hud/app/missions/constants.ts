import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  type ModelOption,
} from "@/app/integrations/constants"
import type { SelectOption } from "@/components/ui"
import type { AiIntegrationType, WorkflowStepType } from "./types"

export const MERIDIEM_OPTIONS: SelectOption[] = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
]

export const MISSION_FILTER_STATUS_OPTIONS: SelectOption[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Active" },
  { value: "disabled", label: "Paused" },
]

export const STEP_TYPE_OPTIONS: Array<{ type: WorkflowStepType; label: string }> = [
  { type: "trigger", label: "Trigger" },
  { type: "fetch", label: "Fetch data" },
  { type: "coinbase", label: "Coinbase" },
  { type: "ai", label: "AI process" },
  { type: "transform", label: "Transform" },
  { type: "condition", label: "Condition" },
  { type: "output", label: "Send output" },
]

export const STEP_FETCH_SOURCE_OPTIONS: SelectOption[] = [
  { value: "web", label: "Brave web search" },
  { value: "coinbase", label: "Coinbase market data" },
]

export const STEP_FETCH_METHOD_OPTIONS: SelectOption[] = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
]

export const STEP_TRANSFORM_ACTION_OPTIONS: SelectOption[] = [
  { value: "normalize", label: "Normalize fields" },
  { value: "dedupe", label: "Deduplicate records" },
  { value: "aggregate", label: "Aggregate metrics" },
  { value: "format", label: "Format message" },
  { value: "enrich", label: "Enrich with context" },
]

export const STEP_TRANSFORM_FORMAT_OPTIONS: SelectOption[] = [
  { value: "text", label: "Plain text" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "table", label: "Table" },
]

export const STEP_CONDITION_OPERATOR_OPTIONS: SelectOption[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "regex", label: "Regex match" },
  { value: "exists", label: "Field exists" },
]

export const STEP_CONDITION_LOGIC_OPTIONS: SelectOption[] = [
  { value: "all", label: "Match all rules" },
  { value: "any", label: "Match any rule" },
]

export const STEP_CONDITION_FAILURE_OPTIONS: SelectOption[] = [
  { value: "skip", label: "Skip output" },
  { value: "notify", label: "Notify fallback channel" },
  { value: "stop", label: "Stop mission run" },
]

export const FALLBACK_OUTPUT_CHANNEL_OPTIONS: SelectOption[] = [
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "push", label: "In-app push" },
  { value: "webhook", label: "Webhook" },
]

export const STEP_OUTPUT_TIMING_OPTIONS: SelectOption[] = [
  { value: "immediate", label: "Immediate" },
  { value: "scheduled", label: "Scheduled time" },
  { value: "digest", label: "Digest window" },
]

export const STEP_OUTPUT_FREQUENCY_OPTIONS: SelectOption[] = [
  { value: "once", label: "One notification" },
  { value: "multiple", label: "Multiple notifications" },
]

export const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
]

export const SCHEDULE_MODE_OPTIONS: SelectOption[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once" },
]

export const WEEKDAY_OPTIONS = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
] as const

/** Step type colour, used only as a thin edge or icon tint (chart tokens, restrained). */
export const STEP_TONE: Record<WorkflowStepType, string> = {
  trigger: "var(--chart-3)",
  fetch: "var(--chart-1)",
  coinbase: "var(--chart-1)",
  ai: "var(--chart-4)",
  transform: "var(--chart-2)",
  condition: "var(--chart-5)",
  output: "var(--fg-muted)",
}

export const AI_PROVIDER_LABELS: Record<AiIntegrationType, string> = {
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
}

// Same lists (and default-first order) as the Integrations pickers; a configured model that is not listed is
// still offered by getModelOptionsForProvider (helpers.tsx).
const toSelectOptions = (options: readonly ModelOption[]): SelectOption[] =>
  options.map(({ value, label }) => ({ value, label }))

export const AI_MODEL_OPTIONS: Record<AiIntegrationType, SelectOption[]> = {
  openai: toSelectOptions(OPENAI_MODEL_OPTIONS),
  claude: toSelectOptions(CLAUDE_MODEL_OPTIONS),
  grok: toSelectOptions(GROK_MODEL_OPTIONS),
  gemini: toSelectOptions(GEMINI_MODEL_OPTIONS),
}

export const AI_DETAIL_LEVEL_OPTIONS: SelectOption[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]
