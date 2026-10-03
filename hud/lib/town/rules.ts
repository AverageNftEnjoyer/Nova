/**
 * U.B Agents City progression rules: XP weights, the level curve, level titles, and building thresholds.
 *
 * Pure and free of `server-only` / `@/` runtime imports so plain Node smokes can transpile and run it
 * (scripts/smoke/town). Every input is a real, persisted count (see stats.ts); nothing here is random.
 */

import { INTEGRATION_SETUP_KEYS, type IntegrationSetupKey } from "../integrations/navigation"
import type { TownBuilding, TownLevel, TownXpSource } from "./types"

// ─── Stats snapshot ───────────────────────────────────────────────────────────

/** Lifetime counts that earn XP. Each one is a high-water mark (see state.ts), so pruning or deleting never lowers it. */
export interface TownLifetimeCounts {
  /** agent_tasks with status "completed". */
  tasksCompleted: number
  /** deployments created (any status). */
  deployments: number
  /** deployment_runs with status "succeeded". */
  deploymentRunsSucceeded: number
  /** missions that are not the definition behind a deployment (those count as deployments). */
  missions: number
  /** job_runs that succeeded and are not the attempt spine of a deployment run. */
  missionRunsSucceeded: number
  notes: number
  /** chat threads. */
  conversations: number
  /** messages the user sent to U.B Agents. */
  chatMessages: number
  /** tool_runs with status "success". */
  toolRuns: number
  /** SKILL.md files the user added (starter skills excluded). */
  skills: number
  /** llm_usage rows (every LLM call). */
  llmCalls: number
}

export const TOWN_COUNT_KEYS = [
  "tasksCompleted",
  "deployments",
  "deploymentRunsSucceeded",
  "missions",
  "missionRunsSucceeded",
  "notes",
  "conversations",
  "chatMessages",
  "toolRuns",
  "skills",
  "llmCalls",
] as const satisfies readonly (keyof TownLifetimeCounts)[]

export type TownCountKey = typeof TOWN_COUNT_KEYS[number]

/** Today's activity in the viewer's time zone (daily quests). */
export interface TownTodayCounts {
  chatMessages: number
  tasksCompleted: number
  notesTouched: number
  toolRuns: number
}

// ─── XP ───────────────────────────────────────────────────────────────────────

interface XpRule {
  id: string
  label: string
  /** XP per occurrence. */
  weight: number
  count: TownCountKey | "integrationsConnected"
}

/**
 * XP per occurrence. Real work (tasks, deployments, skills) is worth the most; cheap, frequent actions (chat
 * messages, tool calls) earn a little each so steady use still moves the bar. Connecting an integration pays once,
 * the first time it is ever connected.
 */
export const XP_RULES: readonly XpRule[] = [
  { id: "agent-tasks", label: "Agent tasks completed", weight: 40, count: "tasksCompleted" },
  { id: "deployment-runs", label: "Deployment runs succeeded", weight: 30, count: "deploymentRunsSucceeded" },
  { id: "deployments", label: "Deployments created", weight: 25, count: "deployments" },
  { id: "missions", label: "Missions built", weight: 25, count: "missions" },
  { id: "mission-runs", label: "Mission runs succeeded", weight: 10, count: "missionRunsSucceeded" },
  { id: "integrations", label: "Integrations connected", weight: 60, count: "integrationsConnected" },
  { id: "skills", label: "Skills added", weight: 50, count: "skills" },
  { id: "notes", label: "Notes written", weight: 10, count: "notes" },
  { id: "conversations", label: "Conversations started", weight: 15, count: "conversations" },
  { id: "chat-messages", label: "Messages sent to U.B Agents", weight: 2, count: "chatMessages" },
  { id: "tool-runs", label: "Tool calls made", weight: 1, count: "toolRuns" },
]

export interface QuestXpTotals {
  /** Completed (non-daily) quests and the XP they paid. */
  questsCompleted: number
  questXp: number
  /** Daily quests completed so far (all days) and the XP they paid. */
  dailyCompleted: number
  dailyXp: number
}

