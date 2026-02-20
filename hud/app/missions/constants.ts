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
    id: "morning-brief",
    label: "Morning Brief",
    description: "Top headlines and key updates delivered to your preferred notification channel.",
    integration: "preferred",
    priority: "medium",
    title: "Morning Brief",
    message: "Fetch major headlines and deliver a concise morning briefing to your preferred notification channel.",
    time: "08:00",
    tags: ["briefing", "daily", "news"],
    steps: [
      { type: "trigger", title: "Daily trigger at 08:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch top headlines", fetchSource: "web", fetchQuery: "top US and world headlines today site:reuters.com OR site:apnews.com", fetchIncludeSources: false },
      { type: "ai", title: "Summarize morning brief", aiPrompt: "Create a concise morning brief with 4-6 bullets. Prioritize high-impact updates and include one short watchout section." },
      { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "immediate" },
    ],
  },
  {
    id: "market-snapshot",
    label: "Market Snapshot",
    description: "Premarket indexes and macro drivers summarized for your preferred notification channel.",
    integration: "preferred",
    priority: "medium",
    title: "Market Snapshot",
    message: "Fetch premarket movement and major macro signals, then summarize for a quick read.",
    time: "07:30",
    tags: ["markets", "finance", "daily"],
    steps: [
      { type: "trigger", title: "Daily trigger at 07:30", triggerMode: "daily" },
      { type: "fetch", title: "Fetch market signals", fetchSource: "web", fetchQuery: "S&P 500 futures Nasdaq futures Dow futures premarket movers site:reuters.com OR site:bloomberg.com", fetchIncludeSources: false },
      { type: "ai", title: "Summarize market snapshot", aiPrompt: "Provide a short market snapshot with sections: Index Futures, Key Drivers, and Risk Watch. Keep it under 150 words." },
      { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "immediate" },
    ],
  },
  {
    id: "sports-daily",
    label: "Daily Sports Recap",
    description: "Overnight scores and major storylines delivered to your preferred notification channel.",
    integration: "preferred",
    priority: "medium",
    title: "Daily Sports Recap",
    message: "Fetch major game results from last night and summarize what mattered most.",
    time: "08:00",
    tags: ["sports", "scores", "daily"],
    steps: [
      { type: "trigger", title: "Daily trigger at 08:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch sports results", fetchSource: "web", fetchQuery: "NBA NFL MLB scores last night final site:espn.com OR site:nba.com OR site:nfl.com OR site:mlb.com", fetchIncludeSources: false },
      { type: "ai", title: "Summarize sports recap", aiPrompt: "List key final scores and one standout storyline. Use concise bullet points." },
      { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "immediate" },
    ],
  },
  {
    id: "crypto-watch",
    label: "Crypto Watch",
    description: "Track major crypto moves and summarize momentum for your preferred notification channel.",
    integration: "preferred",
    priority: "medium",
    title: "Crypto Watch",
    message: "Fetch major crypto market moves and produce a concise momentum update.",
    time: "09:00",
    tags: ["crypto", "markets", "alerts"],
    steps: [
      { type: "trigger", title: "Daily trigger at 09:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch crypto market update", fetchSource: "web", fetchQuery: "Bitcoin Ethereum crypto market update today site:coindesk.com OR site:cointelegraph.com", fetchIncludeSources: false },
      { type: "ai", title: "Summarize crypto watch", aiPrompt: "Summarize current crypto momentum in under 120 words. Include BTC/ETH direction and one risk note." },
      { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "immediate" },
    ],
  },
  {
    id: "coinbase-daily-portfolio",
    label: "Coinbase Daily Portfolio",
    description: "Daily Coinbase spot-price digest for your tracked assets.",
    integration: "preferred",
    priority: "medium",
    title: "Coinbase Daily Portfolio",
    message: "Fetch Coinbase spot prices for my tracked assets and deliver a concise daily summary.",
    time: "09:00",
    tags: ["coinbase", "crypto", "portfolio", "daily"],
    steps: [
      { type: "trigger", title: "Daily trigger at 09:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch Coinbase portfolio prices", fetchSource: "coinbase", fetchQuery: "primitive=daily_portfolio_summary&assets=BTC,ETH,SOL&quote=USD", fetchIncludeSources: false },
      { type: "ai", title: "Summarize Coinbase portfolio", aiPrompt: "Summarize the Coinbase spot-price snapshot. Include top movers and one risk note. Do not fabricate unavailable holdings data." },
      { type: "output", title: "Send notification", outputChannel: "novachat", outputTiming: "immediate" },
    ],
  },
  {
    id: "coinbase-price-alert-digest",
    label: "Coinbase Price Alert Digest",
    description: "Scheduled Coinbase alert-style digest using live spot prices.",
    integration: "preferred",
    priority: "medium",
    title: "Coinbase Price Alert Digest",
    message: "Fetch Coinbase spot prices for selected assets and generate a concise alert digest.",
    time: "10:00",
    tags: ["coinbase", "crypto", "alerts"],
    steps: [
      { type: "trigger", title: "Daily trigger at 10:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch Coinbase alert prices", fetchSource: "coinbase", fetchQuery: "primitive=price_alert_digest&assets=BTC,ETH,SOL,ADA&quote=USD&thresholdPct=2.5", fetchIncludeSources: false },
      { type: "ai", title: "Build price alert digest", aiPrompt: "Produce a short alert digest from Coinbase spot prices. Mention threshold context if available. Avoid fabricated percentages." },
      { type: "output", title: "Send notification", outputChannel: "novachat", outputTiming: "immediate" },
    ],
  },
  {
    id: "coinbase-weekly-pnl",
    label: "Coinbase Weekly PnL Snapshot",
    description: "Weekly Coinbase snapshot with explicit no-fabrication fallback for unavailable PnL inputs.",
    integration: "preferred",
    priority: "low",
    title: "Coinbase Weekly PnL Snapshot",
    message: "Fetch Coinbase market snapshot for my tracked assets and produce a weekly PnL-oriented summary.",
    time: "18:00",
    tags: ["coinbase", "crypto", "weekly", "pnl"],
    steps: [
      { type: "trigger", title: "Weekly trigger", triggerMode: "weekly" },
      { type: "fetch", title: "Fetch Coinbase weekly snapshot", fetchSource: "coinbase", fetchQuery: "primitive=weekly_pnl_summary&assets=BTC,ETH,SOL&quote=USD", fetchIncludeSources: false },
      { type: "ai", title: "Summarize weekly PnL context", aiPrompt: "Generate a weekly PnL-oriented summary using only available Coinbase data. If PnL inputs are missing, state that clearly and provide spot-price context only." },
      { type: "output", title: "Send notification", outputChannel: "novachat", outputTiming: "immediate" },
    ],
  },
  {
    id: "tech-news-digest",
    label: "Tech News Digest",
    description: "Top product and AI announcements delivered to your preferred notification channel.",
    integration: "preferred",
    priority: "low",
    title: "Tech News Digest",
    message: "Fetch important tech and AI announcements and summarize what matters.",
    time: "12:00",
    tags: ["tech", "ai", "news", "daily"],
    steps: [
      { type: "trigger", title: "Daily trigger at 12:00", triggerMode: "daily" },
      { type: "fetch", title: "Fetch tech + AI announcements", fetchSource: "web", fetchQuery: "technology AI product announcements today site:techcrunch.com OR site:theverge.com OR site:wired.com", fetchIncludeSources: false },
      { type: "ai", title: "Summarize tech digest", aiPrompt: "Highlight 3-4 significant stories with one-line why-it-matters for each. Use concise bullet points." },
      { type: "output", title: "Send notification", outputChannel: "telegram", outputTiming: "immediate" },
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
