/**
 * Nova City progression: the contract between the server (`GET /api/town`, `POST /api/town/ack`) and Home.
 * Every number here is derived from real, persisted Nova activity in nova.db and the workspace docs. Nothing is
 * invented, nothing is random, and nothing resets on reload.
 */

import type { IntegrationSetupKey } from "@/lib/integrations/navigation"

/** A source of XP, with how much it earned so far. Shown on the Town Hall progress screen. */
export interface TownXpSource {
  id: string
  label: string
  /** How many times it happened (e.g. 12 completed agent tasks). */
  count: number
  /** XP earned from it in total. */
  xp: number
}

export interface TownLevel {
  level: number
  /** Total XP ever earned. */
  xp: number
  /** XP at which the current level started. */
  levelStartXp: number
  /** XP needed to reach the next level. */
  nextLevelXp: number
  /** Short title for the level, e.g. "Hamlet", "Village", "Town", "City", "Metropolis". */
  title: string
}

export type TownQuestStatus = "locked" | "active" | "completed"

export type TownQuestCategory = "tutorial" | "daily" | "milestone" | "integration"

export interface TownQuest {
  id: string
  category: TownQuestCategory
  title: string
  /** One sentence telling the user what to do in Nova. */
  description: string
  status: TownQuestStatus
  /** Progress toward the goal, from real data. */
  progress: number
  goal: number
  xpReward: number
  /** Where the quest is done: a Home place to highlight, or an app route to open. */
  target?: { place?: string; route?: string; integration?: IntegrationSetupKey }
  completedAt?: string
}

/** A building's level, driven by that integration's own usage. 0 = not connected (empty lot). */
export interface TownBuilding {
  integration: IntegrationSetupKey
  connected: boolean
  level: 0 | 1 | 2 | 3
  /** Uses counted toward its level (tool runs or LLM calls). */
  uses: number
  nextLevelUses: number | null
}

/** Something that happened since the user last acknowledged: level-ups, finished quests, new buildings. */
export interface TownEvent {
  id: string
  kind: "level-up" | "quest-complete" | "building-up" | "achievement"
  title: string
  detail: string
  xp?: number
  at: string
}

export interface TownTutorialState {
  /** False once the user finished or skipped the tutorial. */
  active: boolean
  /** Id of the tutorial quest the user is on (the first active quest in category "tutorial"). */
  currentQuestId: string | null
  skipped: boolean
}

export interface TownProgress {
  level: TownLevel
  sources: TownXpSource[]
  quests: TownQuest[]
  buildings: TownBuilding[]
  /** Events not yet acknowledged (celebrate once, then POST /api/town/ack). */
  pendingEvents: TownEvent[]
  tutorial: TownTutorialState
  /** Townsfolk the city can show, grown from real activity (conversations, level). */
  population: number
  generatedAt: string
}

/** POST /api/town/ack body. */
export interface TownAckRequest {
  /** Event ids the UI has shown. */
  eventIds?: string[]
  /** Tutorial control. */
  tutorial?: "skip" | "restart" | "finish"
}