export function computeXpSources(
  counts: TownLifetimeCounts,
  integrationsConnected: number,
  quests: QuestXpTotals,
): TownXpSource[] {
  const sources: TownXpSource[] = XP_RULES.map((rule) => {
    const count = rule.count === "integrationsConnected" ? integrationsConnected : counts[rule.count]
    return { id: rule.id, label: rule.label, count, xp: count * rule.weight }
  })
  sources.push({ id: "quests", label: "Quests completed", count: quests.questsCompleted, xp: quests.questXp })
  sources.push({ id: "daily-quests", label: "Daily quests completed", count: quests.dailyCompleted, xp: quests.dailyXp })
  return sources
}

export function totalXp(sources: readonly TownXpSource[]): number {
  return sources.reduce((sum, source) => sum + source.xp, 0)
}

// ─── Level curve ─────────────────────────────────────────────────────────────

export const MAX_TOWN_LEVEL = 99

/**
 * XP to go from `level` to `level + 1`: 60 · level^1.6, rounded to 5. Level 2 costs 60 XP (the first tutorial quest
 * gets there), level 5 is ~1.1k total XP, level 10 ~8k, level 20 ~44k: early levels arrive in minutes, later ones
 * take weeks of real use.
 */
export function xpForNextLevel(level: number): number {
  return Math.max(5, Math.round((60 * Math.pow(Math.max(1, level), 1.6)) / 5) * 5)
}

/** Total XP at which `level` starts (level 1 starts at 0). */
export function levelStartXp(level: number): number {
  let xp = 0
  for (let l = 1; l < level; l++) xp += xpForNextLevel(l)
  return xp
}

const LEVEL_TITLES: readonly { from: number; title: string }[] = [
  { from: 1, title: "Hamlet" },
  { from: 3, title: "Village" },
  { from: 6, title: "Town" },
  { from: 10, title: "City" },
  { from: 15, title: "Metropolis" },
  { from: 22, title: "Megacity" },
  { from: 30, title: "Skyline Capital" },
]

export function titleForLevel(level: number): string {
  let title = LEVEL_TITLES[0].title
  for (const band of LEVEL_TITLES) if (level >= band.from) title = band.title
  return title
}

export function levelForXp(xp: number): TownLevel {
  const total = Math.max(0, Math.floor(xp))
  let level = 1
  let start = 0
  while (level < MAX_TOWN_LEVEL && total >= start + xpForNextLevel(level)) {
    start += xpForNextLevel(level)
    level += 1
  }
  const nextLevelXp = level >= MAX_TOWN_LEVEL ? start : start + xpForNextLevel(level)
  return { level, xp: total, levelStartXp: start, nextLevelXp, title: titleForLevel(level) }
}

// ─── Buildings ───────────────────────────────────────────────────────────────

export const LLM_PROVIDER_KEYS = ["openai", "claude", "grok", "gemini"] as const satisfies readonly IntegrationSetupKey[]
export const MESSAGING_KEYS = ["telegram", "discord", "slack"] as const satisfies readonly IntegrationSetupKey[]

function isLlmProvider(key: IntegrationSetupKey): boolean {
  return (LLM_PROVIDER_KEYS as readonly IntegrationSetupKey[]).includes(key)
}

/**
 * Uses needed for building levels 2 and 3 (level 1 = connected). AI labs count LLM calls, which happen far more
 * often than tool calls, so their bar is higher.
 */
export function buildingThresholds(key: IntegrationSetupKey): readonly [number, number] {
  return isLlmProvider(key) ? [100, 1000] : [25, 150]
}

export function buildingFor(key: IntegrationSetupKey, connected: boolean, uses: number): TownBuilding {
  const [l2, l3] = buildingThresholds(key)
  if (!connected) return { integration: key, connected, level: 0, uses, nextLevelUses: null }
  const level: TownBuilding["level"] = uses >= l3 ? 3 : uses >= l2 ? 2 : 1
  return { integration: key, connected, level, uses, nextLevelUses: level === 1 ? l2 : level === 2 ? l3 : null }
}

export function buildBuildings(
  connected: ReadonlySet<IntegrationSetupKey>,
  uses: Readonly<Record<IntegrationSetupKey, number>>,
): TownBuilding[] {
  return INTEGRATION_SETUP_KEYS.map((key) => buildingFor(key, connected.has(key), uses[key] ?? 0))
}
