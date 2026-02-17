import type { FluidSelectOption } from "@/components/ui/fluid-select"
import type { AiIntegrationType, QuickTemplateOption, WorkflowStepType } from "./types"

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

export const QUICK_TEMPLATE_OPTIONS: QuickTemplateOption[] = [
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
    id: "multi-topic-morning",
    label: "Morning Multi-Topic Brief",
    description: "NBA scores, market updates, and a motivational quote - all in one briefing.",
    integration: "telegram",
    priority: "medium",
    title: "Morning Multi-Topic Brief",
    message: "Fetch NBA scores from last night, stock market updates, and an inspirational quote. Deliver organized briefing.",
    time: "07:30",
    tags: ["sports", "markets", "motivation", "multi-topic"],
    steps: [
      { type: "trigger", title: "Schedule trigger at 07:30" },
      { type: "fetch", title: "Fetch NBA Scores", fetchQuery: "NBA scores last night final results" },
      { type: "fetch", title: "Fetch Market Update", fetchQuery: "stock market news today S&P 500 Dow Jones" },
      { type: "fetch", title: "Fetch Daily Quote", fetchQuery: "motivational quote of the day inspirational" },
      { type: "ai", title: "Summarize multi-topic report", aiPrompt: "Create a briefing with 3 sections: **NBA Scores** (list final scores), **Market Update** (report index movements), **Today's Quote** (present the quote). If data for a section is missing, say so." },
      { type: "output", title: "Send to Telegram" },
    ],
  },
  {
    id: "sports-daily",
    label: "Daily Sports Recap",
    description: "Get scores and highlights from NBA, NFL, or MLB games.",
    integration: "telegram",
    priority: "medium",
    title: "Daily Sports Recap",
    message: "Fetch sports scores and highlights from last night's games.",
    time: "08:00",
    tags: ["sports", "scores", "daily"],
    steps: [
      { type: "trigger", title: "Schedule trigger at 08:00" },
      { type: "fetch", title: "Fetch NBA Scores", fetchQuery: "NBA scores last night final results site:espn.com OR site:nba.com" },
      { type: "ai", title: "Summarize scores", aiPrompt: "List final scores with team names. Include notable performances if mentioned. Use bullet points." },
      { type: "output", title: "Send to Telegram" },
    ],
  },
  {
    id: "market-morning",
    label: "Morning Market Update",
    description: "Get pre-market news and overnight market movements.",
    integration: "telegram",
    priority: "medium",
    title: "Morning Market Update",
    message: "Fetch pre-market news, index futures, and key market developments.",
    time: "06:30",
    tags: ["markets", "finance", "daily"],
    steps: [
      { type: "trigger", title: "Schedule trigger at 06:30" },
      { type: "fetch", title: "Fetch Market News", fetchQuery: "stock market news today S&P 500 Dow Jones site:reuters.com OR site:bloomberg.com" },
      { type: "ai", title: "Summarize market update", aiPrompt: "Report major index movements with percentages. Mention key market drivers. Use bullet points for clarity." },
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
  {
    id: "tech-news-digest",
    label: "Tech News Digest",
    description: "Daily digest of top tech and AI news stories.",
    integration: "telegram",
    priority: "low",
    title: "Tech News Digest",
    message: "Fetch top technology and AI news, summarize key announcements and trends.",
    time: "12:00",
    tags: ["tech", "ai", "news", "daily"],
    steps: [
      { type: "trigger", title: "Schedule trigger at 12:00" },
      { type: "fetch", title: "Fetch Tech News", fetchQuery: "technology AI news announcements site:techcrunch.com OR site:theverge.com OR site:wired.com" },
      { type: "ai", title: "Summarize tech digest", aiPrompt: "Highlight 3-4 most significant tech stories. Focus on announcements, product launches, and industry trends. Use bullet points." },
      { type: "output", title: "Send to Telegram" },
    ],
  },
]

export const STEP_TYPE_OPTIONS: Array<{ type: WorkflowStepType; label: string }> = [
  { type: "trigger", label: "Trigger" },
  { type: "fetch", label: "Fetch Data" },
  { type: "ai", label: "AI Process" },
  { type: "transform", label: "Transform" },
  { type: "condition", label: "Condition" },
  { type: "output", label: "Send/Output" },
]

export const STEP_FETCH_SOURCE_OPTIONS: FluidSelectOption[] = [
  { value: "web", label: "Brave Web Search" },
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
  { value: "novachat", label: "NovaChat" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
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

export const AI_MODEL_OPTIONS: Record<AiIntegrationType, FluidSelectOption[]> = {
  openai: OPENAI_MODEL_SELECT_OPTIONS,
  claude: CLAUDE_MODEL_SELECT_OPTIONS,
  grok: GROK_MODEL_SELECT_OPTIONS,
  gemini: GEMINI_MODEL_SELECT_OPTIONS,
}

export const AI_DETAIL_LEVEL_OPTIONS: FluidSelectOption[] = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
]
