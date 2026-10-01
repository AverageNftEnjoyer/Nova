import { DISTRICT_PLACES, type CityPlaceId } from "@/components/pixel-city"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { TownLevel, TownQuest, TownQuestCategory, TownQuestStatus } from "@/lib/town/types"

/** Quest log tabs, in order. "integration" quests live on the Buildings tab. */
export const QUEST_TABS: readonly { category: TownQuestCategory; label: string }[] = [
  { category: "tutorial", label: "Tutorial" },
  { category: "daily", label: "Daily" },
  { category: "milestone", label: "Milestones" },
  { category: "integration", label: "Buildings" },
]

export const QUEST_STATUS_LABEL: Record<TownQuestStatus, string> = {
  active: "Active",
  completed: "Done",
  locked: "Locked",
}

const STATUS_ORDER: Record<TownQuestStatus, number> = { active: 0, locked: 1, completed: 2 }

/** Active first, then locked, then completed; the server's order is kept inside each group. */
export function sortQuests(quests: readonly TownQuest[]): TownQuest[] {
  return quests
    .map((quest, index) => ({ quest, index }))
    .sort((a, b) => STATUS_ORDER[a.quest.status] - STATUS_ORDER[b.quest.status] || a.index - b.index)
    .map(({ quest }) => quest)
}

export interface XpProgress {
  /** 0..1 through the current level. */
  ratio: number
  /** XP earned inside the current level. */
  into: number
  /** XP the current level spans. */
  span: number
  /** XP still needed for the next level. */
  toNext: number
}

export function xpProgress(level: TownLevel): XpProgress {
  const span = Math.max(0, level.nextLevelXp - level.levelStartXp)
  const into = Math.min(span, Math.max(0, level.xp - level.levelStartXp))
  return { ratio: span > 0 ? into / span : 1, into, span, toNext: Math.max(0, level.nextLevelXp - level.xp) }
}

export function questRatio(quest: TownQuest): number {
  if (quest.status === "completed") return 1
  if (quest.goal <= 0) return 0
  return Math.min(1, Math.max(0, quest.progress / quest.goal))
}

export function formatXp(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

const PLACE_IDS = new Set<string>(DISTRICT_PLACES.map((place) => place.id))

/**
 * The Home place a quest points at: its `target.place` (a place id, or a place name), else the building of its
 * `target.integration`. Null when the quest is done somewhere else (a route) or the place is unknown.
 */
export function questPlace(quest: TownQuest): CityPlaceId | null {
  const target = quest.target
  if (!target) return null
  if (target.place) {
    if (PLACE_IDS.has(target.place)) return target.place as CityPlaceId
    const byName = DISTRICT_PLACES.find((place) => place.name.toLowerCase() === target.place?.toLowerCase())
    if (byName) return byName.id
  }
  if (target.integration) return integrationPlace(target.integration)
  return null
}

/** The building an integration has in the city: its own lot, or the Home place that stands for it. */
export function integrationPlace(integration: IntegrationSetupKey): CityPlaceId | null {
  const own = `integration-${integration}`
  if (PLACE_IDS.has(own)) return own as CityPlaceId
  return DISTRICT_PLACES.find((place) => place.integration === integration)?.id ?? null
}

/** `target.place` for quests done in Settings > Skills: not a building in the city. */
export const SKILLS_TARGET = "skills"

/** The Home place a quest's `target.place` names exactly (no building fallback): what "Go" opens. */
export function questHotspot(quest: TownQuest): CityPlaceId | null {
  const place = quest.target?.place
  return place && PLACE_IDS.has(place) ? (place as CityPlaceId) : null
}

export function hasQuestTarget(quest: TownQuest): boolean {
  const target = quest.target
  return !!target && (target.place === SKILLS_TARGET || !!questPlace(quest) || !!target.integration || isAppRoute(target.route))
}

export function isAppRoute(route: string | undefined): route is string {
  return typeof route === "string" && route.startsWith("/") && !route.startsWith("//")
}

/** Display names for integrations the city does not have a node for (e.g. "news"). */
export const INTEGRATION_LABELS: Record<IntegrationSetupKey, string> = {
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

/** The painted building's name for an integration, when it has one. */
export function integrationBuildingName(integration: IntegrationSetupKey): string | null {
  const id = integrationPlace(integration)
  return id ? (DISTRICT_PLACES.find((place) => place.id === id)?.name ?? null) : null
}
