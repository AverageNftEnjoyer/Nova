/**
 * Nova City quest catalogue: the tutorial chain, milestone tiers, per-integration building quests and daily quests.
 *
 * Every quest's progress is a real count (TownQuestContext, built from nova.db and the workspace docs). Pure and free
 * of `server-only` / `@/` runtime imports so the town smoke can run it in plain Node.
 */

import { INTEGRATION_SETUP_KEYS, type IntegrationSetupKey } from "../integrations/navigation"
import {
  LLM_PROVIDER_KEYS,
  MESSAGING_KEYS,
  buildingThresholds,
  townsfolkRewardFor,
  type TownLifetimeCounts,
  type TownTodayCounts,
} from "./rules"
import type { TownQuest, TownQuestCategory } from "./types"

export interface TownQuestContext {
  counts: TownLifetimeCounts
  today: TownTodayCounts
  /** Local day key (YYYY-MM-DD) of "today" in the viewer's zone. */
  dayKey: string
  /** Integrations ever connected (a quest stays done after a disconnect). */
  connectedEver: ReadonlySet<IntegrationSetupKey>
  /** Integrations connected right now. */
  connected: ReadonlySet<IntegrationSetupKey>
  /** Uses per integration (tool runs, LLM calls, mission runs). */
  uses: Readonly<Record<IntegrationSetupKey, number>>
}

interface QuestDefinition {
  id: string
  category: TownQuestCategory
  title: string
  description: string
  goal: number
  xpReward: number
  target?: TownQuest["target"]
  progress: (ctx: TownQuestContext) => number
}

const INTEGRATION_LABELS: Record<IntegrationSetupKey, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  brave: "Brave",
  news: "News",
  coinbase: "Coinbase",
  phantom: "Phantom",
  polymarket: "Polymarket",
  openai: "OpenAI",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
  spotify: "Spotify",
  youtube: "YouTube",
  gmail: "Gmail",
  "gmail-calendar": "Google Calendar",
}

/** The building each integration raises in Nova City (see docs/frontend/nova-town-concept.md, section 3.1). */
const INTEGRATION_BUILDINGS: Record<IntegrationSetupKey, string> = {
  telegram: "Telegraph Office",
  discord: "Arcade",
  slack: "Co-working Office",
  brave: "Library",
  news: "Newsstand",
  coinbase: "Bank",
  phantom: "Vault",
  polymarket: "Trading Floor",
  openai: "Research Lab",
  claude: "Writing Studio",
  grok: "Observatory",
  gemini: "Twin Towers",
  spotify: "Record Store",
  youtube: "Cinema",
  gmail: "Post Office",
  "gmail-calendar": "Clock Tower",
}

export function integrationLabel(key: IntegrationSetupKey): string {
  return INTEGRATION_LABELS[key]
}

export function integrationBuildingName(key: IntegrationSetupKey): string {
  return INTEGRATION_BUILDINGS[key]
}

const anyConnected = (keys: readonly IntegrationSetupKey[]) => (ctx: TownQuestContext) =>
  keys.some((key) => ctx.connectedEver.has(key)) ? 1 : 0

// ─── Tutorial ────────────────────────────────────────────────────────────────

