/**
 * Nova City wardrobe: the contract between the server (`GET/POST /api/town/wardrobe`), the quest catalogue and Home's
 * resident card. Cosmetics are earned by completing quests (derived from persisted quest completion, never revoked).
 * Art lives at `/pixel-city/town/cosmetics/<id>.png`: a 224x256 sheet (7 columns: standing + 6 walk frames, 8 direction
 * rows S,SE,E,NE,N,NW,W,SW, 32 px cells), identical to `/pixel-city/town/characters/*.png`. An "outfit" is a full body
 * sheet; a "hat" is a transparent sheet with the same grid that only paints the hat, drawn over the body cell for cell
 * (the cell position is the anchor, no extra data).
 */

import type { IntegrationSetupKey } from "@/lib/integrations/navigation"

export type ResidentId = `agent:${string}` | `integration:${IntegrationSetupKey}`
export type CosmeticSlot = "outfit" | "hat" // outfit = full 8-dir body sheet; hat = 8-dir head-anchored overlay
export type CosmeticRarity = "starter" | "common" | "rare" | "epic"
export interface CosmeticItem {
  id: string // art at /pixel-city/town/cosmetics/<id>.png
  name: string
  slot: CosmeticSlot
  rarity: CosmeticRarity
  description: string
  source: { kind: "starter" } | { kind: "quest"; questId: string; questTitle: string }
}
export interface OwnedCosmetic extends CosmeticItem {
  unlocked: boolean
  unlockedAt?: string
}
export interface ResidentLook {
  residentId: ResidentId
  name?: string
  equipped: Partial<Record<CosmeticSlot, string>>
}
export interface TownWardrobe {
  items: OwnedCosmetic[]
  residents: Record<string, ResidentLook>
}
export interface WardrobeUpdateRequest {
  residentId: ResidentId
  name?: string | null
  equipped?: Partial<Record<CosmeticSlot, string | null>>
}
