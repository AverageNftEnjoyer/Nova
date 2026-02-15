"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Pin, Settings, Search, Sparkles, SlidersHorizontal, X, Clock3, Zap, Database, WandSparkles, GitBranch, Send, GripVertical, LayoutGrid, List, MoreVertical, Mail, MessageCircle, Activity, Pencil, Copy, Play, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type ThemeBackgroundType } from "@/lib/userSettings"
import { FluidSelect, type FluidSelectOption } from "@/components/ui/fluid-select"
import { SettingsModal } from "@/components/settings-modal"
import FloatingLines from "@/components/FloatingLines"
import { NovaOrbIndicator } from "@/components/nova-orb-indicator"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import { getCachedBackgroundVideoObjectUrl, loadBackgroundVideoObjectUrl } from "@/lib/backgroundVideoStorage"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings, type IntegrationsSettings } from "@/lib/integrations"
import { normalizeIntegrationCatalog, type IntegrationCatalogItem } from "@/lib/integrations/catalog"
import "@/components/FloatingLines.css"

interface NotificationSchedule {
  id: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  updatedAt: string
  runCount?: number
  successCount?: number
  failureCount?: number
  lastRunAt?: string
}

interface MissionRunStepTrace {
  stepId: string
  type: string
  title: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  detail?: string
}

interface MissionRunProgress {
  missionId?: string
  missionLabel: string
  running: boolean
  success: boolean
  reason?: string
  steps: MissionRunStepTrace[]
}

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }

const MERIDIEM_OPTIONS: FluidSelectOption[] = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
]
const MISSION_FILTER_STATUS_OPTIONS: FluidSelectOption[] = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Active" },
  { value: "disabled", label: "Paused" },
]
const QUICK_TEMPLATE_OPTIONS: Array<{
  id: string
  label: string
  description: string
  integration: string
  priority: string
  title: string
  message: string
  time: string
  tags: string[]
  steps: Array<{ type: WorkflowStepType; title: string }>
}> = [
  {
    id: "daily-briefing",
    label: "Morning Calendar Brief",
    description: "Pull calendar events, build a concise briefing, deliver via Telegram.",
    integration: "telegram",
    priority: "medium",
    title: "Morning Calendar Brief",
    message: "Pull today's calendar events, summarize key meetings and prep notes, then send to Telegram.",
    time: "08:00",
    tags: ["calendar", "briefing", "daily"],
    steps: [
      { type: "trigger", title: "Schedule trigger at 08:00" },
      { type: "fetch", title: "Fetch calendar events" },
      { type: "ai", title: "Generate daily briefing" },
      { type: "output", title: "Send to Telegram" },
    ],
  },
  {
    id: "ops-incident",
    label: "Ops Incident Pulse",
    description: "Watch incident feed and post actionable status updates to team channels.",
    integration: "discord",
    priority: "high",
    title: "Ops Incident Pulse",
    message: "Check incident stream, classify severity, and post response updates to Discord.",
    time: "09:30",
    tags: ["ops", "incident", "status"],
    steps: [
      { type: "trigger", title: "Trigger every 30 minutes" },
      { type: "fetch", title: "Fetch open incidents" },
      { type: "condition", title: "Filter critical incidents" },
      { type: "output", title: "Post Discord status update" },
    ],
  },
  {
    id: "pipeline-health",
    label: "Pipeline Health Report",
    description: "Gather deploy/build data and send AI-summarized health report.",
    integration: "email",
    priority: "medium",
    title: "Pipeline Health Report",
    message: "Collect CI/CD pipeline status and send a plain-English health report.",
    time: "18:15",
    tags: ["devops", "ci", "reporting"],
    steps: [
      { type: "trigger", title: "Daily trigger" },
      { type: "fetch", title: "Fetch CI/CD status" },
      { type: "ai", title: "Summarize delivery risks" },
      { type: "output", title: "Send email report" },
    ],
  },
]
type WorkflowStepType = "trigger" | "fetch" | "ai" | "transform" | "condition" | "output"
type AiIntegrationType = "openai" | "claude" | "grok" | "gemini"

interface WorkflowStep {
  id: string
  type: WorkflowStepType
  title: string
  aiPrompt?: string
  aiModel?: string
  aiIntegration?: AiIntegrationType
  triggerMode?: "once" | "daily" | "weekly" | "interval"
  triggerTime?: string
  triggerTimezone?: string
  triggerDays?: string[]
  triggerIntervalMinutes?: string
  fetchSource?: "api" | "web" | "calendar" | "crypto" | "rss" | "database"
  fetchMethod?: "GET" | "POST"
  fetchApiIntegrationId?: string
  fetchUrl?: string
  fetchQuery?: string
  fetchHeaders?: string
  fetchSelector?: string
  fetchRefreshMinutes?: string
  transformAction?: "normalize" | "dedupe" | "aggregate" | "format" | "enrich"
  transformFormat?: "text" | "json" | "markdown" | "table"
  transformInstruction?: string
  conditionField?: string
  conditionOperator?: "contains" | "equals" | "not_equals" | "greater_than" | "less_than" | "regex" | "exists"
  conditionValue?: string
  conditionLogic?: "all" | "any"
  conditionFailureAction?: "skip" | "notify" | "stop"
  outputChannel?: "telegram" | "discord" | "email" | "push" | "webhook"
  outputTiming?: "immediate" | "scheduled" | "digest"
  outputTime?: string
  outputFrequency?: "once" | "multiple"
  outputRepeatCount?: string
  outputRecipients?: string
  outputTemplate?: string
}

interface GeneratedMissionSummary {
  description?: string
  priority?: string
  schedule?: {
    mode?: string
    days?: string[]
    time?: string
    timezone?: string
  }
  missionActive?: boolean
  tags?: string[]
  workflowSteps?: Array<Partial<WorkflowStep>>
}

const STEP_TYPE_OPTIONS: Array<{ type: WorkflowStepType; label: string }> = [
  { type: "trigger", label: "Trigger" },
  { type: "fetch", label: "Fetch Data" },
  { type: "ai", label: "AI Process" },
  { type: "transform", label: "Transform" },
  { type: "condition", label: "Condition" },
  { type: "output", label: "Send/Output" },
]

const STEP_FETCH_SOURCE_OPTIONS: FluidSelectOption[] = [
  { value: "api", label: "API Endpoint" },
  { value: "web", label: "Web Scrape" },
  { value: "calendar", label: "Calendar Feed" },
  { value: "crypto", label: "Crypto Market Feed" },
  { value: "rss", label: "RSS Feed" },
  { value: "database", label: "Database Query" },
]

const STEP_FETCH_METHOD_OPTIONS: FluidSelectOption[] = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
]

const STEP_TRANSFORM_ACTION_OPTIONS: FluidSelectOption[] = [
  { value: "normalize", label: "Normalize fields" },
  { value: "dedupe", label: "Deduplicate records" },
  { value: "aggregate", label: "Aggregate metrics" },
  { value: "format", label: "Format message" },
  { value: "enrich", label: "Enrich with context" },
]

const STEP_TRANSFORM_FORMAT_OPTIONS: FluidSelectOption[] = [
  { value: "text", label: "Plain Text" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "table", label: "Table" },
]

const STEP_CONDITION_OPERATOR_OPTIONS: FluidSelectOption[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does Not Equal" },
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
  { value: "regex", label: "Regex Match" },
  { value: "exists", label: "Field Exists" },
]

const STEP_CONDITION_LOGIC_OPTIONS: FluidSelectOption[] = [
  { value: "all", label: "Match ALL rules" },
  { value: "any", label: "Match ANY rule" },
]

const STEP_CONDITION_FAILURE_OPTIONS: FluidSelectOption[] = [
  { value: "skip", label: "Skip output" },
  { value: "notify", label: "Notify fallback channel" },
  { value: "stop", label: "Stop mission run" },
]

const FALLBACK_OUTPUT_CHANNEL_OPTIONS: FluidSelectOption[] = [
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "email", label: "Email" },
  { value: "push", label: "In-App Push" },
  { value: "webhook", label: "Webhook" },
]

const STEP_OUTPUT_TIMING_OPTIONS: FluidSelectOption[] = [
  { value: "immediate", label: "Immediate" },
  { value: "scheduled", label: "Scheduled Time" },
  { value: "digest", label: "Digest Window" },
]

const STEP_OUTPUT_FREQUENCY_OPTIONS: FluidSelectOption[] = [
  { value: "once", label: "One Notification" },
  { value: "multiple", label: "Multiple Notifications" },
]

const PRIORITY_OPTIONS: FluidSelectOption[] = [
  { value: "low", label: "🟢 Low" },
  { value: "medium", label: "🟡 Medium" },
  { value: "high", label: "🟠 High" },
  { value: "critical", label: "🔴 Critical" },
]

const SCHEDULE_MODE_OPTIONS: FluidSelectOption[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once" },
]

const WEEKDAY_OPTIONS = [
  { id: "mon", label: "Mon" },
  { id: "tue", label: "Tue" },
  { id: "wed", label: "Wed" },
  { id: "thu", label: "Thu" },
  { id: "fri", label: "Fri" },
  { id: "sat", label: "Sat" },
  { id: "sun", label: "Sun" },
] as const

