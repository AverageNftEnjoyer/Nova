"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import type { CityPlaceId } from "@/components/pixel-city"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { TownQuest } from "@/lib/town/types"
import { isAppRoute, questHotspot, questPlace, SKILLS_TARGET } from "./town-ui"

interface QuestNavigatorOptions {
  /** Home's own place opener (the same one the building buttons use). */
  openPlace: (id: CityPlaceId) => void
  goToIntegrations: (setup: IntegrationSetupKey) => void
  /** Skills live in Settings (target.place "skills"). */
  openSettings: () => void
}

/**
 * Takes the user to where a quest is done, in this order: Settings for "skills"; the Home building `target.place`
 * names (its popup, or for an integration building that integration's setup); the integration's setup; any other
 * building found for the target; the app route.
 */
export function useQuestNavigator({ openPlace, goToIntegrations, openSettings }: QuestNavigatorOptions): (quest: TownQuest) => void {
  const router = useRouter()
  return useCallback(
    (quest: TownQuest) => {
      const target = quest.target
      if (!target) return
      if (target.place === SKILLS_TARGET) {
        openSettings()
        return
      }
      const hotspot = questHotspot(quest)
      if (hotspot) {
        openPlace(hotspot)
        return
      }
      if (target.integration) {
        goToIntegrations(target.integration)
        return
      }
      const place = questPlace(quest)
      if (place) {
        openPlace(place)
        return
      }
      if (isAppRoute(target.route)) router.push(target.route)
    },
    [openPlace, goToIntegrations, openSettings, router],
  )
}
