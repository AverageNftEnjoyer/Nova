export type AgentStatus = "online" | "busy" | "offline"

export interface WorkerAgentNode {
  id: string
  name: string
  role: string
  provider: "openai" | "claude" | "grok" | "gemini"
  status: AgentStatus
  tags: string[]
}

export interface DomainManagerNode {
  id: string
  label: string
  objective: string
  accent: "cyan" | "amber" | "violet" | "emerald" | "rose" | "blue"
  workers: WorkerAgentNode[]
}

export const NOVA_OPERATOR_NODE = {
  id: "nova-operator",
  name: "Nova Operator",
  role: "Primary user-facing chatbot and router",
}

export const NOVA_COUNCIL_NODES = [
  {
    id: "routing-council",
    label: "Routing Council",
    summary: "Intent classification, confidence scoring, handoff control",
  },
  {
    id: "policy-council",
    label: "Policy Council",
    summary: "Safety checks, permission gates, action approvals",
  },
  {
    id: "memory-council",
    label: "Memory Council",
    summary: "Context packing, preference reads, memory write policy",
  },
  {
    id: "planning-council",
    label: "Planning Council",
    summary: "Multi-step decomposition, execution strategy, and plan validation",
  },
] as const

export const NOVA_DOMAIN_MANAGERS: DomainManagerNode[] = [
  {
    id: "media-manager",
    label: "Media",
    objective: "Playback, queueing, and voice delivery",
    accent: "emerald",
    workers: [
      {
        id: "spotify-agent",
        name: "Spotify Agent",
        role: "Playback + playlists",
        provider: "openai",
        status: "online",
        tags: ["playback", "favorites"],
      },
      {
        id: "youtube-agent",
        name: "YouTube Agent",
        role: "Feed + channel controls",
        provider: "gemini",
        status: "online",
        tags: ["videos", "channel"],
      },
      {
        id: "voice-agent",
        name: "Voice Agent",
        role: "Voice controls",
        provider: "grok",
        status: "online",
        tags: ["mute", "resume"],
      },
      {
        id: "tts-agent",
        name: "TTS Agent",
        role: "Speech synthesis",
        provider: "openai",
        status: "online",
        tags: ["speech", "voice-output"],
      },
    ],
  },
  {
    id: "finance-manager",
    label: "Finance",
    objective: "Quotes, portfolio, market execution",
    accent: "amber",
    workers: [
      {
        id: "crypto-agent",
        name: "Crypto Agent",
        role: "Market reads",
        provider: "claude",
        status: "online",
        tags: ["price", "movers"],
      },
      {
        id: "coinbase-agent",
        name: "Coinbase Agent",
        role: "Portfolio actions",
        provider: "openai",
        status: "busy",
        tags: ["balances", "P&L"],
      },
      {
        id: "polymarket-agent",
        name: "Polymarket Agent",
        role: "Prediction markets + odds scans",
        provider: "grok",
        status: "online",
        tags: ["odds", "contracts"],
      },
      {
        id: "market-agent",
        name: "Market Agent",
        role: "Market structure + trend scans",
        provider: "gemini",
        status: "online",
        tags: ["trend", "market-scan"],
      },
    ],
  },
  {
    id: "productivity-manager",
    label: "Productivity",
    objective: "Calendar, missions, planning",
    accent: "violet",
    workers: [
      {
        id: "calendar-agent",
        name: "Calendar Agent",
        role: "Events + schedule",
        provider: "gemini",
        status: "online",
        tags: ["calendar", "reschedule"],
      },
      {
        id: "missions-agent",
        name: "Missions Agent",
        role: "Workflow execution",
        provider: "claude",
        status: "online",
        tags: ["build", "run"],
      },
      {
        id: "reminders-agent",
        name: "Reminders Agent",
        role: "Reminders + follow-up tasks",
        provider: "openai",
        status: "online",
        tags: ["reminders", "follow-up"],
      },
    ],
  },
  {
    id: "comms-manager",
    label: "Communications",
    objective: "Email and messaging automations",
    accent: "cyan",
    workers: [
      {
        id: "gmail-agent",
        name: "Gmail Agent",
        role: "Inbox + replies",
        provider: "openai",
        status: "online",
        tags: ["summary", "reply"],
      },
      {
        id: "telegram-agent",
        name: "Telegram Agent",
        role: "Message delivery",
        provider: "grok",
        status: "offline",
        tags: ["send", "status"],
      },
      {
        id: "discord-agent",
        name: "Discord Agent",
        role: "Channel delivery + status checks",
        provider: "claude",
        status: "online",
        tags: ["discord", "delivery"],
      },
    ],
  },
  {
    id: "system-manager",
    label: "System",
    objective: "Diagnostics and runtime operations",
    accent: "blue",
    workers: [
      {
        id: "diagnostics-agent",
        name: "Diagnostics Agent",
        role: "Health + traces",
        provider: "claude",
        status: "online",
        tags: ["errors", "latency"],
      },
      {
        id: "files-agent",
        name: "Files Agent",
        role: "Workspace operations",
        provider: "gemini",
        status: "busy",
        tags: ["files", "index"],
      },
      {
        id: "web-research-agent",
        name: "Web Research Agent",
        role: "Source-backed lookups",
        provider: "openai",
        status: "online",
        tags: ["search", "citations"],
      },
    ],
  },
]

export const PROVIDER_RAIL = [
  { id: "openai", label: "OpenAI Adapter", model: "gpt-5 / gpt-4.1" },
  { id: "claude", label: "Claude Adapter", model: "sonnet-4" },
  { id: "grok", label: "Grok Adapter", model: "grok-4" },
  { id: "gemini", label: "Gemini Adapter", model: "gemini-2.5-pro" },
] as const