const STEP_THEME: Record<WorkflowStepType, { light: string; dark: string; pillLight: string; pillDark: string }> = {
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

const STEP_TEXT_THEME: Record<WorkflowStepType, { light: string; dark: string }> = {
  trigger: { light: "text-amber-700", dark: "text-amber-300" },
  fetch: { light: "text-sky-700", dark: "text-sky-300" },
  ai: { light: "text-violet-700", dark: "text-violet-300" },
  transform: { light: "text-emerald-700", dark: "text-emerald-300" },
  condition: { light: "text-orange-700", dark: "text-orange-300" },
  output: { light: "text-pink-700", dark: "text-pink-300" },
}

const AI_PROVIDER_LABELS: Record<AiIntegrationType, string> = {
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
}

const OPENAI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = [
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.2-pro", label: "GPT-5.2 Pro" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5-nano", label: "GPT-5 Nano" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
]

const CLAUDE_MODEL_SELECT_OPTIONS: FluidSelectOption[] = [
  { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
  { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
]

const GROK_MODEL_SELECT_OPTIONS: FluidSelectOption[] = [
  { value: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning" },
  { value: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-Reasoning" },
  { value: "grok-code-fast-1", label: "Grok Code Fast 1" },
  { value: "grok-4-fast-reasoning", label: "Grok 4 Fast Reasoning" },
  { value: "grok-4-fast-non-reasoning", label: "Grok 4 Fast Non-Reasoning" },
  { value: "grok-4-0709", label: "Grok 4 (0709)" },
  { value: "grok-3", label: "Grok 3" },
  { value: "grok-3-mini", label: "Grok 3 Mini" },
]

const GEMINI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
]

const AI_MODEL_OPTIONS: Record<AiIntegrationType, FluidSelectOption[]> = {
  openai: OPENAI_MODEL_SELECT_OPTIONS,
  claude: CLAUDE_MODEL_SELECT_OPTIONS,
  grok: GROK_MODEL_SELECT_OPTIONS,
  gemini: GEMINI_MODEL_SELECT_OPTIONS,
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatIntegrationLabel(integration: string): string {
  const value = integration.trim().toLowerCase()
  if (value === "telegram") return "Telegram"
  if (value === "discord") return "Discord"
  if (value === "slack") return "Slack"
  if (value === "email") return "Email"
  if (!value) return "Telegram"
  return integration.charAt(0).toUpperCase() + integration.slice(1)
}

function getDefaultModelForProvider(provider: AiIntegrationType, settings: IntegrationsSettings): string {
  return settings[provider].defaultModel.trim() || AI_MODEL_OPTIONS[provider][0]?.value || ""
}

function getModelOptionsForProvider(provider: AiIntegrationType, settings: IntegrationsSettings): FluidSelectOption[] {
  const base = AI_MODEL_OPTIONS[provider]
  const configuredDefault = getDefaultModelForProvider(provider, settings)
  if (!configuredDefault) return base
  if (base.some((option) => option.value === configuredDefault)) return base
  const label = configuredDefault
  return [{ value: configuredDefault, label }, ...base]
}

function renderStepIcon(type: WorkflowStepType, className: string) {
  if (type === "trigger") return <Zap className={className} />
  if (type === "fetch") return <Database className={className} />
  if (type === "ai") return <WandSparkles className={className} />
  if (type === "transform") return <GitBranch className={className} />
  if (type === "condition") return <SlidersHorizontal className={className} />
  return <Send className={className} />
}

function getMissionIntegrationIcon(integration: string, className: string) {
  if (integration === "telegram") return <Send className={className} />
  if (integration === "discord") return <MessageCircle className={className} />
  if (integration === "email") return <Mail className={className} />
  if (integration === "openai" || integration === "claude" || integration === "grok" || integration === "gemini") return <Sparkles className={className} />
  return <Activity className={className} />
}

function parseMissionWorkflowPayload(message: string): {
  description: string
  priority?: string
  process: string[]
  mode?: string
} {
  const marker = "[NOVA WORKFLOW]"
  const idx = message.indexOf(marker)
  if (idx < 0) return { description: message.trim(), process: ["trigger", "send"] }

  const description = message.slice(0, idx).trim()
  const jsonText = message.slice(idx + marker.length).trim()
  try {
    const parsed = JSON.parse(jsonText) as {
      priority?: string
      workflowSteps?: Array<{ type?: string }>
      schedule?: { mode?: string }
    }
    const process = Array.isArray(parsed.workflowSteps)
      ? parsed.workflowSteps.map((step) => String(step.type || "").trim()).filter(Boolean)
      : []
    return {
      description: description || message.trim(),
      priority: parsed.priority,
      process: process.length > 0 ? process : ["trigger", "send"],
      mode: parsed.schedule?.mode,
    }
  } catch {
    return { description: description || message.trim(), process: ["trigger", "send"] }
  }
}

function parseMissionWorkflowMeta(message: string): {
  description: string
  priority?: string
  mode?: string
  days?: string[]
  tags?: string[]
  apiCalls?: string[]
  workflowSteps?: Array<Partial<WorkflowStep>>
} {
  const marker = "[NOVA WORKFLOW]"
  const idx = message.indexOf(marker)
  const description = idx < 0 ? message.trim() : message.slice(0, idx).trim()
  if (idx < 0) return { description }

  const jsonText = message.slice(idx + marker.length).trim()
  try {
    const parsed = JSON.parse(jsonText) as {
      priority?: string
      schedule?: { mode?: string; days?: string[] }
      tags?: string[]
      apiCalls?: string[]
      workflowSteps?: Array<Partial<WorkflowStep>>
    }
    return {
      description: description || message.trim(),
      priority: parsed.priority,
      mode: parsed.schedule?.mode,
      days: Array.isArray(parsed.schedule?.days) ? parsed.schedule?.days.map((d) => String(d)) : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag)) : undefined,
      apiCalls: Array.isArray(parsed.apiCalls) ? parsed.apiCalls.map((call) => String(call)) : undefined,
      workflowSteps: Array.isArray(parsed.workflowSteps) ? parsed.workflowSteps : undefined,
    }
  } catch {
    return { description: description || message.trim() }
  }
}

function isWorkflowStepType(value: string): value is WorkflowStepType {
  return value === "trigger" || value === "fetch" || value === "ai" || value === "transform" || value === "condition" || value === "output"
}

function normalizePriority(value: string | undefined): "low" | "medium" | "high" | "critical" {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized
  return "medium"
}

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? legacyDark
}

function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

function to12HourParts(time24: string): { text: string; meridiem: "AM" | "PM" } {
  const match = /^(\d{2}):(\d{2})$/.exec(time24)
  if (!match) return { text: "09:00", meridiem: "AM" }

  const hour24 = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour24) || !Number.isInteger(minute)) return { text: "09:00", meridiem: "AM" }

  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { text: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, meridiem }
}

function to24Hour(text12: string, meridiem: "AM" | "PM"): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text12)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null

  hour = hour % 12
  if (meridiem === "PM") hour += 12
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function normalizeTypedTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4)
  if (digits.length <= 2) return digits
  if (digits.length === 3) return `${digits.slice(0, 1)}:${digits.slice(1)}`
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

function clampToValid12Hour(text: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match) return text
  let hour = Number(match[1])
  let minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return text
  if (hour < 1) hour = 1
  if (hour > 12) hour = 12
  if (minute < 0) minute = 0
  if (minute > 59) minute = 59
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function isCompleteTypedTime(text: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(text)
}

function isLiveCommitTypedTime(text: string): boolean {
  return /^\d{2}:\d{2}$/.test(text)
}

function isTemplateSecret(value: string): boolean {
  const text = String(value || "").trim()
  return /^\{\{\s*[^}]+\s*\}\}$/.test(text)
}

function usesSavedIntegrationDestination(channel: WorkflowStep["outputChannel"]): boolean {
  return channel === "telegram" || channel === "discord"
}

function sanitizeOutputRecipients(
  channel: WorkflowStep["outputChannel"],
  recipients: string | undefined,
): string {
  const value = String(recipients || "").trim()
  if (usesSavedIntegrationDestination(channel)) return ""
  if (isTemplateSecret(value)) return ""
  return value
}

interface TimeFieldProps {
  value24: string
  onChange24: (next: string) => void
  isLight: boolean
  className?: string
}

function TimeField({ value24, onChange24, isLight, className }: TimeFieldProps) {
  const parsed = to12HourParts(value24)
  const [text, setText] = useState(parsed.text)
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(parsed.meridiem)

  useEffect(() => {
    const next = to12HourParts(value24)
    setText(next.text) // eslint-disable-line react-hooks/set-state-in-effect
    setMeridiem(next.meridiem)
  }, [value24])

  const commit = useCallback(
    (nextText: string, nextMeridiem: "AM" | "PM") => {
      const full = clampToValid12Hour(nextText)
      const converted = to24Hour(full, nextMeridiem)
      if (converted) {
        setText(full)
        onChange24(converted)
      }
    },
    [onChange24],
  )

  return (
    <div className={cn("grid w-full grid-cols-[minmax(0,1fr)_72px] items-center gap-2", className)}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          const normalized = normalizeTypedTime(e.target.value)
          setText(normalized)
          if (isLiveCommitTypedTime(normalized)) {
            commit(normalized, meridiem)
          }
        }}
        onBlur={() => {
          if (isCompleteTypedTime(text)) {
            commit(text, meridiem)
          } else {
            const fallback = to12HourParts(value24)
            setText(fallback.text)
            setMeridiem(fallback.meridiem)
          }
        }}
        placeholder="12:45"
        inputMode="numeric"
        maxLength={5}
        className={cn(
          "h-9 min-w-0 w-full rounded-md border px-3 text-sm outline-none transition-colors",
          isLight
            ? "border-[#d5dce8] bg-[#f4f7fd] text-s-90 placeholder:text-s-40 hover:bg-[#eef3fb]"
            : "border-white/12 bg-white/6 text-slate-100 placeholder:text-slate-500 backdrop-blur-md hover:bg-white/10",
        )}
      />
      <FluidSelect
        value={meridiem}
        onChange={(next) => {
          const nextMeridiem = (next === "PM" ? "PM" : "AM") as "AM" | "PM"
          setMeridiem(nextMeridiem)
          if (isCompleteTypedTime(text)) {
            commit(text, nextMeridiem)
          }
        }}
        options={MERIDIEM_OPTIONS}
        isLight={isLight}
      />
    </div>
  )
}