/** In order: each one teaches the next part of the platform. The first unfinished one is the current step. */
export const TUTORIAL_QUESTS: readonly QuestDefinition[] = [
  {
    id: "tutorial-meet-nova",
    category: "tutorial",
    title: "Meet Nova",
    description: "Open the chat and send Nova your first message.",
    goal: 1,
    xpReward: 50,
    target: { place: "chat" },
    progress: (ctx) => ctx.counts.chatMessages,
  },
  {
    id: "tutorial-connect-ai",
    category: "tutorial",
    title: "Power up the city",
    description: "Connect an AI provider (OpenAI, Claude, Grok or Gemini) in Integrations.",
    goal: 1,
    xpReward: 75,
    target: { place: "integrations", route: "/integrations" },
    progress: anyConnected(LLM_PROVIDER_KEYS),
  },
  {
    id: "tutorial-first-task",
    category: "tutorial",
    title: "Put an agent to work",
    description: "Start an agent task from Agent Tasks and let it run to completion.",
    goal: 1,
    xpReward: 100,
    target: { place: "tasks" },
    progress: (ctx) => ctx.counts.tasksCompleted,
  },
  {
    id: "tutorial-first-note",
    category: "tutorial",
    title: "Open the archive",
    description: "Write your first note in Notes.",
    goal: 1,
    xpReward: 50,
    target: { place: "notes" },
    progress: (ctx) => ctx.counts.notes,
  },
  {
    id: "tutorial-first-deployment",
    category: "tutorial",
    title: "Open the bus depot",
    description: "Create your first deployment with New deployment.",
    goal: 1,
    xpReward: 100,
    target: { place: "deploy" },
    progress: (ctx) => ctx.counts.deployments,
  },
  {
    id: "tutorial-first-run",
    category: "tutorial",
    title: "First bus out",
    description: "Launch a deployment and see a run finish successfully.",
    goal: 1,
    xpReward: 125,
    target: { place: "deploy", route: "/deployments" },
    progress: (ctx) => ctx.counts.deploymentRunsSucceeded,
  },
  {
    id: "tutorial-messaging",
    category: "tutorial",
    title: "Send word",
    description: "Connect Telegram, Discord or Slack so Nova can reach you anywhere.",
    goal: 1,
    xpReward: 75,
    target: { place: "integrations", route: "/integrations" },
    progress: anyConnected(MESSAGING_KEYS),
  },
  {
    id: "tutorial-first-skill",
    category: "tutorial",
    title: "Teach Nova a skill",
    description: "Add your own skill in Settings > Skills.",
    goal: 1,
    xpReward: 100,
    target: { place: "skills" },
    progress: (ctx) => ctx.counts.skills,
  },
]

// ─── Milestones ──────────────────────────────────────────────────────────────

interface MilestoneSeries {
  id: string
  title: string
  /** `{n}` is replaced with the tier's goal. */
  description: string
  tiers: readonly number[]
  /** XP for tier i (0-based). */
  xp: (tierIndex: number) => number
  target?: TownQuest["target"]
  progress: (ctx: TownQuestContext) => number
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]

export const MILESTONE_SERIES: readonly MilestoneSeries[] = [
  {
    id: "tasks",
    title: "Workforce",
    description: "Complete {n} agent tasks.",
    tiers: [5, 10, 25, 50, 100, 250, 500],
    xp: (i) => 100 * (i + 1),
    target: { place: "tasks" },
    progress: (ctx) => ctx.counts.tasksCompleted,
  },
  {
    id: "integrations",
    title: "Skyline",
    description: "Connect {n} integrations.",
    tiers: [3, 5, 8, 12, 16],
    xp: (i) => 120 * (i + 1),
    target: { place: "integrations", route: "/integrations" },
    progress: (ctx) => ctx.connectedEver.size,
  },
  {
    id: "deployment-runs",
    title: "Transit network",
    description: "Finish {n} successful deployment runs.",
    tiers: [5, 25, 100, 250],
    xp: (i) => 120 * (i + 1),
    target: { place: "deploy", route: "/deployments" },
    progress: (ctx) => ctx.counts.deploymentRunsSucceeded,
  },
  {
    id: "conversations",
    title: "Town square",
    description: "Start {n} conversations with Nova.",
    tiers: [10, 50, 200, 500],
    xp: (i) => 80 * (i + 1),
    target: { place: "chat" },
    progress: (ctx) => ctx.counts.conversations,
  },
  {
    id: "notes",
    title: "Archivist",
    description: "Keep {n} notes.",
    tiers: [10, 50, 150],
    xp: (i) => 80 * (i + 1),
    target: { place: "notes" },
    progress: (ctx) => ctx.counts.notes,
  },
  {
    id: "skills",
    title: "Academy",
    description: "Add {n} skills of your own.",
    tiers: [3, 10, 25],
    xp: (i) => 150 * (i + 1),
    target: { place: "skills" },
    progress: (ctx) => ctx.counts.skills,
  },
  {
    id: "tool-runs",
    title: "Busy streets",
    description: "Make {n} tool calls through chat or agents.",
    tiers: [100, 1000, 5000],
    xp: (i) => 100 * (i + 1),
    target: { place: "tasks" },
    progress: (ctx) => ctx.counts.toolRuns,
  },
]

