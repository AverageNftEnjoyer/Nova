/**
 * Mission Node Catalog — V.26 Enterprise Overhaul
 *
 * Defines all 30+ node types with metadata for the UI palette,
 * generation engine, and execution router.
 */

import type { MissionNodeType } from "./types"

// ─────────────────────────────────────────────────────────────────────────────
// Catalog Types
// ─────────────────────────────────────────────────────────────────────────────

export type NodePaletteCategory =
  | "triggers"
  | "data"
  | "ai"
  | "logic"
  | "transform"
  | "output"

export interface NodeCatalogEntry {
  type: MissionNodeType
  label: string
  description: string
  category: NodePaletteCategory
  icon: string         // lucide-react icon name
  color: string        // tailwind bg color (dark-mode friendly)
  borderColor: string  // tailwind border color
  textColor: string    // tailwind text color
  inputs: string[]     // input port names (empty = trigger node)
  outputs: string[]    // output port names
  tags: string[]       // searchable keywords
  isPro?: boolean      // reserved for future tiers
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog Entries
// ─────────────────────────────────────────────────────────────────────────────

export const NODE_CATALOG: NodeCatalogEntry[] = [
  // ─── TRIGGERS ────────────────────────────────────────────────────────────
  {
    type: "schedule-trigger",
    label: "Schedule",
    description: "Run this mission on a time-based schedule: daily, weekly, or on an interval.",
    category: "triggers",
    icon: "Clock",
    color: "bg-amber-500/10",
    borderColor: "border-amber-400/40",
    textColor: "text-amber-300",
    inputs: [],
    outputs: ["main"],
    tags: ["schedule", "cron", "time", "daily", "weekly", "interval", "recurring"],
  },
  {
    type: "webhook-trigger",
    label: "Webhook",
    description: "Start this mission when an HTTP request is received at a unique webhook URL.",
    category: "triggers",
    icon: "Webhook",
    color: "bg-amber-500/10",
    borderColor: "border-amber-400/40",
    textColor: "text-amber-300",
    inputs: [],
    outputs: ["main"],
    tags: ["webhook", "http", "trigger", "inbound", "api"],
  },
  {
    type: "manual-trigger",
    label: "Manual",
    description: "Trigger this mission manually from the Nova dashboard or via the API.",
    category: "triggers",
    icon: "Play",
    color: "bg-amber-500/10",
    borderColor: "border-amber-400/40",
    textColor: "text-amber-300",
    inputs: [],
    outputs: ["main"],
    tags: ["manual", "trigger", "on-demand", "test"],
  },
  {
    type: "event-trigger",
    label: "Event",
    description: "React to internal Nova events like message.received or skill.completed.",
    category: "triggers",
    icon: "Zap",
    color: "bg-amber-500/10",
    borderColor: "border-amber-400/40",
    textColor: "text-amber-300",
    inputs: [],
    outputs: ["main"],
    tags: ["event", "reactive", "stream", "nova"],
  },

  // ─── DATA ─────────────────────────────────────────────────────────────────
  {
    type: "http-request",
    label: "HTTP Request",
    description: "Make GET, POST, PUT, PATCH or DELETE requests to any REST API.",
    category: "data",
    icon: "Globe",
    color: "bg-sky-500/10",
    borderColor: "border-sky-400/40",
    textColor: "text-sky-300",
    inputs: ["main"],
    outputs: ["main", "error"],
    tags: ["http", "rest", "api", "fetch", "request", "get", "post", "url"],
  },
  {
    type: "web-search",
    label: "Web Search",
    description: "Search the web using Brave Search and optionally fetch full page content.",
    category: "data",
    icon: "Search",
    color: "bg-sky-500/10",
    borderColor: "border-sky-400/40",
    textColor: "text-sky-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["web", "search", "brave", "internet", "news", "research"],
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    description: "Read items from any RSS or Atom feed URL.",
    category: "data",
    icon: "Rss",
    color: "bg-sky-500/10",
    borderColor: "border-sky-400/40",
    textColor: "text-sky-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["rss", "atom", "feed", "news", "blog", "podcast"],
  },
  {
    type: "coinbase",
    label: "Coinbase",
    description: "Fetch live crypto prices, portfolio snapshots, transactions, and reports from Coinbase.",
    category: "data",
    icon: "TrendingUp",
    color: "bg-cyan-500/10",
    borderColor: "border-cyan-400/40",
    textColor: "text-cyan-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["coinbase", "crypto", "bitcoin", "ethereum", "portfolio", "price", "defi", "btc", "eth"],
  },
  {
    type: "file-read",
    label: "Read File",
    description: "Read the content of a local file as text, JSON, or CSV.",
    category: "data",
    icon: "FileText",
    color: "bg-sky-500/10",
    borderColor: "border-sky-400/40",
    textColor: "text-sky-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["file", "read", "csv", "json", "local"],
  },
  {
    type: "form-input",
    label: "Form Input",
    description: "Collect user input via a dynamic form before the mission continues.",
    category: "data",
    icon: "FormInput",
    color: "bg-sky-500/10",
    borderColor: "border-sky-400/40",
    textColor: "text-sky-300",
    inputs: [],
    outputs: ["main"],
    tags: ["form", "input", "user", "interactive"],
  },

  // ─── AI ───────────────────────────────────────────────────────────────────
  {
    type: "ai-summarize",
    label: "Summarize",
    description: "Use an AI model (Claude, OpenAI, Grok, Gemini) to summarize input text.",
    category: "ai",
    icon: "Sparkles",
    color: "bg-violet-500/10",
    borderColor: "border-violet-400/40",
    textColor: "text-violet-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["ai", "summarize", "llm", "claude", "openai", "gpt", "grok", "gemini", "nlp"],
  },
  {
    type: "ai-classify",
    label: "Classify",
    description: "Use AI to classify input into one of your defined categories.",
    category: "ai",
    icon: "Tag",
    color: "bg-violet-500/10",
    borderColor: "border-violet-400/40",
    textColor: "text-violet-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["ai", "classify", "categorize", "label", "sentiment"],
  },
  {
    type: "ai-extract",
    label: "Extract",
    description: "Use AI to extract structured fields (name, date, price, etc.) from unstructured text.",
    category: "ai",
    icon: "Scissors",
    color: "bg-violet-500/10",
    borderColor: "border-violet-400/40",
    textColor: "text-violet-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["ai", "extract", "parse", "ner", "structured", "json"],
  },
  {
    type: "ai-generate",
    label: "Generate",
    description: "Use AI to generate text content from a prompt (reports, emails, social posts, etc.).",
    category: "ai",
    icon: "PenLine",
    color: "bg-violet-500/10",
    borderColor: "border-violet-400/40",
    textColor: "text-violet-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["ai", "generate", "write", "content", "draft", "email", "report"],
  },
  {
    type: "ai-chat",
    label: "AI Chat",
    description: "Run a multi-turn conversation with an AI model using a custom message history.",
    category: "ai",
    icon: "MessageSquare",
    color: "bg-violet-500/10",
    borderColor: "border-violet-400/40",
    textColor: "text-violet-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["ai", "chat", "conversation", "assistant", "prompt"],
  },

  // ─── LOGIC ────────────────────────────────────────────────────────────────
  {
    type: "condition",
    label: "Condition",
    description: "Route the workflow down a true or false path based on field conditions.",
    category: "logic",
    icon: "GitBranch",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["true", "false"],
    tags: ["condition", "if", "else", "branch", "filter", "check"],
  },
  {
    type: "switch",
    label: "Switch",
    description: "Route to one of multiple output paths based on an expression value.",
    category: "logic",
    icon: "Shuffle",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["case_0", "case_1", "default"],
    tags: ["switch", "case", "route", "branch", "multi"],
  },
  {
    type: "loop",
    label: "Loop",
    description: "Iterate over each item in an array and process them one by one.",
    category: "logic",
    icon: "RefreshCw",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["item", "done"],
    tags: ["loop", "iterate", "each", "for", "array"],
  },
  {
    type: "merge",
    label: "Merge",
    description: "Wait for multiple parallel branches to complete, then merge their outputs.",
    category: "logic",
    icon: "GitMerge",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["input_0", "input_1"],
    outputs: ["main"],
    tags: ["merge", "join", "wait", "parallel", "fan-in"],
  },
  {
    type: "split",
    label: "Split",
    description: "Fan out to multiple parallel branches that execute simultaneously.",
    category: "logic",
    icon: "GitFork",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["output_0", "output_1"],
    tags: ["split", "parallel", "fan-out", "concurrent"],
  },
  {
    type: "wait",
    label: "Wait",
    description: "Pause execution for a duration, until a specific time, or until a webhook arrives.",
    category: "logic",
    icon: "Timer",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["wait", "delay", "pause", "sleep", "timer"],
  },

  // ─── TRANSFORM ────────────────────────────────────────────────────────────
  {
    type: "set-variables",
    label: "Set Variables",
    description: "Set workflow-level variables using expressions from previous node outputs.",
    category: "transform",
    icon: "Variable",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["variable", "set", "assign", "store", "state"],
  },
  {
    type: "code",
    label: "Code",
    description: "Run custom JavaScript to transform, reshape, or compute data.",
    category: "transform",
    icon: "Code2",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["code", "javascript", "script", "transform", "custom", "compute"],
  },
  {
    type: "format",
    label: "Format",
    description: "Render a Handlebars-style template into markdown, HTML, or plain text.",
    category: "transform",
    icon: "FileType",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["format", "template", "render", "markdown", "html", "text"],
  },
  {
    type: "filter",
    label: "Filter",
    description: "Keep or remove items in an array based on an expression.",
    category: "transform",
    icon: "Filter",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["filter", "remove", "keep", "where", "array"],
  },
  {
    type: "sort",
    label: "Sort",
    description: "Sort an array of items by a specified field in ascending or descending order.",
    category: "transform",
    icon: "ArrowUpDown",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["sort", "order", "rank", "ascending", "descending"],
  },
  {
    type: "dedupe",
    label: "Deduplicate",
    description: "Remove duplicate items from an array based on a field value.",
    category: "transform",
    icon: "Copy",
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-400/40",
    textColor: "text-emerald-300",
    inputs: ["main"],
    outputs: ["main"],
    tags: ["dedupe", "unique", "dedup", "distinct", "remove duplicates"],
  },

  // ─── OUTPUT ───────────────────────────────────────────────────────────────
  {
    type: "novachat-output",
    label: "Nova Chat",
    description: "Send the result as a message in Nova Chat (in-app).",
    category: "output",
    icon: "MessageCircle",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["nova", "chat", "in-app", "notification", "message"],
  },
  {
    type: "telegram-output",
    label: "Telegram",
    description: "Send a message to one or more Telegram chats or channels.",
    category: "output",
    icon: "Send",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["telegram", "bot", "notification", "message", "mobile"],
  },
  {
    type: "discord-output",
    label: "Discord",
    description: "Post a message to a Discord channel via webhook.",
    category: "output",
    icon: "Hash",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["discord", "webhook", "notification", "channel", "server"],
  },
  {
    type: "email-output",
    label: "Email",
    description: "Send an email to one or more recipients.",
    category: "output",
    icon: "Mail",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["email", "gmail", "smtp", "notification", "message", "inbox"],
  },
  {
    type: "webhook-output",
    label: "Webhook",
    description: "POST the output as JSON to an external webhook URL.",
    category: "output",
    icon: "Webhook",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["webhook", "outbound", "http", "post", "integration"],
  },
  {
    type: "slack-output",
    label: "Slack",
    description: "Post a message to a Slack channel via incoming webhook.",
    category: "output",
    icon: "Hash",
    color: "bg-pink-500/10",
    borderColor: "border-pink-400/40",
    textColor: "text-pink-300",
    inputs: ["main"],
    outputs: [],
    tags: ["slack", "notification", "channel", "workspace", "message"],
  },

  // ─── UTILITY ──────────────────────────────────────────────────────────────
  {
    type: "sticky-note",
    label: "Sticky Note",
    description: "Add a documentation note to your canvas.",
    category: "logic",
    icon: "StickyNote",
    color: "bg-yellow-500/10",
    borderColor: "border-yellow-400/40",
    textColor: "text-yellow-300",
    inputs: [],
    outputs: [],
    tags: ["note", "comment", "documentation", "sticky"],
  },
  {
    type: "sub-workflow",
    label: "Sub-Workflow",
    description: "Call another mission as a reusable sub-workflow.",
    category: "logic",
    icon: "Layers",
    color: "bg-orange-500/10",
    borderColor: "border-orange-400/40",
    textColor: "text-orange-300",
    inputs: ["main"],
    outputs: ["main", "error"],
    tags: ["sub-workflow", "reuse", "call", "nested", "modular"],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

const _catalogByType = new Map(NODE_CATALOG.map((e) => [e.type, e]))

export function getNodeCatalogEntry(type: MissionNodeType): NodeCatalogEntry | undefined {
  return _catalogByType.get(type)
}

export function getNodesByCategory(category: NodePaletteCategory): NodeCatalogEntry[] {
  return NODE_CATALOG.filter((e) => e.category === category)
}

export const PALETTE_CATEGORIES: { id: NodePaletteCategory; label: string; icon: string }[] = [
  { id: "triggers", label: "Triggers", icon: "Zap" },
  { id: "data", label: "Data", icon: "Database" },
  { id: "ai", label: "AI", icon: "Sparkles" },
  { id: "logic", label: "Logic", icon: "GitBranch" },
  { id: "transform", label: "Transform", icon: "Shuffle" },
  { id: "output", label: "Output", icon: "Send" },
]

/** Search catalog by keyword, returns ranked results */
export function searchCatalog(query: string): NodeCatalogEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return NODE_CATALOG
  return NODE_CATALOG.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.tags.some((t) => t.includes(q)),
  )
}