export default function MissionsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
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
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [orbHovered, setOrbHovered] = useState(false)
  const [mounted, setMounted] = useState(false)

  const [schedules, setSchedules] = useState<NotificationSchedule[]>([])
  const [baselineById, setBaselineById] = useState<Record<string, NotificationSchedule>>({})
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<null | { type: "success" | "error"; message: string }>(null)
  const [busyById, setBusyById] = useState<Record<string, boolean>>({})
  const [deployingMission, setDeployingMission] = useState(false)
  const [pendingDeleteMission, setPendingDeleteMission] = useState<NotificationSchedule | null>(null)
  const [missionActionMenu, setMissionActionMenu] = useState<null | {
    mission: NotificationSchedule
    left: number
    top: number
  }>(null)

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

  const listSectionRef = useRef<HTMLElement | null>(null)
  const createSectionRef = useRef<HTMLElement | null>(null)
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
        fetchSource: "api",
        fetchMethod: "GET",
        fetchApiIntegrationId: "",
        fetchUrl: "",
        fetchQuery: "",
        fetchHeaders: "",
        fetchSelector: "",
        fetchRefreshMinutes: "15",
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
    setWorkflowSteps(
      template.steps.map((step) => createWorkflowStep(step.type, step.title)),
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
    (id: string, updates: Partial<Pick<WorkflowStep, "aiPrompt" | "aiModel" | "aiIntegration">>) => {
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
    if (!Array.isArray(steps) || steps.length === 0) {
      return [{ stepId: "output", type: "output", title: "Run mission output", status: "running" }]
    }
    return steps.map((step, index) => ({
      stepId: String(step.id || `step-${index + 1}`),
      type: String(step.type || "output"),
      title: String(step.title || STEP_TYPE_OPTIONS.find((option) => option.type === step.type)?.label || `Step ${index + 1}`),
      status: index === 0 ? "running" : "pending",
    }))
  }, [])

  const normalizeRunStepTraces = useCallback(
    (
      raw: unknown,
      fallbackSteps: MissionRunStepTrace[],
    ): MissionRunStepTrace[] => {
      if (!Array.isArray(raw)) return fallbackSteps
      const mapped = raw
        .map((item, index) => {
          if (!item || typeof item !== "object") return null
          const next = item as {
            stepId?: string
            type?: string
            title?: string
            status?: string
            detail?: string
          }
          const status = String(next.status || "").toLowerCase()
          const normalizedStatus: "pending" | "completed" | "failed" | "skipped" =
            status === "completed" || status === "failed" || status === "skipped"
              ? status
              : "pending"
          return {
            stepId: String(next.stepId || `step-${index + 1}`),
            type: String(next.type || "output"),
            title: String(next.title || `Step ${index + 1}`),
            status: normalizedStatus,
            detail: typeof next.detail === "string" && next.detail.trim() ? next.detail.trim() : undefined,
          }
        })
        .filter((item): item is { stepId: string; type: string; title: string; status: "pending" | "completed" | "failed" | "skipped"; detail: string | undefined } => Boolean(item))
      return mapped.length > 0 ? mapped : fallbackSteps
    },
    [],
  )

  const formatRelativeTime = useCallback((iso: string): string => {
    const ts = new Date(iso).getTime()
    if (!Number.isFinite(ts)) return "just now"
    const diffMs = Date.now() - ts
    if (diffMs < 60_000) return "just now"
    const minutes = Math.floor(diffMs / 60_000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
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
          } as WorkflowStep
        }

        return {
          ...base,
          title: typeof step.title === "string" && step.title.trim() ? step.title.trim() : base.title,
          outputChannel: step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
            ? step.outputChannel
            : base.outputChannel,
          outputTiming: step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate",
          outputTime: typeof step.outputTime === "string" && /^\d{2}:\d{2}$/.test(step.outputTime) ? step.outputTime : (fallbackTime || base.outputTime),
          outputFrequency: step.outputFrequency === "multiple" ? "multiple" : "once",
          outputRepeatCount: typeof step.outputRepeatCount === "string" && step.outputRepeatCount.trim() ? step.outputRepeatCount : base.outputRepeatCount,
          outputRecipients: sanitizeOutputRecipients(
            step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
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
      const res = await fetch("/api/missions/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          deploy: false,
          timezone: (detectedTimezone || "America/New_York").trim(),
          enabled: true,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean
        error?: string
        debug?: string
        provider?: string
        model?: string
        workflow?: {
          label?: string
          integration?: string
          summary?: GeneratedMissionSummary
        }
      }

      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) {
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
      const res = await fetch("/api/missions/nova-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepTitle: step.title || "AI Process",
        }),
      })
      const data = await res.json().catch(() => ({})) as { ok?: boolean; prompt?: string; error?: string }

      if (!res.ok) {
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
      const muted = localStorage.getItem("nova-muted") === "true"
      if (!settings.app.soundEnabled || muted) return
      const audio = new Audio("/sounds/click.mp3")
      audio.volume = 0.5
      void audio.play().catch(() => {})
    } catch {}
  }, [])

  const refreshSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/notifications/schedules", { cache: "no-store" })
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Unauthorized")
      }
      const data = await res.json()
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
    const refreshCatalog = async () => {
      try {
        const res = await fetch("/api/integrations/catalog", { cache: "no-store" })
        const payload = await res.json().catch(() => ({})) as { catalog?: unknown[] }
        if (cancelled) return
        setIntegrationCatalog(normalizeIntegrationCatalog(payload.catalog))
      } catch {
        if (!cancelled) setIntegrationCatalog([])
      }
    }

    void refreshCatalog()
    const interval = window.setInterval(() => {
      void refreshCatalog()
    }, 4000)
    const onUpdated = () => {
      void refreshCatalog()
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener("storage", onUpdated)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener("storage", onUpdated)
    }
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => {
      setStatus(null)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (!missionActionMenu) return

    const closeMenu = () => setMissionActionMenu(null)
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (missionActionMenuRef.current?.contains(target)) return
      closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onEscape)
    window.addEventListener("resize", closeMenu)
    window.addEventListener("scroll", closeMenu, true)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onEscape)
      window.removeEventListener("resize", closeMenu)
      window.removeEventListener("scroll", closeMenu, true)
    }
  }, [missionActionMenu])

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
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
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

  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement, options?: { enableGlow?: boolean; showSpotlightCore?: boolean }) => {
      const enableGlow = options?.enableGlow ?? true
      const showSpotlightCore = options?.showSpotlightCore ?? true
      const spotlight = enableGlow && showSpotlightCore ? document.createElement("div") : null
      if (spotlight) {
        spotlight.className = "home-global-spotlight"
        section.appendChild(spotlight)
      }
      let liveStars = 0
      let suppressSpotlightUntil = 0
      let suppressResetTimer: number | null = null

      const clearSpotlightState = () => {
        if (spotlight) spotlight.style.opacity = "0"
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => {
          card.style.setProperty("--glow-intensity", "0")
          const stars = card.querySelectorAll(".fx-star-particle")
          stars.forEach((star) => star.remove())
        })
        liveStars = 0
      }

      const handleMouseMove = (e: MouseEvent) => {
        if (Date.now() < suppressSpotlightUntil) return
        if (spotlight) {
          const rect = section.getBoundingClientRect()
          spotlight.style.left = `${e.clientX - rect.left}px`
          spotlight.style.top = `${e.clientY - rect.top}px`
          spotlight.style.opacity = "1"
        }

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        const proximity = 70
        const fadeDistance = 140
        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const inside =
            e.clientX >= cardRect.left &&
            e.clientX <= cardRect.right &&
            e.clientY >= cardRect.top &&
            e.clientY <= cardRect.bottom

          const centerX = cardRect.left + cardRect.width / 2
          const centerY = cardRect.top + cardRect.height / 2
          const distance =
            Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
          const effectiveDistance = Math.max(0, distance)

          let glowIntensity = 0
          if (effectiveDistance <= proximity) glowIntensity = 1
          else if (effectiveDistance <= fadeDistance) glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)

          if (enableGlow) {
            const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
            const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
            card.style.setProperty("--glow-x", `${relativeX}%`)
            card.style.setProperty("--glow-y", `${relativeY}%`)
            card.style.setProperty("--glow-intensity", glowIntensity.toString())
            card.style.setProperty("--glow-radius", "88px")
          } else {
            card.style.setProperty("--glow-intensity", "0")
          }

          const shouldSpawnStar = enableGlow ? glowIntensity > 0.2 : true
          const spawnRate = enableGlow ? 0.16 : 0.12
          if (inside && shouldSpawnStar && Math.random() <= spawnRate && liveStars < 42) {
            liveStars += 1
            const star = document.createElement("span")
            star.className = "fx-star-particle"
            star.style.left = `${e.clientX - cardRect.left}px`
            star.style.top = `${e.clientY - cardRect.top}px`
            star.style.setProperty("--fx-star-color", "rgba(255,255,255,1)")
            star.style.setProperty("--fx-star-glow", "rgba(255,255,255,0.7)")
            star.style.setProperty("--star-x", `${(Math.random() - 0.5) * 34}px`)
            star.style.setProperty("--star-y", `${-12 - Math.random() * 26}px`)
            star.style.animationDuration = `${0.9 + Math.random() * 0.6}s`
            card.appendChild(star)
            star.addEventListener(
              "animationend",
              () => {
                star.remove()
                liveStars = Math.max(0, liveStars - 1)
              },
              { once: true },
            )
          }
        })
      }

      const handleMouseLeave = () => {
        clearSpotlightState()
      }

      const handleScroll = () => {
        suppressSpotlightUntil = Date.now() + 180
        if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer)
        suppressResetTimer = window.setTimeout(() => {
          suppressSpotlightUntil = 0
          suppressResetTimer = null
        }, 180)
        clearSpotlightState()
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)
      section.addEventListener("scroll", handleScroll, true)
      section.addEventListener("wheel", handleScroll, { passive: true, capture: true })
      section.addEventListener("touchmove", handleScroll, { passive: true, capture: true })
      window.addEventListener("wheel", handleScroll, { passive: true })

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        section.removeEventListener("scroll", handleScroll, true)
        section.removeEventListener("wheel", handleScroll, true)
        section.removeEventListener("touchmove", handleScroll, true)
        window.removeEventListener("wheel", handleScroll)
        if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer)
        clearSpotlightState()
        spotlight?.remove()
      }
    }

    const cleanups: Array<() => void> = []
    if (createSectionRef.current) cleanups.push(setupSectionSpotlight(createSectionRef.current))
    if (listSectionRef.current) cleanups.push(setupSectionSpotlight(listSectionRef.current))
    if (headerActionsRef.current) cleanups.push(setupSectionSpotlight(headerActionsRef.current, { showSpotlightCore: false }))
    if (builderOpen && builderBodyRef.current) cleanups.push(setupSectionSpotlight(builderBodyRef.current, { enableGlow: false }))
    if (builderOpen && builderFooterRef.current) cleanups.push(setupSectionSpotlight(builderFooterRef.current, { showSpotlightCore: false }))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [builderOpen, spotlightEnabled])

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
      const outputChannel = step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
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
      const res = await fetch("/api/notifications/schedules", isEditing
        ? {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: editingMissionId,
              ...payload,
              resetLastSent: true,
            }),
          }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) throw new Error(data?.error || (isEditing ? "Failed to save mission" : "Failed to create mission"))

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
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: true,
          success: false,
          steps: pendingSteps,
        })
        const triggerRes = await fetch("/api/notifications/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduleId: runScheduleId }),
        })
        const triggerData = await triggerRes.json().catch(() => ({})) as {
          ok?: boolean
          skipped?: boolean
          reason?: string
          stepTraces?: unknown
          error?: string
        }
        const finalizedSteps = normalizeRunStepTraces(triggerData?.stepTraces, pendingSteps)
        if (!triggerRes.ok) {
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: false,
          success: false,
            reason: triggerData?.error || triggerData?.reason || "Immediate run failed.",
            steps: finalizedSteps,
          })
          throw new Error(triggerData?.error || (isEditing ? "Mission was saved but immediate run failed." : "Mission was created but immediate run failed."))
        }
        setRunProgress({
          missionId: runScheduleId,
          missionLabel: label,
          running: false,
          success: Boolean(triggerData?.ok),
          reason: triggerData?.reason,
          steps: finalizedSteps,
        })
      }

      setStatus({
        type: "success",
        message: runImmediatelyOnCreate
          ? (isEditing ? "Mission saved and run started." : "Mission deployed and run started.")
          : (isEditing ? "Mission saved." : "Mission deployed."),
      })
      setBuilderOpen(false)
      resetMissionBuilder()
      await refreshSchedules()
    } catch (error) {
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
      const res = await fetch("/api/notifications/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: mission.id,
          integration: mission.integration,
          label: mission.label,
          message: mission.message,
          time: mission.time,
          timezone: (detectedTimezone || "America/New_York").trim(),
          enabled: mission.enabled,
          chatIds: [],
          resetLastSent: timeChanged || timezoneChanged || enabledChanged,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) throw new Error(data?.error || "Failed to save mission")
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
      const res = await fetch(`/api/notifications/schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/missions")}`)
        throw new Error("Session expired. Please sign in again.")
      }
      if (!res.ok) throw new Error(data?.error || "Failed to delete mission")
      setSchedules((prev) => prev.filter((s) => s.id !== id))
      setBaselineById((prev) => {
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
    if (Array.isArray(meta.workflowSteps) && meta.workflowSteps.length > 0) {
      setWorkflowSteps(meta.workflowSteps.map((step, index) => {
        const stepType = String(step.type || "")
        const resolvedType: WorkflowStepType = isWorkflowStepType(stepType) ? stepType : "output"
        const aiIntegration = (step.aiIntegration === "openai" || step.aiIntegration === "claude" || step.aiIntegration === "grok" || step.aiIntegration === "gemini")
          ? step.aiIntegration
          : resolveDefaultAiIntegration()
        return {
          id: `edit-${mission.id}-${index}-${Date.now()}`,
          type: resolvedType,
          title: step.title || STEP_TYPE_OPTIONS.find((option) => option.type === resolvedType)?.label || "Step",
          aiPrompt: resolvedType === "ai" ? (typeof step.aiPrompt === "string" ? step.aiPrompt : "") : undefined,
          aiModel: resolvedType === "ai"
            ? (typeof step.aiModel === "string" && step.aiModel.trim().length > 0
              ? step.aiModel
              : getDefaultModelForProvider(aiIntegration, integrationsSettings))
            : undefined,
          aiIntegration: resolvedType === "ai" ? aiIntegration : undefined,
          triggerMode: resolvedType === "trigger" ? (step.triggerMode === "once" || step.triggerMode === "daily" || step.triggerMode === "weekly" || step.triggerMode === "interval" ? step.triggerMode : "daily") : undefined,
          triggerTime: resolvedType === "trigger" ? (typeof step.triggerTime === "string" && step.triggerTime ? step.triggerTime : mission.time || "09:00") : undefined,
          triggerTimezone: resolvedType === "trigger" ? (typeof step.triggerTimezone === "string" && step.triggerTimezone ? step.triggerTimezone : (mission.timezone || detectedTimezone || "America/New_York")) : undefined,
          triggerDays: resolvedType === "trigger" ? (Array.isArray(step.triggerDays) ? step.triggerDays.map((day) => String(day)) : ["mon", "tue", "wed", "thu", "fri"]) : undefined,
          triggerIntervalMinutes: resolvedType === "trigger" ? (typeof step.triggerIntervalMinutes === "string" && step.triggerIntervalMinutes ? step.triggerIntervalMinutes : "30") : undefined,
          fetchSource: resolvedType === "fetch" ? (step.fetchSource === "api" || step.fetchSource === "web" || step.fetchSource === "calendar" || step.fetchSource === "crypto" || step.fetchSource === "rss" || step.fetchSource === "database" ? step.fetchSource : "api") : undefined,
          fetchMethod: resolvedType === "fetch" ? (step.fetchMethod === "POST" ? "POST" : "GET") : undefined,
          fetchApiIntegrationId: resolvedType === "fetch" ? (typeof step.fetchApiIntegrationId === "string" ? step.fetchApiIntegrationId : "") : undefined,
          fetchUrl: resolvedType === "fetch" ? (typeof step.fetchUrl === "string" ? step.fetchUrl : "") : undefined,
          fetchQuery: resolvedType === "fetch" ? (typeof step.fetchQuery === "string" ? step.fetchQuery : "") : undefined,
          fetchHeaders: resolvedType === "fetch" ? (typeof step.fetchHeaders === "string" ? step.fetchHeaders : "") : undefined,
          fetchSelector: resolvedType === "fetch" ? (typeof step.fetchSelector === "string" ? step.fetchSelector : "") : undefined,
          fetchRefreshMinutes: resolvedType === "fetch" ? (typeof step.fetchRefreshMinutes === "string" && step.fetchRefreshMinutes ? step.fetchRefreshMinutes : "15") : undefined,
          transformAction: resolvedType === "transform" ? (step.transformAction === "normalize" || step.transformAction === "dedupe" || step.transformAction === "aggregate" || step.transformAction === "format" || step.transformAction === "enrich" ? step.transformAction : "normalize") : undefined,
          transformFormat: resolvedType === "transform" ? (step.transformFormat === "text" || step.transformFormat === "json" || step.transformFormat === "markdown" || step.transformFormat === "table" ? step.transformFormat : "markdown") : undefined,
          transformInstruction: resolvedType === "transform" ? (typeof step.transformInstruction === "string" ? step.transformInstruction : "") : undefined,
          conditionField: resolvedType === "condition" ? (typeof step.conditionField === "string" ? step.conditionField : "priority") : undefined,
          conditionOperator: resolvedType === "condition"
            ? (step.conditionOperator === "contains" || step.conditionOperator === "equals" || step.conditionOperator === "not_equals" || step.conditionOperator === "greater_than" || step.conditionOperator === "less_than" || step.conditionOperator === "regex" || step.conditionOperator === "exists"
              ? step.conditionOperator
              : "contains")
            : undefined,
          conditionValue: resolvedType === "condition" ? (typeof step.conditionValue === "string" ? step.conditionValue : "") : undefined,
          conditionLogic: resolvedType === "condition" ? (step.conditionLogic === "any" ? "any" : "all") : undefined,
          conditionFailureAction: resolvedType === "condition" ? (step.conditionFailureAction === "notify" || step.conditionFailureAction === "stop" ? step.conditionFailureAction : "skip") : undefined,
          outputChannel: resolvedType === "output" ? (step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook" ? step.outputChannel : "telegram") : undefined,
          outputTiming: resolvedType === "output" ? (step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate") : undefined,
          outputTime: resolvedType === "output" ? (typeof step.outputTime === "string" && step.outputTime ? step.outputTime : mission.time || "09:00") : undefined,
          outputFrequency: resolvedType === "output" ? (step.outputFrequency === "multiple" ? "multiple" : "once") : undefined,
          outputRepeatCount: resolvedType === "output" ? (typeof step.outputRepeatCount === "string" && step.outputRepeatCount ? step.outputRepeatCount : "3") : undefined,
          outputRecipients: resolvedType === "output"
            ? sanitizeOutputRecipients(
              step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
                ? step.outputChannel
                : "telegram",
              typeof step.outputRecipients === "string" ? step.outputRecipients : "",
            )
            : undefined,
          outputTemplate: resolvedType === "output" ? (typeof step.outputTemplate === "string" ? step.outputTemplate : "") : undefined,
        }
      }))
      setCollapsedStepIds({})
    } else {
      setWorkflowSteps([])
      setCollapsedStepIds({})
    }
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
    if (Array.isArray(meta.workflowSteps) && meta.workflowSteps.length > 0) {
      setWorkflowSteps(meta.workflowSteps.map((step, index) => {
        const stepType = String(step.type || "")
        const resolvedType: WorkflowStepType = isWorkflowStepType(stepType) ? stepType : "output"
        const aiIntegration = (step.aiIntegration === "openai" || step.aiIntegration === "claude" || step.aiIntegration === "grok" || step.aiIntegration === "gemini")
          ? step.aiIntegration
          : resolveDefaultAiIntegration()
        return {
          id: `duplicate-${mission.id}-${index}-${Date.now()}`,
          type: resolvedType,
          title: step.title || STEP_TYPE_OPTIONS.find((option) => option.type === resolvedType)?.label || "Step",
          aiPrompt: resolvedType === "ai" ? (typeof step.aiPrompt === "string" ? step.aiPrompt : "") : undefined,
          aiModel: resolvedType === "ai"
            ? (typeof step.aiModel === "string" && step.aiModel.trim().length > 0
              ? step.aiModel
              : getDefaultModelForProvider(aiIntegration, integrationsSettings))
            : undefined,
          aiIntegration: resolvedType === "ai" ? aiIntegration : undefined,
          triggerMode: resolvedType === "trigger" ? (step.triggerMode === "once" || step.triggerMode === "daily" || step.triggerMode === "weekly" || step.triggerMode === "interval" ? step.triggerMode : "daily") : undefined,
          triggerTime: resolvedType === "trigger" ? (typeof step.triggerTime === "string" && step.triggerTime ? step.triggerTime : mission.time || "09:00") : undefined,
          triggerTimezone: resolvedType === "trigger" ? (typeof step.triggerTimezone === "string" && step.triggerTimezone ? step.triggerTimezone : (mission.timezone || detectedTimezone || "America/New_York")) : undefined,
          triggerDays: resolvedType === "trigger" ? (Array.isArray(step.triggerDays) ? step.triggerDays.map((day) => String(day)) : ["mon", "tue", "wed", "thu", "fri"]) : undefined,
          triggerIntervalMinutes: resolvedType === "trigger" ? (typeof step.triggerIntervalMinutes === "string" && step.triggerIntervalMinutes ? step.triggerIntervalMinutes : "30") : undefined,
          fetchSource: resolvedType === "fetch" ? (step.fetchSource === "api" || step.fetchSource === "web" || step.fetchSource === "calendar" || step.fetchSource === "crypto" || step.fetchSource === "rss" || step.fetchSource === "database" ? step.fetchSource : "api") : undefined,
          fetchMethod: resolvedType === "fetch" ? (step.fetchMethod === "POST" ? "POST" : "GET") : undefined,
          fetchApiIntegrationId: resolvedType === "fetch" ? (typeof step.fetchApiIntegrationId === "string" ? step.fetchApiIntegrationId : "") : undefined,
          fetchUrl: resolvedType === "fetch" ? (typeof step.fetchUrl === "string" ? step.fetchUrl : "") : undefined,
          fetchQuery: resolvedType === "fetch" ? (typeof step.fetchQuery === "string" ? step.fetchQuery : "") : undefined,
          fetchHeaders: resolvedType === "fetch" ? (typeof step.fetchHeaders === "string" ? step.fetchHeaders : "") : undefined,
          fetchSelector: resolvedType === "fetch" ? (typeof step.fetchSelector === "string" ? step.fetchSelector : "") : undefined,
          fetchRefreshMinutes: resolvedType === "fetch" ? (typeof step.fetchRefreshMinutes === "string" && step.fetchRefreshMinutes ? step.fetchRefreshMinutes : "15") : undefined,
          transformAction: resolvedType === "transform" ? (step.transformAction === "normalize" || step.transformAction === "dedupe" || step.transformAction === "aggregate" || step.transformAction === "format" || step.transformAction === "enrich" ? step.transformAction : "normalize") : undefined,
          transformFormat: resolvedType === "transform" ? (step.transformFormat === "text" || step.transformFormat === "json" || step.transformFormat === "markdown" || step.transformFormat === "table" ? step.transformFormat : "markdown") : undefined,
          transformInstruction: resolvedType === "transform" ? (typeof step.transformInstruction === "string" ? step.transformInstruction : "") : undefined,
          conditionField: resolvedType === "condition" ? (typeof step.conditionField === "string" ? step.conditionField : "priority") : undefined,
          conditionOperator: resolvedType === "condition"
            ? (step.conditionOperator === "contains" || step.conditionOperator === "equals" || step.conditionOperator === "not_equals" || step.conditionOperator === "greater_than" || step.conditionOperator === "less_than" || step.conditionOperator === "regex" || step.conditionOperator === "exists"
              ? step.conditionOperator
              : "contains")
            : undefined,
          conditionValue: resolvedType === "condition" ? (typeof step.conditionValue === "string" ? step.conditionValue : "") : undefined,
          conditionLogic: resolvedType === "condition" ? (step.conditionLogic === "any" ? "any" : "all") : undefined,
          conditionFailureAction: resolvedType === "condition" ? (step.conditionFailureAction === "notify" || step.conditionFailureAction === "stop" ? step.conditionFailureAction : "skip") : undefined,
          outputChannel: resolvedType === "output" ? (step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook" ? step.outputChannel : "telegram") : undefined,
          outputTiming: resolvedType === "output" ? (step.outputTiming === "scheduled" || step.outputTiming === "digest" ? step.outputTiming : "immediate") : undefined,
          outputTime: resolvedType === "output" ? (typeof step.outputTime === "string" && step.outputTime ? step.outputTime : mission.time || "09:00") : undefined,
          outputFrequency: resolvedType === "output" ? (step.outputFrequency === "multiple" ? "multiple" : "once") : undefined,
          outputRepeatCount: resolvedType === "output" ? (typeof step.outputRepeatCount === "string" && step.outputRepeatCount ? step.outputRepeatCount : "3") : undefined,
          outputRecipients: resolvedType === "output"
            ? sanitizeOutputRecipients(
              step.outputChannel === "telegram" || step.outputChannel === "discord" || step.outputChannel === "email" || step.outputChannel === "push" || step.outputChannel === "webhook"
                ? step.outputChannel
                : "telegram",
              typeof step.outputRecipients === "string" ? step.outputRecipients : "",
            )
            : undefined,
          outputTemplate: resolvedType === "output" ? (typeof step.outputTemplate === "string" ? step.outputTemplate : "") : undefined,
        }
      }))
      setCollapsedStepIds({})
    } else {
      setWorkflowSteps([])
      setCollapsedStepIds({})
    }
    setRunImmediatelyOnCreate(false)
    setBuilderOpen(true)
    setStatus({ type: "success", message: "Mission duplicated into builder. Configure and deploy." })
  }, [detectedTimezone, integrationsSettings, resolveDefaultAiIntegration])

  const runMissionNow = useCallback(async (mission: NotificationSchedule) => {
    setStatus(null)
    const meta = parseMissionWorkflowMeta(mission.message)
    const pendingSteps = toPendingRunSteps(meta.workflowSteps)
    setRunProgress({
      missionId: mission.id,
      missionLabel: mission.label || "Untitled mission",
      running: true,
      success: false,
      steps: pendingSteps,
    })
    try {
      const res = await fetch("/api/notifications/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: mission.id,
        }),
      })
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean
        skipped?: boolean
        reason?: string
        stepTraces?: unknown
        error?: string
      }
      const finalizedSteps = normalizeRunStepTraces(data?.stepTraces, pendingSteps)
      setRunProgress({
        missionId: mission.id,
        missionLabel: mission.label || "Untitled mission",
        running: false,
        success: Boolean(data?.ok),
        reason: data?.reason,
        steps: finalizedSteps,
      })
      if (!res.ok) throw new Error(data?.error || "Run now failed.")
      await refreshSchedules()
      setStatus({ type: "success", message: "Mission run completed. Review step trace panel for details." })
    } catch (error) {
      setRunProgress((prev) => prev ? {
        ...prev,
        running: false,
        success: false,
        reason: error instanceof Error ? error.message : "Run now failed.",
      } : prev)
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to run mission now." })
    }
  }, [normalizeRunStepTraces, refreshSchedules, toPendingRunSteps])

  const orbPalette = ORB_COLORS[orbColor]
  const floatingLinesGradient = useMemo(() => [orbPalette.circle1, orbPalette.circle2], [orbPalette.circle1, orbPalette.circle2])
  const orbHoverFilter = useMemo(
    () => `drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle1, 0.45)}) drop-shadow(0 0 28px ${hexToRgba(orbPalette.circle2, 0.28)})`,
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
  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {mounted && background === "floatingLines" && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 48% 42%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.16)} 30%, transparent 60%)`,
            }}
          />
        </div>
      )}
      {mounted && background === "customVideo" && !isLight && !!backgroundVideoUrl && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            src={backgroundVideoUrl}
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

      <div className="relative z-10 flex-1 h-dvh overflow-hidden transition-all duration-200">
        <div className="flex h-full w-full items-start justify-start px-3 py-4 sm:px-4 lg:px-6">
          <div className="w-full">
            <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => router.push("/home")}
                  onMouseEnter={() => setOrbHovered(true)}
                  onMouseLeave={() => setOrbHovered(false)}
                  className="group relative h-10 w-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105"
                  aria-label="Go to home"
                >
                  <NovaOrbIndicator
                    palette={orbPalette}
                    size={26}
                    animated={false}
                    className="transition-all duration-200"
                    style={{ filter: orbHovered ? orbHoverFilter : "none" }}
                  />
                </button>
                <div>
                  <h1 className={cn("text-2xl font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                  <p className="text-[10px] text-accent font-mono">V.0 Beta</p>
                </div>
              </div>
              <div className="min-w-0 px-1">
                <div className="mx-auto grid max-w-185 grid-cols-4 gap-2">
                  {[
                    { label: "Total Missions", value: String(missionStats.total), dotClass: isLight ? "bg-s-40" : "bg-slate-400" },
                    { label: "Active Missions", value: String(missionStats.enabled), dotClass: isLight ? "bg-emerald-400" : "bg-emerald-400" },
                    { label: "Total Runs", value: String(missionStats.totalRuns), dotClass: isLight ? "bg-sky-400" : "bg-sky-400" },
                    { label: "Success Rate", value: `${missionStats.successRate}%`, dotClass: isLight ? "bg-accent" : "bg-accent" },
                  ].map((tile) => (
                    <div
                      key={tile.label}
                      className={cn(
                        "h-9 rounded-md border px-2 py-1.5 flex items-center justify-between home-spotlight-card home-border-glow home-spotlight-card--hover",
                        subPanelClass,
                      )}
                    >
                      <div className="min-w-0">
                        <p className={cn("text-[9px] uppercase tracking-[0.12em] truncate", isLight ? "text-s-50" : "text-slate-400")}>{tile.label}</p>
                        <p className={cn("text-sm font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{tile.value}</p>
                      </div>
                      <span className={cn("h-2.5 w-2.5 rounded-sm", tile.dotClass)} />
                    </div>
                  ))}
                </div>
              </div>
              <div ref={headerActionsRef} className="flex items-center gap-2 home-spotlight-shell">
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={cn("h-8 w-8 rounded-lg transition-colors group/gear home-spotlight-card home-border-glow", subPanelClass)}
                  aria-label="Open settings"
                  title="Settings"
                >
                  <Settings className="w-3.5 h-3.5 mx-auto text-s-50 group-hover/gear:text-accent group-hover/gear:rotate-90 transition-transform duration-200" />
                </button>
                <button
                  onClick={() => {
                    playClickSound()
                    resetMissionBuilder()
                    setBuilderOpen(true)
                  }}
                  className={cn(
                    "h-8 px-3 rounded-lg border transition-colors text-sm font-medium inline-flex items-center justify-center home-spotlight-card home-border-glow",
                    isLight
                      ? "border-accent-30 bg-accent-10 text-accent"
                      : "border-accent-30 bg-accent-10 text-accent",
                  )}
                >
                  New Mission
                </button>
              </div>
            </div>

            {status && (
              <div className="pointer-events-none fixed left-1/2 top-5 z-70 -translate-x-1/2">
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-md",
                    status.type === "success"
                      ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
                      : "border-rose-300/40 bg-rose-500/15 text-rose-200",
                  )}
                >
                  {status.message}
                </div>
              </div>
            )}
            {runProgress && (
              <div className="fixed right-4 top-16 z-75 w-[min(420px,calc(100vw-1.5rem))]">
                <div
                  className={cn(
                    "rounded-xl border px-3 py-3 backdrop-blur-lg",
                    runProgress.success
                      ? "border-emerald-300/35 bg-emerald-500/10"
                      : runProgress.running
                        ? "border-sky-300/35 bg-sky-500/10"
                        : "border-rose-300/35 bg-rose-500/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-300")}>Mission Run Trace</p>
                      <p className={cn("text-sm font-semibold truncate", isLight ? "text-s-90" : "text-slate-100")}>{runProgress.missionLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRunProgress(null)}
                      className={cn(
                        "h-7 w-7 rounded-md border inline-flex items-center justify-center transition-colors",
                        isLight ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]" : "border-white/20 bg-black/20 text-slate-300 hover:bg-white/8",
                      )}
                      aria-label="Close run trace"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="mt-2.5 space-y-1.5 max-h-[44vh] overflow-y-auto overflow-x-hidden pr-1">
                    {runProgress.steps.map((step, index) => (
                      <div
                        key={`${step.stepId}-${index}`}
                        className={cn(
                          "rounded-md border px-2.5 py-2",
                          isLight ? "border-[#d5dce8] bg-white/90" : "border-white/14 bg-black/20",
                        )}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          {step.status === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-300" />}
                          {step.status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
                          {step.status === "failed" && <XCircle className="w-3.5 h-3.5 text-rose-300" />}
                          {step.status === "pending" && <Clock3 className="w-3.5 h-3.5 text-slate-400" />}
                          {step.status === "skipped" && <Clock3 className="w-3.5 h-3.5 text-amber-300" />}
                          <p className={cn("min-w-0 whitespace-normal wrap-break-word text-xs font-medium leading-snug", isLight ? "text-s-90" : "text-slate-100")}>
                            {index + 1}. {step.title}
                          </p>
                        </div>
                        {step.detail && (
                          <p className={cn("mt-1 pl-5 text-[11px] whitespace-normal break-all leading-snug", isLight ? "text-s-60" : "text-slate-300")}>{step.detail}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  {runProgress.reason && (
                    <p className={cn("mt-2 text-[11px] whitespace-normal break-all leading-snug", isLight ? "text-s-60" : "text-slate-300")}>{runProgress.reason}</p>
                  )}
                </div>
              </div>
            )}

            <div className="grid w-full grid-cols-1 gap-5 xl:grid-cols-[minmax(360px,28vw)_minmax(0,1fr)]">
              <section ref={createSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} min-h-0 flex flex-col`}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Quick Start Templates</h2>
                </div>
                <p className={cn("mt-0.5 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                  Launch production-ready mission blueprints and fine-tune in Mission Builder.
                </p>
                <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                  {QUICK_TEMPLATE_OPTIONS.map((template) => (
                    <div key={template.id} className={cn("rounded-lg border p-2.5 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className={cn("text-[13px] font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{template.label}</h3>
                          <p className={cn("mt-0.5 line-clamp-2 text-[11px] leading-snug", isLight ? "text-s-60" : "text-slate-400")}>{template.description}</p>
                        </div>
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]", isLight ? "border border-[#d5dce8] bg-white text-s-70" : "border border-white/12 bg-black/20 text-slate-300")}>
                          {formatIntegrationLabel(template.integration)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {template.tags.map((tag) => (
                          <span key={tag} className={cn("rounded-md px-1.5 py-0.5 text-[9px]", isLight ? "bg-[#e8eef9] text-s-70" : "bg-white/8 text-slate-300")}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => applyTemplate(template.id)}
                        className="mt-2 h-7 w-full rounded-md border border-accent-30 bg-accent-10 text-accent hover:bg-accent-20 transition-colors text-[11px]"
                      >
                        Use Template
                      </button>
                    </div>
                  ))}
                </div>
                <div className={cn("mt-3 rounded-xl border p-3.5 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                  <div className="flex items-center gap-2">
                    <WandSparkles className="w-3.5 h-3.5 text-accent" />
                    <h3 className={cn("text-xs uppercase tracking-[0.18em] font-semibold", isLight ? "text-s-80" : "text-slate-200")}>Nova Mission Generator</h3>
                  </div>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Uses your connected {AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider]} model to build a ready-to-review mission draft.
                  </p>
                  <textarea
                    value={novaMissionPrompt}
                    onChange={(e) => setNovaMissionPrompt(e.target.value)}
                    placeholder="Example: Monitor BTC moves above 3% in 1h, summarize drivers, and send alerts to Telegram."
                    className={cn(
                      "mt-2.5 min-h-22 w-full resize-y rounded-md border px-3 py-2 text-xs outline-none",
                      isLight ? "border-[#d5dce8] bg-white text-s-90 placeholder:text-s-40" : "border-white/14 bg-black/25 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <button
                    onClick={() => {
                      playClickSound()
                      void generateMissionDraftFromPrompt()
                    }}
                    disabled={novaGeneratingMission}
                    className="mt-2.5 h-8 w-full rounded-md border border-accent-30 bg-accent-10 text-accent hover:bg-accent-20 transition-colors text-xs disabled:opacity-60"
                  >
                    {novaGeneratingMission ? "Generating Draft..." : "Generate Mission Draft"}
                  </button>
                </div>
              </section>

              <section ref={listSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-5 ${moduleHeightClass} min-h-0 flex flex-col w-full`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 text-accent" />
                    <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Mission Pipeline Settings</h2>
                  </div>
                  <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>{filteredSchedules.length} missions</p>
                </div>
                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_190px_auto] gap-2">
                  <div className={cn("flex items-center gap-2 rounded-lg border px-2.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                    <Search className={cn("w-3.5 h-3.5 shrink-0", isLight ? "text-s-50" : "text-slate-500")} />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search missions..."
                      className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                    />
                  </div>
                  <FluidSelect value={statusFilter} onChange={setStatusFilter} options={MISSION_FILTER_STATUS_OPTIONS} isLight={isLight} className={cn(subPanelClass)} />
                  <div className={cn("h-9 rounded-lg border px-1 flex items-center gap-1", subPanelClass)}>
                    <button
                      onClick={() => setMissionBoardView("grid")}
                      className={cn(
                        "h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors",
                        missionBoardView === "grid"
                          ? "bg-accent-20 text-accent border border-accent-30"
                          : isLight
                            ? "text-s-60 hover:bg-[#eaf1fb]"
                            : "text-slate-400 hover:bg-white/8",
                      )}
                      aria-label="Grid view"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setMissionBoardView("list")}
                      className={cn(
                        "h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors",
                        missionBoardView === "list"
                          ? "bg-accent-20 text-accent border border-accent-30"
                          : isLight
                            ? "text-s-60 hover:bg-[#eaf1fb]"
                            : "text-slate-400 hover:bg-white/8",
                      )}
                      aria-label="List view"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className={cn("mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1", missionBoardView === "grid" ? "" : "")}>
                  {loading && <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>Loading missions...</p>}
                  {!loading && filteredSchedules.length === 0 && (
                    <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-400")}>No missions match the current filters.</p>
                  )}

                  <div className={cn(missionBoardView === "grid" ? "grid grid-cols-1 gap-3 xl:grid-cols-3" : "space-y-3")}>
                  {filteredSchedules.map((mission) => {
                    const busy = Boolean(busyById[mission.id])
                    const details = parseMissionWorkflowPayload(mission.message)
                    const priority = normalizePriority(details.priority)
                    const runs = Number.isFinite(mission.runCount) ? Number(mission.runCount) : 0
                    const successes = Number.isFinite(mission.successCount) ? Number(mission.successCount) : 0
                    const successRate = runs > 0 ? Math.round((successes / runs) * 100) : 100
                    const processChips = details.process.slice(0, 4)
                    const runState = runProgress && runProgress.missionId === mission.id ? runProgress : null
                    const runningStepIndex = runState?.running ? runState.steps.findIndex((step) => step.status === "running") : -1
                    const runningStep = runningStepIndex !== undefined && runningStepIndex >= 0 ? runState?.steps[runningStepIndex] : null
                    const missionStatusText = runState?.running
                      ? `Running now${runningStep ? `: ${runningStepIndex + 1}/${runState.steps.length} ${runningStep.title}` : "..."}`
                      : runState
                        ? `${runState.success ? "Last run completed" : "Last run failed"}${runState.reason ? `: ${runState.reason}` : ""}`
                        : mission.lastRunAt
                          ? `Last run ${formatRelativeTime(mission.lastRunAt)}`
                          : mission.enabled
                            ? "Scheduled"
                            : "Paused and not running"
                    const missionStatusToneClass = runState?.running
                      ? "text-sky-300"
                      : runState
                        ? (runState.success ? "text-emerald-300" : "text-rose-300")
                        : mission.enabled
                          ? "text-slate-300"
                          : "text-rose-300"
                    return (
                      <div key={mission.id} className={cn("rounded-xl border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex items-start gap-2.5">
                            <div className={cn("h-10 w-10 rounded-lg border inline-flex items-center justify-center shrink-0", isLight ? "border-[#d5dce8] bg-white" : "border-white/12 bg-black/30")}>
                              {getMissionIntegrationIcon(mission.integration, "w-4 h-4 text-accent")}
                            </div>
                            <div className="min-w-0">
                              <h3 className={cn("text-xl font-semibold truncate", isLight ? "text-s-90" : "text-slate-100")}>{mission.label || "Untitled mission"}</h3>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={cn("text-xs", isLight ? "text-s-60" : "text-slate-400")}>{formatIntegrationLabel(mission.integration)}</span>
                                <span
                                  className={cn(
                                    "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                                    priority === "low" && (isLight ? "border border-emerald-300 bg-emerald-100 text-emerald-700" : "border border-emerald-300/40 bg-emerald-500/15 text-emerald-300"),
                                    priority === "medium" && (isLight ? "border border-amber-300 bg-amber-100 text-amber-700" : "border border-amber-300/40 bg-amber-500/15 text-amber-300"),
                                    priority === "high" && (isLight ? "border border-orange-300 bg-orange-100 text-orange-700" : "border border-orange-300/40 bg-orange-500/15 text-orange-300"),
                                    priority === "critical" && (isLight ? "border border-rose-300 bg-rose-100 text-rose-700" : "border border-rose-300/40 bg-rose-500/15 text-rose-300"),
                                  )}
                                >
                                  {priority}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={(event) => {
                              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
                              const menuWidth = 180
                              const viewportPadding = 8
                              const left = Math.max(
                                viewportPadding,
                                Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPadding),
                              )
                              const top = rect.bottom + 6
                              setMissionActionMenu({
                                mission,
                                left,
                                top,
                              })
                            }}
                            className={cn(
                              "h-8 w-8 rounded-md inline-flex items-center justify-center transition-all duration-150",
                              "home-spotlight-card home-border-glow home-spotlight-card--hover",
                              isLight ? "text-s-50 hover:bg-[#eef3fb]" : "text-slate-500 hover:bg-white/8",
                            )}
                            aria-label="Mission actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>

                        <p className={cn("mt-3 text-sm line-clamp-2", isLight ? "text-s-70" : "text-slate-300")}>{details.description}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {processChips.map((stepType, index) => (
                            <span key={`${mission.id}-${stepType}-${index}`} className={cn("rounded-md px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]", isLight ? "border border-[#d5dce8] bg-white text-s-70" : "border border-white/12 bg-white/6 text-slate-300")}>
                              {stepType}
                            </span>
                          ))}
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <div>
                            <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Schedule</p>
                            <p className={cn("text-2xl font-semibold leading-none mt-1", isLight ? "text-s-90" : "text-slate-100")}>{mission.time}</p>
                            <p className={cn("text-[11px] mt-1", isLight ? "text-s-50" : "text-slate-500")}>{details.mode || "daily"}</p>
                          </div>
                          <div>
                            <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Runs</p>
                            <p className={cn("text-2xl font-semibold leading-none mt-1", isLight ? "text-s-90" : "text-slate-100")}>{runs}</p>
                            <p className={cn("text-[11px] mt-1", isLight ? "text-s-50" : "text-slate-500")}>total</p>
                          </div>
                          <div>
                            <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>Success</p>
                            <p className="text-2xl font-semibold leading-none mt-1 text-emerald-300">{successRate}%</p>
                            <div className={cn("mt-2 h-1 rounded-full", isLight ? "bg-[#dfe6f2]" : "bg-white/10")}>
                              <div className="h-1 rounded-full bg-emerald-400" style={{ width: `${Math.max(4, Math.min(100, successRate))}%` }} />
                            </div>
                          </div>
                        </div>

                        <div className={cn("mt-4 pt-3 border-t", isLight ? "border-[#dde4ef]" : "border-white/10")}>
                          <div className="flex items-center justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span className={cn("inline-flex items-start gap-1 text-sm font-medium min-w-0", missionStatusToneClass)}>
                              <span className={cn("h-2 w-2 rounded-full", runState?.running ? "bg-sky-400" : runState ? (runState.success ? "bg-emerald-400" : "bg-rose-400") : mission.enabled ? "bg-slate-400" : "bg-rose-400")} />
                              <span className={cn("shrink-0", isLight ? "text-s-60" : "text-slate-400")}>Status:</span>
                              <span className="min-w-0 whitespace-normal wrap-break-word leading-snug">{missionStatusText}</span>
                            </span>
                            <span className={cn("inline-flex items-center gap-1 text-sm font-medium", mission.enabled ? "text-emerald-300" : "text-rose-300")}>
                              <span className={cn("h-2 w-2 rounded-full", mission.enabled ? "bg-emerald-400" : "bg-rose-400")} />
                              {mission.enabled ? "Active" : "Paused"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const nextEnabled = !mission.enabled
                                updateLocalSchedule(mission.id, { enabled: nextEnabled })
                                void saveMission({ ...mission, enabled: nextEnabled })
                              }}
                              disabled={busy}
                              className={cn("h-7 px-2 rounded-md border text-xs transition-colors disabled:opacity-50", mission.enabled ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20" : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20")}
                            >
                              {mission.enabled ? "Pause" : "Activate"}
                            </button>
                            <button
                              onClick={() => setPendingDeleteMission(mission)}
                              disabled={busy}
                              className="h-7 w-7 rounded-md border border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20 transition-colors disabled:opacity-50 inline-flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {builderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => {
              playClickSound()
              setBuilderOpen(false)
            }}
            aria-label="Close mission builder"
          />
          <div
            style={panelStyle}
            className={cn(
              "mission-builder-popup-no-glow relative z-10 w-full max-w-3xl rounded-2xl border overflow-hidden",
              isLight
                ? "border-[#d9e0ea] bg-white"
                : "border-white/20 bg-white/6 backdrop-blur-2xl",
            )}
          >
            {!isLight && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(165deg, ${hexToRgba(orbPalette.circle1, 0.16)} 0%, rgba(6,10,20,0.75) 45%, ${hexToRgba(orbPalette.circle2, 0.14)} 100%)`,
                }}
              />
            )}
            <div
              className={cn(
                "relative z-10 flex items-center justify-between px-5 py-4 border-b",
                isLight ? "border-[#e2e8f2]" : "border-white/10",
              )}
              style={{
                background: `linear-gradient(90deg, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.12)} 100%)`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-accent-20 border border-accent-30 inline-flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <h3 className={cn("text-2xl font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>Mission Builder</h3>
                  <p className={cn("text-sm", isLight ? "text-s-60" : "text-slate-300")}>Design your automated workflow</p>
                </div>
              </div>
              <button
                onClick={() => {
                  playClickSound()
                  setBuilderOpen(false)
                }}
                className={cn(
                  "h-8 w-8 rounded-md border inline-flex items-center justify-center",
                  isLight ? "border-[#d5dce8] bg-white text-s-70" : "border-white/12 bg-black/20 text-slate-300",
                )}
                aria-label="Close mission builder"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              ref={builderBodyRef}
              className="hide-scrollbar relative z-10 p-3.5 h-[68vh] overflow-y-auto! overflow-x-hidden! overscroll-contain touch-pan-y space-y-2.5 home-spotlight-shell"
            >
              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Mission Name</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Daily Team Sync"
                  className={cn("mt-0.5 h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                />
              </div>

              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this mission accomplish?"
                  className={cn("mt-0.5 w-full resize-none bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                />
              </div>

              <div className={cn("rounded-lg border p-1.5 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                  <div>
                    <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Priority</label>
                    <FluidSelect value={newPriority} onChange={setNewPriority} options={PRIORITY_OPTIONS} isLight={isLight} className="mt-0.5 w-full" />
                  </div>
                  <div>
                    <label className={cn("text-[11px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Tags</label>
                    <div className={cn("mt-0.5 flex items-center gap-2 rounded-lg border px-2.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            addTag()
                          }
                        }}
                        placeholder="Add tag..."
                        className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500")}
                      />
                      <button onClick={() => { playClickSound(); addTag() }} className="text-xs text-accent">Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {missionTags.map((tag) => (
                        <button key={tag} onClick={() => { playClickSound(); removeTag(tag) }} className={cn("rounded-md px-2 py-1 text-xs border", isLight ? "border-[#d5dce8] bg-white text-s-80" : "border-white/10 bg-black/20 text-slate-200")}>
                          #{tag} <span className="opacity-70">x</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={cn("rounded-xl border p-3.5 home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock3 className="w-4 h-4 text-accent" />
                  <h4 className={cn("text-lg font-semibold", isLight ? "text-s-90" : "text-slate-100")}>Schedule</h4>
                </div>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[208px_minmax(0,1fr)_168px] lg:items-center">
                  <div className="w-full max-w-full">
                    <TimeField value24={newTime} onChange24={setNewTime} isLight={isLight} />
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const selected = newScheduleDays.includes(day.id)
                      return (
                        <button
                          key={day.id}
                        onClick={() => {
                          playClickSound()
                          toggleScheduleDay(day.id)
                        }}
                        className={cn(
                          "h-8 w-full px-2 rounded-md text-xs font-medium border transition-colors",
                          selected
                            ? "border-accent-30 bg-accent-20 text-accent"
                            : isLight
                              ? "border-[#d5dce8] bg-white text-s-70 hover:bg-[#eef3fb]"
                              : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/8",
                          )}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="w-full min-w-40 lg:max-w-45 lg:justify-self-end">
                    <FluidSelect value={newScheduleMode} onChange={setNewScheduleMode} options={SCHEDULE_MODE_OPTIONS} isLight={isLight} />
                  </div>
                </div>
              </div>

              <div className={cn("rounded-xl border p-3.5 home-spotlight-card home-border-glow home-spotlight-card--hover", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
                <div className="flex items-center justify-between">
                  <h4 className={cn("text-lg font-semibold inline-flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
                    <Zap className="w-4 h-4 text-accent" />
                    Workflow Steps
                  </h4>
                  <span className={cn("text-xs", isLight ? "text-s-60" : "text-slate-400")}>{workflowSteps.length} steps</span>
                </div>
                <div className="mt-3 space-y-2">
                  {workflowSteps.length === 0 && (
                    <div className={cn("rounded-lg border px-3 py-2 text-sm", isLight ? "border-[#d5dce8] bg-white text-s-60" : "border-white/12 bg-black/20 text-slate-400")}>
                      No workflow steps yet. Add workflow steps below.
                    </div>
                  )}
                  {workflowSteps.map((step, index) => (
                    <div
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
                        "rounded-lg border px-3 py-2",
                        isLight ? STEP_THEME[step.type].light : STEP_THEME[step.type].dark,
                        dragOverStepId === step.id && (isLight ? "ring-2 ring-accent-30" : "ring-2 ring-accent-30/80"),
                      )}
                    >
                      <div className="grid grid-cols-[18px_18px_36px_minmax(0,1fr)_auto] items-center gap-2">
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
                          className={cn(
                            "h-5 w-5 inline-flex items-center justify-center rounded cursor-grab active:cursor-grabbing transition-all duration-150",
                            isLight ? "hover:bg-black/5" : "hover:bg-white/10",
                          )}
                          aria-label={`Drag step ${index + 1} to reorder`}
                        >
                          <GripVertical className={cn("w-3.5 h-3.5", isLight ? "text-s-40" : "text-slate-500")} />
                        </button>
                        <span className={cn("text-xs tabular-nums", isLight ? "text-s-60" : "text-slate-400")}>{index + 1}</span>
                        <span
                          className={cn(
                            "h-8 w-8 rounded-md border inline-flex items-center justify-center",
                            isLight ? STEP_THEME[step.type].pillLight : STEP_THEME[step.type].pillDark,
                          )}
                        >
                          {renderStepIcon(step.type, cn("w-3.5 h-3.5", isLight ? STEP_TEXT_THEME[step.type].light : STEP_TEXT_THEME[step.type].dark))}
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            value={step.title}
                            onChange={(e) => updateWorkflowStepTitle(step.id, e.target.value)}
                            className={cn("h-8 w-full bg-transparent text-sm outline-none", isLight ? "text-s-90" : "text-slate-100")}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleWorkflowStepCollapsed(step.id)}
                            className={cn(
                              "h-7 w-7 rounded border inline-flex items-center justify-center transition-colors",
                              isLight ? "border-[#d5dce8] bg-white text-s-60 hover:bg-[#eef3fb]" : "border-white/15 bg-black/20 text-slate-300 hover:bg-white/8",
                            )}
                            aria-label={collapsedStepIds[step.id] ? "Expand step details" : "Collapse step details"}
                          >
                            {collapsedStepIds[step.id] ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => {
                              playClickSound()
                              removeWorkflowStep(step.id)
                            }}
                            className="h-7 w-7 rounded border border-rose-300/40 bg-rose-500/15 text-rose-200 inline-flex items-center justify-center transition-all duration-150 hover:-translate-y-px hover:bg-rose-500/25 hover:shadow-[0_8px_20px_-12px_rgba(244,63,94,0.75)] active:translate-y-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {!collapsedStepIds[step.id] && (
                        <>
                          {step.type === "trigger" && (
                            <div className={cn("mt-3 space-y-1.5 border-t pt-3", isLight ? "border-amber-200/80" : "border-amber-300/20")}>
                              <p className={cn("text-xs", isLight ? "text-amber-700" : "text-amber-300")}>
                                Mission trigger uses the schedule above and automatically uses your detected timezone ({detectedTimezone}).
                              </p>
                            </div>
                          )}
                      {step.type === "fetch" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-sky-200/80" : "border-sky-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Data Source</label>
                              <FluidSelect value={step.fetchSource ?? "api"} onChange={(next) => updateWorkflowStep(step.id, { fetchSource: next as WorkflowStep["fetchSource"] })} options={STEP_FETCH_SOURCE_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>HTTP Method</label>
                              <FluidSelect value={step.fetchMethod ?? "GET"} onChange={(next) => updateWorkflowStep(step.id, { fetchMethod: next as WorkflowStep["fetchMethod"] })} options={STEP_FETCH_METHOD_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Refresh (Minutes)</label>
                              <input
                                value={step.fetchRefreshMinutes ?? "15"}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchRefreshMinutes: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                                placeholder="15"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          {step.fetchSource === "api" && apiFetchIntegrationOptions.length > 0 && (
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>API Integration</label>
                              <FluidSelect
                                value={step.fetchApiIntegrationId ?? ""}
                                onChange={(next) => {
                                  const selected = catalogApiById[next]
                                  updateWorkflowStep(step.id, {
                                    fetchApiIntegrationId: next,
                                    fetchUrl: selected?.endpoint || step.fetchUrl || "",
                                  })
                                }}
                                options={apiFetchIntegrationOptions}
                                isLight={isLight}
                              />
                            </div>
                          )}
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Endpoint / URL</label>
                            <input
                              value={step.fetchUrl ?? ""}
                              onChange={(e) => updateWorkflowStep(step.id, { fetchUrl: e.target.value })}
                              placeholder={step.fetchSource === "web" ? "https://example.com/prices" : "https://api.example.com/data"}
                              className={cn(
                                "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Query / Params</label>
                              <input
                                value={step.fetchQuery ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchQuery: e.target.value })}
                                placeholder="symbol=BTC&window=24h or calendar=today"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>CSS Selector (Web Scrape)</label>
                              <input
                                value={step.fetchSelector ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { fetchSelector: e.target.value })}
                                placeholder=".price-table .row"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-sky-700" : "text-sky-300")}>Headers / Auth JSON</label>
                            <textarea
                              value={step.fetchHeaders ?? ""}
                              onChange={(e) => updateWorkflowStep(step.id, { fetchHeaders: e.target.value })}
                              placeholder='{"Authorization":"Bearer ...","X-Source":"nova"}'
                              className={cn(
                                "min-h-16 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                isLight ? "border-sky-200 bg-white text-s-90 placeholder:text-s-40" : "border-sky-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                        </div>
                      )}
                      {step.type === "transform" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-emerald-200/80" : "border-emerald-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Transform Action</label>
                              <FluidSelect value={step.transformAction ?? "normalize"} onChange={(next) => updateWorkflowStep(step.id, { transformAction: next as WorkflowStep["transformAction"] })} options={STEP_TRANSFORM_ACTION_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Output Format</label>
                              <FluidSelect value={step.transformFormat ?? "markdown"} onChange={(next) => updateWorkflowStep(step.id, { transformFormat: next as WorkflowStep["transformFormat"] })} options={STEP_TRANSFORM_FORMAT_OPTIONS} isLight={isLight} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Transform Rules</label>
                            <textarea
                              value={step.transformInstruction ?? ""}
                              onChange={(e) => updateWorkflowStep(step.id, { transformInstruction: e.target.value })}
                              placeholder="Normalize fields, dedupe by ID, sort by priority, format for output."
                              className={cn(
                                "min-h-18 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                isLight ? "border-emerald-200 bg-white text-s-90 placeholder:text-s-40" : "border-emerald-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                        </div>
                      )}
                      {step.type === "condition" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-orange-200/80" : "border-orange-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Data Field</label>
                              <input
                                value={step.conditionField ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { conditionField: e.target.value })}
                                placeholder="priceChangePct"
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none",
                                  isLight ? "border-orange-200 bg-white text-s-90 placeholder:text-s-40" : "border-orange-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Operator</label>
                              <FluidSelect value={step.conditionOperator ?? "contains"} onChange={(next) => updateWorkflowStep(step.id, { conditionOperator: next as WorkflowStep["conditionOperator"] })} options={STEP_CONDITION_OPERATOR_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Expected Value</label>
                              <input
                                value={step.conditionValue ?? ""}
                                onChange={(e) => updateWorkflowStep(step.id, { conditionValue: e.target.value })}
                                placeholder="5"
                                disabled={(step.conditionOperator ?? "contains") === "exists"}
                                className={cn(
                                  "h-9 w-full rounded-md border px-3 text-sm outline-none disabled:opacity-50",
                                  isLight ? "border-orange-200 bg-white text-s-90 placeholder:text-s-40" : "border-orange-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                                )}
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>Rule Logic</label>
                              <FluidSelect value={step.conditionLogic ?? "all"} onChange={(next) => updateWorkflowStep(step.id, { conditionLogic: next as WorkflowStep["conditionLogic"] })} options={STEP_CONDITION_LOGIC_OPTIONS} isLight={isLight} />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-orange-700" : "text-orange-300")}>If Condition Fails</label>
                              <FluidSelect value={step.conditionFailureAction ?? "skip"} onChange={(next) => updateWorkflowStep(step.id, { conditionFailureAction: next as WorkflowStep["conditionFailureAction"] })} options={STEP_CONDITION_FAILURE_OPTIONS} isLight={isLight} />
                            </div>
                          </div>
                        </div>
                      )}
                      {step.type === "output" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-pink-200/80" : "border-pink-300/20")}>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Delivery Channel</label>
                              <FluidSelect
                                value={step.outputChannel ?? "telegram"}
                                onChange={(next) => {
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
                                options={outputChannelOptions}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Notify When</label>
                              <FluidSelect
                                value={step.outputTiming ?? "immediate"}
                                onChange={(next) => updateWorkflowStep(step.id, {
                                  outputTiming: next as WorkflowStep["outputTiming"],
                                  outputTime: newTime,
                                })}
                                options={STEP_OUTPUT_TIMING_OPTIONS}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-pink-700" : "text-pink-300")}>Notification Count</label>
                              <FluidSelect
                                value={step.outputFrequency ?? "once"}
                                onChange={(next) => {
                                  const outputFrequency = next as WorkflowStep["outputFrequency"]
                                  updateWorkflowStep(step.id, {
                                    outputFrequency,
                                    outputRepeatCount: outputFrequency === "multiple" ? (step.outputRepeatCount || "3") : "1",
                                  })
                                }}
                                options={STEP_OUTPUT_FREQUENCY_OPTIONS}
                                isLight={isLight}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      {step.type === "ai" && (
                        <div className={cn("mt-3 space-y-3 border-t pt-3", isLight ? "border-violet-200/80" : "border-violet-300/20")}>
                          <div className="space-y-1.5">
                            <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>AI Prompt</label>
                            <textarea
                              value={step.aiPrompt ?? ""}
                              onChange={(e) => updateWorkflowStepAi(step.id, { aiPrompt: e.target.value })}
                              placeholder="Describe what the AI should do with the data..."
                              className={cn(
                                "min-h-22 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none",
                                isLight
                                  ? "border-violet-200 bg-white text-s-90 placeholder:text-s-40"
                                  : "border-violet-300/30 bg-black/20 text-slate-100 placeholder:text-slate-500",
                              )}
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>Model</label>
                              <FluidSelect
                                value={step.aiModel ?? ""}
                                onChange={(next) => updateWorkflowStepAi(step.id, { aiModel: next })}
                                options={getModelOptionsForProvider(step.aiIntegration ?? resolveDefaultAiIntegration(), integrationsSettings)}
                                isLight={isLight}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className={cn("text-[11px] font-medium uppercase tracking-[0.12em]", isLight ? "text-violet-700" : "text-violet-300")}>Integration</label>
                              <FluidSelect
                                value={step.aiIntegration ?? resolveDefaultAiIntegration()}
                                onChange={(next) => {
                                  const nextIntegration = next as AiIntegrationType
                                  updateWorkflowStepAi(step.id, {
                                    aiIntegration: nextIntegration,
                                    aiModel: getDefaultModelForProvider(nextIntegration, integrationsSettings),
                                  })
                                }}
                                options={configuredAiIntegrationOptions.length > 0 ? configuredAiIntegrationOptions : [{ value: integrationsSettings.activeLlmProvider, label: AI_PROVIDER_LABELS[integrationsSettings.activeLlmProvider] }]}
                                isLight={isLight}
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", isLight ? "text-violet-700" : "text-violet-300")}>
                              <GitBranch className="w-3.5 h-3.5" />
                              Conditional Logic
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                playClickSound()
                                void novaSuggestForAiStep(step.id)
                              }}
                              disabled={Boolean(novaSuggestingByStepId[step.id])}
                              className={cn(
                                "h-7 px-2.5 rounded-md border inline-flex items-center gap-1 text-xs font-medium transition-all duration-150 disabled:opacity-60 disabled:transform-none hover:-translate-y-px active:translate-y-0",
                                isLight
                                  ? "border-violet-300 bg-violet-100/70 text-violet-700 hover:bg-violet-100 hover:shadow-[0_8px_18px_-12px_rgba(124,58,237,0.45)]"
                                  : "border-violet-300/35 bg-violet-500/12 text-violet-200 hover:bg-violet-500/20 hover:shadow-[0_10px_22px_-12px_rgba(167,139,250,0.6)]",
                              )}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {novaSuggestingByStepId[step.id] ? "Nova Suggesting..." : "Nova Suggest"}
                            </button>
                          </div>
                        </div>
                      )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STEP_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      onClick={() => {
                        playClickSound()
                        addWorkflowStep(option.type)
                      }}
                      className={cn(
                        "h-8 px-3 rounded-md border text-xs transition-all duration-150 inline-flex items-center gap-1.5 hover:-translate-y-px active:translate-y-0",
                        isLight ? STEP_THEME[option.type].light : STEP_THEME[option.type].dark,
                        isLight ? STEP_TEXT_THEME[option.type].light : STEP_TEXT_THEME[option.type].dark,
                        isLight
                          ? "hover:shadow-[0_10px_18px_-12px_rgba(15,23,42,0.35)]"
                          : "hover:shadow-[0_10px_22px_-12px_rgba(148,163,184,0.35)]",
                      )}
                    >
                      {renderStepIcon(option.type, "w-3 h-3")}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <div ref={builderFooterRef} className={cn("home-spotlight-shell relative z-10 border-t px-5 py-3 flex items-center justify-between", isLight ? "border-[#e2e8f2] bg-[#f9fbff]" : "border-white/10 bg-black/30")}>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    playClickSound()
                    setMissionActive((prev) => !prev)
                  }}
                  className="inline-flex items-center gap-2 text-sm"
                  aria-label="Toggle mission active"
                >
                  <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>Mission Active</span>
                  <span
                    className={cn(
                      "relative h-6 w-11 rounded-full transition-colors",
                      missionActive ? "bg-accent" : isLight ? "bg-[#d5dce8]" : "bg-white/20",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200",
                        missionActive ? "left-6" : "left-1",
                      )}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playClickSound()
                    setRunImmediatelyOnCreate((prev) => !prev)
                  }}
                  className="inline-flex items-center gap-2 text-sm"
                  aria-label={editingMissionId ? "Run once immediately after saving mission" : "Run once immediately after creating mission"}
                >
                  <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>Run Once Now</span>
                  <span
                    className={cn(
                      "relative h-6 w-11 rounded-full transition-colors",
                      runImmediatelyOnCreate ? "bg-accent" : isLight ? "bg-[#d5dce8]" : "bg-white/20",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200",
                        runImmediatelyOnCreate ? "left-6" : "left-1",
                      )}
                    />
                  </span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    playClickSound()
                    setBuilderOpen(false)
                  }}
                  className={cn(
                    "mission-builder-hover-gleam h-8 px-3 rounded-lg transition-colors inline-flex items-center justify-center home-spotlight-card home-border-glow home-spotlight-card--hover",
                    subPanelClass,
                    isLight ? "text-s-70" : "text-slate-300",
                  )}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    playClickSound()
                    void deployMissionFromBuilder()
                  }}
                  disabled={deployingMission}
                  className="mission-builder-hover-gleam h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent text-sm font-medium inline-flex items-center justify-center disabled:opacity-50 transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover"
                >
                  {deployingMission ? (editingMissionId ? "Saving..." : "Deploying...") : (editingMissionId ? "Save Mission" : "Deploy Mission")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {missionActionMenu && (
        <div
          ref={missionActionMenuRef}
          className={cn(
            "fixed z-80 w-45 rounded-xl border p-1.5 shadow-lg backdrop-blur-xl",
            isLight
              ? "border-[#d5dce8] bg-[#f4f7fd]/95 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]"
              : "border-white/10 bg-black/25 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.55)]",
          )}
          style={{ left: missionActionMenu.left, top: missionActionMenu.top }}
        >
          <button
            onClick={() => {
              const target = missionActionMenu.mission
              setMissionActionMenu(null)
              editMissionFromActions(target)
            }}
            className={cn(
              "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
              "home-spotlight-card home-border-glow home-spotlight-card--hover",
              isLight
                ? "text-s-80 hover:bg-[#eef3fb]"
                : "text-slate-200 hover:bg-white/8",
            )}
          >
            <Pencil className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
            Edit Mission
          </button>
          <button
            onClick={() => {
              const target = missionActionMenu.mission
              setMissionActionMenu(null)
              void duplicateMission(target)
            }}
            className={cn(
              "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
              "home-spotlight-card home-border-glow home-spotlight-card--hover",
              isLight
                ? "text-s-80 hover:bg-[#eef3fb]"
                : "text-slate-200 hover:bg-white/8",
            )}
          >
            <Copy className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
            Duplicate
          </button>
          <button
            onClick={() => {
              const target = missionActionMenu.mission
              setMissionActionMenu(null)
              void runMissionNow(target)
            }}
            className={cn(
              "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
              "home-spotlight-card home-border-glow home-spotlight-card--hover",
              isLight
                ? "text-s-80 hover:bg-[#eef3fb]"
                : "text-slate-200 hover:bg-white/8",
            )}
          >
            <Play className={cn("w-4 h-4", isLight ? "text-s-50" : "text-slate-400")} />
            Run Now
          </button>
          <div className={cn("my-1 border-t", isLight ? "border-[#e6ebf3]" : "border-white/12")} />
          <button
            onClick={() => {
              const target = missionActionMenu.mission
              setMissionActionMenu(null)
              setPendingDeleteMission(target)
            }}
            className={cn(
              "h-9 w-full rounded-md px-2.5 text-sm inline-flex items-center gap-2 transition-all duration-150",
              "home-spotlight-card home-border-glow home-spotlight-card--hover",
              isLight
                ? "text-rose-600 hover:bg-rose-500/10"
                : "text-rose-300 hover:bg-rose-500/12",
            )}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}

      {pendingDeleteMission && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setPendingDeleteMission(null)}
            aria-label="Close delete confirmation"
          />
          <div
            style={panelStyle}
            className={cn(
              "relative z-10 w-full max-w-md rounded-2xl border p-4",
              isLight
                ? "border-[#d9e0ea] bg-white shadow-none"
                : "border-white/12 bg-[#0b111a]/95 backdrop-blur-xl",
            )}
          >
            <h3 className={cn("text-sm uppercase tracking-[0.18em] font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
              Delete Mission
            </h3>
            <p className={cn("mt-2 text-sm", isLight ? "text-s-60" : "text-slate-300")}>
              This will permanently delete
              {" "}
              <span className={cn("font-medium", isLight ? "text-s-90" : "text-slate-100")}>
                {pendingDeleteMission.label || "Untitled mission"}
              </span>
              .
            </p>
            <p className={cn("mt-1 text-xs", isLight ? "text-s-50" : "text-slate-400")}>
              Scheduled delivery for this mission will stop immediately.
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDeleteMission(null)}
                className={cn(
                  "h-8 px-3 rounded-md border text-xs transition-colors",
                  isLight
                    ? "border-[#d5dce8] bg-[#f4f7fd] text-s-70 hover:bg-[#eef3fb]"
                    : "border-white/12 bg-white/6 text-slate-200 hover:bg-white/10",
                )}
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDeleteMission()}
                disabled={Boolean(busyById[pendingDeleteMission.id])}
                className="h-8 px-3 rounded-md border border-rose-300/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/25 text-xs transition-colors disabled:opacity-60"
              >
                {busyById[pendingDeleteMission.id] ? "Deleting..." : "Delete Mission"}
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