function milestoneDefinition(series: MilestoneSeries, tierIndex: number): QuestDefinition {
  const goal = series.tiers[tierIndex] ?? 0
  return {
    id: `milestone-${series.id}-${goal}`,
    category: "milestone",
    title: `${series.title} ${ROMAN[tierIndex] ?? tierIndex + 1}`,
    description: series.description.replace("{n}", goal.toLocaleString("en-US")),
    goal,
    xpReward: series.xp(tierIndex),
    target: series.target,
    progress: series.progress,
  }
}

// ─── Integration buildings ───────────────────────────────────────────────────

const INTEGRATION_QUEST_XP = [50, 100, 200] as const

function integrationDefinition(key: IntegrationSetupKey, buildingLevel: 1 | 2 | 3): QuestDefinition {
  const label = INTEGRATION_LABELS[key]
  const building = INTEGRATION_BUILDINGS[key]
  const target: TownQuest["target"] = { place: `integration-${key}`, route: `/integrations?setup=${key}`, integration: key }
  if (buildingLevel === 1) {
    return {
      id: `integration-${key}-1`,
      category: "integration",
      title: `Build the ${building}`,
      description: `Connect ${label} to raise the ${building} on its empty lot.`,
      goal: 1,
      xpReward: INTEGRATION_QUEST_XP[0],
      target,
      progress: (ctx) => (ctx.connectedEver.has(key) ? 1 : 0),
    }
  }
  const goal = buildingThresholds(key)[buildingLevel - 2]
  const unit = (LLM_PROVIDER_KEYS as readonly IntegrationSetupKey[]).includes(key) ? "AI calls" : "uses"
  return {
    id: `integration-${key}-${buildingLevel}`,
    category: "integration",
    title: buildingLevel === 2 ? `Expand the ${building}` : `${building} landmark`,
    description: `Use ${label} ${goal.toLocaleString("en-US")} times (${unit}) to grow the ${building} to level ${buildingLevel}.`,
    goal,
    xpReward: INTEGRATION_QUEST_XP[buildingLevel - 1],
    target,
    progress: (ctx) => ctx.uses[key] ?? 0,
  }
}

// ─── Daily ───────────────────────────────────────────────────────────────────

