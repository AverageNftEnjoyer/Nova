/**
 * Nova City cosmetics catalogue: every outfit and hat a resident can wear, and the one quest that unlocks each.
 *
 * `QUEST_ITEM_REWARDS` (quest id -> item id) is the single source of truth for what a quest pays; each item's
 * `source.questId` / `source.questTitle` is derived from it and the quest catalogue (quests.ts), never repeated.
 * Pure and free of `server-only` / `@/` runtime imports so the town smoke can run it in plain Node.
 *
 * Only persisted (non-daily) quests are mapped: unlocks derive from the first-completion time stored in state.ts,
 * and a daily quest's completion is only kept as a running counter. Rarer items sit behind harder quests.
 */

import { questTitleFor } from "./quests"
import type { CosmeticItem, CosmeticRarity, CosmeticSlot } from "./wardrobe-types"

interface CosmeticDefinition {
  id: string
  name: string
  rarity: CosmeticRarity
  description: string
}

/** Quest id -> the item it unlocks. Each non-starter item appears exactly once. */
export const QUEST_ITEM_REWARDS: Readonly<Record<string, string>> = {
  // Common: early tutorial steps and the first milestone tier.
  "tutorial-messaging": "hat-headphones",
  "tutorial-first-note": "hat-flower-crown",
  "tutorial-first-task": "hat-chef",
  "tutorial-first-run": "outfit-raincoat",
  "milestone-skills-3": "outfit-varsity",
  // Rare: mid-tier milestones and level-2 building quests.
  "milestone-integrations-8": "outfit-neon-jacket",
  "integration-grok-2": "outfit-astronaut",
  "integration-coinbase-2": "hat-top-hat",
  "milestone-conversations-50": "hat-cat-ears",
  // Epic: the top milestone tiers.
  "milestone-tasks-100": "outfit-knight",
  "milestone-skills-25": "outfit-wizard",
  "milestone-notes-150": "hat-wizard",
  "milestone-integrations-16": "hat-crown",
}

const DEFINITIONS: readonly CosmeticDefinition[] = [
  { id: "outfit-street", name: "Street Wear", rarity: "starter", description: "A hoodie and jeans for everyday errands around the city." },
  { id: "outfit-office", name: "Office Attire", rarity: "starter", description: "A tidy shirt and trousers for the desk crowd." },
  { id: "outfit-overalls", name: "Overalls", rarity: "starter", description: "Sturdy workwear for building things." },
  { id: "hat-beanie", name: "Beanie", rarity: "starter", description: "A snug knit beanie." },
  { id: "hat-cap", name: "Cap", rarity: "starter", description: "A classic baseball cap." },
  { id: "hat-headphones", name: "Headphones", rarity: "common", description: "Big over-ear headphones for tuning out the noise." },
  { id: "hat-flower-crown", name: "Flower Crown", rarity: "common", description: "A ring of blossoms from the archive garden." },
  { id: "hat-chef", name: "Chef Hat", rarity: "common", description: "A tall white toque for whoever is cooking up tasks." },
  { id: "outfit-raincoat", name: "Raincoat", rarity: "common", description: "A yellow slicker for waiting at the bus stop." },
  { id: "outfit-varsity", name: "Varsity Jacket", rarity: "common", description: "A letterman jacket for the Academy's best." },
  { id: "outfit-neon-jacket", name: "Neon Jacket", rarity: "rare", description: "A glowing jacket that owns the night skyline." },
  { id: "outfit-astronaut", name: "Astronaut Suit", rarity: "rare", description: "A pressure suit for stargazers at the Observatory." },
  { id: "hat-top-hat", name: "Top Hat", rarity: "rare", description: "A silk top hat fit for a banker." },
  { id: "hat-cat-ears", name: "Cat Ears", rarity: "rare", description: "Pointy ears, in honour of Nova the cat." },
  { id: "outfit-knight", name: "Knight Armor", rarity: "epic", description: "Polished plate armor for a seasoned workforce commander." },
  { id: "outfit-wizard", name: "Wizard Robe", rarity: "epic", description: "A starry robe for a master of skills." },
  { id: "hat-wizard", name: "Wizard Hat", rarity: "epic", description: "A pointed hat that knows every note ever written." },
  { id: "hat-crown", name: "Crown", rarity: "epic", description: "A golden crown for the ruler of a fully connected city." },
]

export function slotOf(id: string): CosmeticSlot {
  return id.startsWith("hat-") ? "hat" : "outfit"
}

const QUEST_BY_ITEM = new Map<string, string>(Object.entries(QUEST_ITEM_REWARDS).map(([questId, itemId]) => [itemId, questId]))

function toItem(definition: CosmeticDefinition): CosmeticItem {
  const questId = QUEST_BY_ITEM.get(definition.id)
  if (definition.rarity === "starter") return { ...definition, slot: slotOf(definition.id), source: { kind: "starter" } }
  const questTitle = questId ? questTitleFor(questId) : null
  if (!questId || !questTitle) throw new Error(`Cosmetic ${definition.id} is not mapped to a real quest in QUEST_ITEM_REWARDS`)
  return { ...definition, slot: slotOf(definition.id), source: { kind: "quest", questId, questTitle } }
}

export const COSMETIC_CATALOG: readonly CosmeticItem[] = DEFINITIONS.map(toItem)
export const COSMETIC_IDS: readonly string[] = COSMETIC_CATALOG.map((item) => item.id)

const BY_ID = new Map(COSMETIC_CATALOG.map((item) => [item.id, item]))

export function getCosmetic(id: string): CosmeticItem | undefined {
  return BY_ID.get(id)
}

export function cosmeticArtUrl(id: string): string {
  return `/pixel-city/town/cosmetics/${id}.png`
}

/** The item a (non-daily) quest unlocks, or undefined. */
export function itemRewardFor(questId: string): CosmeticItem | undefined {
  const itemId = QUEST_ITEM_REWARDS[questId]
  return itemId ? BY_ID.get(itemId) : undefined
}
