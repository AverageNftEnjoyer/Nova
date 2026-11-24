import { Bot, Database, GitBranch, Send, Shuffle, Sparkles, Zap, type LucideIcon } from "lucide-react"

import type { NodePaletteCategory } from "@/lib/missions/catalog"

/** Category colour for canvas nodes and the palette: a 2px edge or an icon tint only, from chart/text tokens. */
export const CATEGORY_TONE: Record<NodePaletteCategory, string> = {
  triggers: "var(--chart-3)",
  data: "var(--chart-1)",
  ai: "var(--chart-4)",
  agents: "var(--fg-faint)",
  logic: "var(--chart-5)",
  transform: "var(--chart-2)",
  output: "var(--fg-muted)",
}

export const CATEGORY_ICON: Record<NodePaletteCategory, LucideIcon> = {
  triggers: Zap,
  data: Database,
  ai: Sparkles,
  agents: Bot,
  logic: GitBranch,
  transform: Shuffle,
  output: Send,
}

/** Agent nodes describe routing for the graph; they do not run as live specialists. */
export const AGENT_NODE_NOTE = "Routing metadata. Agent nodes describe how the graph routes work; they are not live specialists."