/** Daily quests: ids carry the local day, so each one can be completed (and paid) once per day. */
export function dailyDefinitions(dayKey: string): QuestDefinition[] {
  return [
    {
      id: `daily-chat-${dayKey}`,
      category: "daily",
      title: "Daily check-in",
      description: "Send Nova 5 messages today.",
      goal: 5,
      xpReward: 30,
      target: { place: "chat" },
      progress: (ctx) => ctx.today.chatMessages,
    },
    {
      id: `daily-task-${dayKey}`,
      category: "daily",
      title: "Daily shift",
      description: "Complete an agent task today.",
      goal: 1,
      xpReward: 60,
      target: { place: "tasks" },
      progress: (ctx) => ctx.today.tasksCompleted,
    },
    {
      id: `daily-note-${dayKey}`,
      category: "daily",
      title: "Daily journal",
      description: "Write or update a note today.",
      goal: 1,
      xpReward: 25,
      target: { place: "notes" },
      progress: (ctx) => ctx.today.notesTouched,
    },
    {
      id: `daily-tools-${dayKey}`,
      category: "daily",
      title: "Busy day",
      description: "Make 10 tool calls today through chat or agents.",
      goal: 10,
      xpReward: 40,
      target: { place: "tasks" },
      progress: (ctx) => ctx.today.toolRuns,
    },
  ]
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

const TUTORIAL_BY_ID = new Map(TUTORIAL_QUESTS.map((quest) => [quest.id, quest]))

/** XP reward of a stored (non-daily) quest id, or 0 when the id is not in the catalogue. */
export function questRewardFor(id: string): number {
  const tutorial = TUTORIAL_BY_ID.get(id)
  if (tutorial) return tutorial.xpReward
  const milestone = /^milestone-(.+)-(\d+)$/.exec(id)
  if (milestone) {
    const series = MILESTONE_SERIES.find((candidate) => candidate.id === milestone[1])
    const tierIndex = series ? series.tiers.indexOf(Number(milestone[2])) : -1
    return series && tierIndex >= 0 ? series.xp(tierIndex) : 0
  }
  const integration = /^integration-(.+)-([123])$/.exec(id)
  if (integration) {
    const key = INTEGRATION_SETUP_KEYS.find((candidate) => candidate === integration[1])
    return key ? INTEGRATION_QUEST_XP[Number(integration[2]) - 1] : 0
  }
  return 0
}

/** Townsfolk a stored (non-daily) quest id brought to the city, or 0 when the id is not in the catalogue. */
export function questTownsfolkFor(id: string): number {
  if (questRewardFor(id) <= 0) return 0
  if (TUTORIAL_BY_ID.has(id)) return townsfolkRewardFor("tutorial")
  if (id.startsWith("milestone-")) return townsfolkRewardFor("milestone")
  if (id.startsWith("integration-")) return townsfolkRewardFor("integration")
  return 0
}

export interface QuestEvaluation {
  quests: TownQuest[]
  /** Quests whose goal is met now but that are not yet in `completedAt` (the caller records them). */
  newlyCompleted: TownQuest[]
  /** Id of the first unfinished tutorial quest. */
  currentTutorialQuestId: string | null
}

function evaluate(definition: QuestDefinition, ctx: TownQuestContext, completedAt: Readonly<Record<string, string>>, nowIso: string) {
  const raw = Math.max(0, Math.floor(definition.progress(ctx)))
  const stored = completedAt[definition.id]
  const done = Boolean(stored) || raw >= definition.goal
  const quest: TownQuest = {
    id: definition.id,
    category: definition.category,
    title: definition.title,
    description: definition.description,
    status: done ? "completed" : "active",
    progress: done ? definition.goal : Math.min(raw, definition.goal),
    goal: definition.goal,
    xpReward: definition.xpReward,
    townsfolkReward: townsfolkRewardFor(definition.category),
    ...(definition.target ? { target: definition.target } : {}),
    ...(done ? { completedAt: stored ?? nowIso } : {}),
  }
  return { quest, isNew: done && !stored }
}

/**
 * Builds the visible quest list. Completed quests stay completed (their completion time is persisted by the caller).
 * Tutorial: every step whose check is met is completed in any order; the first unfinished step is active, later
 * unfinished steps are locked. Milestones and integrations: completed tiers plus the next tier.
 */
export function evaluateQuests(
  ctx: TownQuestContext,
  completedAt: Readonly<Record<string, string>>,
  nowIso: string,
): QuestEvaluation {
  const quests: TownQuest[] = []
  const newlyCompleted: TownQuest[] = []
  const push = (definition: QuestDefinition) => {
    const { quest, isNew } = evaluate(definition, ctx, completedAt, nowIso)
    quests.push(quest)
    if (isNew) newlyCompleted.push(quest)
    return quest
  }

  let currentTutorialQuestId: string | null = null
  for (const definition of TUTORIAL_QUESTS) {
    const quest = push(definition)
    if (quest.status === "completed") continue
    if (currentTutorialQuestId === null) currentTutorialQuestId = quest.id
    else quest.status = "locked"
  }

  for (const definition of dailyDefinitions(ctx.dayKey)) push(definition)

  for (const series of MILESTONE_SERIES) {
    for (let tierIndex = 0; tierIndex < series.tiers.length; tierIndex++) {
      if (push(milestoneDefinition(series, tierIndex)).status !== "completed") break
    }
  }

  for (const key of INTEGRATION_SETUP_KEYS) {
    for (const buildingLevel of [1, 2, 3] as const) {
      if (push(integrationDefinition(key, buildingLevel)).status !== "completed") break
    }
  }

  return { quests, newlyCompleted, currentTutorialQuestId }
}
