import {
  CLAUDE_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
  GROK_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  type ModelOption,
} from "@/app/integrations/constants"
import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { AiIntegrationType, WorkflowStepType } from "./types"

export const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
export const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
export const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
export const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
export const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
export const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

export const MERIDIEM_OPTIONS: FluidSelectOption[] = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
]

export const MISSION_FILTER_STATUS_OPTIONS: FluidSelectOption[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Active" },
  { value: "disabled", label: "Paused" },
]

export const STEP_TYPE_OPTIONS: Array<{ type: WorkflowStepType; label: string }> = [
  { type: "trigger", label: "Trigger" },
  { type: "fetch", label: "Fetch Data" },
  { type: "coinbase", label: "Coinbase" },
  { type: "ai", label: "AI Process" },
  { type: "transform", label: "Transform" },
  { type: "condition", label: "Condition" },
  { type: "output", label: "Send/Output" },
]

export const STEP_FETCH_SOURCE_OPTIONS: FluidSelectOption[] = [
  { value: "web", label: "Brave Web Search" },
  { value: "coinbase", label: "Coinbase Market Data" },
]

export const STEP_FETCH_METHOD_OPTIONS: FluidSelectOption[] = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
]

export const STEP_TRANSFORM_ACTION_OPTIONS: FluidSelectOption[] = [
  { value: "normalize", label: "Normalize fields" },
  { value: "dedupe", label: "Deduplicate records" },
  { value: "aggregate", label: "Aggregate metrics" },
  { value: "format", label: "Format message" },
  { value: "enrich", label: "Enrich with context" },
]

export const STEP_TRANSFORM_FORMAT_OPTIONS: FluidSelectOption[] = [
  { value: "text", label: "Plain Text" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "table", label: "Table" },
]

export const STEP_CONDITION_OPERATOR_OPTIONS: FluidSelectOption[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does Not Equal" },
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
  { value: "regex", label: "Regex Match" },
  { value: "exists", label: "Field Exists" },
]

export const STEP_CONDITION_LOGIC_OPTIONS: FluidSelectOption[] = [
  { value: "all", label: "Match ALL rules" },
  { value: "any", label: "Match ANY rule" },
]

export const STEP_CONDITION_FAILURE_OPTIONS: FluidSelectOption[] = [
  { value: "skip", label: "Skip output" },
  { value: "notify", label: "Notify fallback channel" },
  { value: "stop", label: "Stop mission run" },
]

export const FALLBACK_OUTPUT_CHANNEL_OPTIONS: FluidSelectOption[] = [
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "push", label: "In-App Push" },
  { value: "webhook", label: "Webhook" },
]

export const STEP_OUTPUT_TIMING_OPTIONS: FluidSelectOption[] = [
  { value: "immediate", label: "Immediate" },
  { value: "scheduled", label: "Scheduled Time" },
  { value: "digest", label: "Digest Window" },
]

export const STEP_OUTPUT_FREQUENCY_OPTIONS: FluidSelectOption[] = [
  { value: "once", label: "One Notification" },
  { value: "multiple", label: "Multiple Notifications" },
]

export const PRIORITY_OPTIONS: FluidSelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
]

export const SCHEDULE_MODE_OPTIONS: FluidSelectOption[] = [
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

export const STEP_THEME: Record<WorkflowStepType, { light: string; dark: string; pillLight: string; pillDark: string }> = {
  trigger: {
    light: "border-amber-300 bg-amber-50",
    dark: "border-amber-400/30 bg-amber-500/10",
    pillLight: "bg-amber-100 text-amber-700",
    pillDark: "bg-amber-500/20 text-amber-300",
  },
  fetch: {
    light: "border-sky-300 bg-sky-50",
    dark: "border-sky-400/30 bg-sky-500/10",
    pillLight: "bg-sky-100 text-sky-700",
    pillDark: "bg-sky-500/20 text-sky-300",
  },
  coinbase: {
    light: "border-cyan-300 bg-cyan-50",
    dark: "border-cyan-400/30 bg-cyan-500/10",
    pillLight: "bg-cyan-100 text-cyan-700",
    pillDark: "bg-cyan-500/20 text-cyan-300",
  },
  ai: {
    light: "border-violet-300 bg-violet-50",
    dark: "border-violet-400/30 bg-violet-500/10",
    pillLight: "bg-violet-100 text-violet-700",
    pillDark: "bg-violet-500/20 text-violet-300",
  },
  transform: {
    light: "border-emerald-300 bg-emerald-50",
    dark: "border-emerald-400/30 bg-emerald-500/10",
    pillLight: "bg-emerald-100 text-emerald-700",
    pillDark: "bg-emerald-500/20 text-emerald-300",
  },
  condition: {
    light: "border-orange-300 bg-orange-50",
    dark: "border-orange-400/30 bg-orange-500/10",
    pillLight: "bg-orange-100 text-orange-700",
    pillDark: "bg-orange-500/20 text-orange-300",
  },
  output: {
    light: "border-pink-300 bg-pink-50",
    dark: "border-pink-400/30 bg-pink-500/10",
    pillLight: "bg-pink-100 text-pink-700",
    pillDark: "bg-pink-500/20 text-pink-300",
  },
}

export const STEP_TEXT_THEME: Record<WorkflowStepType, { light: string; dark: string }> = {
  trigger: { light: "text-amber-700", dark: "text-amber-300" },
  fetch: { light: "text-sky-700", dark: "text-sky-300" },
  coinbase: { light: "text-cyan-700", dark: "text-cyan-300" },
  ai: { light: "text-violet-700", dark: "text-violet-300" },
  transform: { light: "text-emerald-700", dark: "text-emerald-300" },
  condition: { light: "text-orange-700", dark: "text-orange-300" },
  output: { light: "text-pink-700", dark: "text-pink-300" },
}

export const AI_PROVIDER_LABELS: Record<AiIntegrationType, string> = {
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
}

// Same lists (and default-first order) as the Integrations pickers; a configured model that is not listed is
// still offered by getModelOptionsForProvider (helpers.tsx).
const toSelectOptions = (options: readonly ModelOption[]): FluidSelectOption[] =>
  options.map(({ value, label }) => ({ value, label }))

export const AI_MODEL_OPTIONS: Record<AiIntegrationType, FluidSelectOption[]> = {
  openai: toSelectOptions(OPENAI_MODEL_OPTIONS),
  claude: toSelectOptions(CLAUDE_MODEL_OPTIONS),
  grok: toSelectOptions(GROK_MODEL_OPTIONS),
  gemini: toSelectOptions(GEMINI_MODEL_OPTIONS),
}

export const AI_DETAIL_LEVEL_OPTIONS: FluidSelectOption[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]
