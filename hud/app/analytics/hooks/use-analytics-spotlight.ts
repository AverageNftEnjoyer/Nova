import { useSpotlightEffect, type SpotlightSectionRef } from "@/app/integrations/hooks"

export function useAnalyticsSpotlight(enabled: boolean, sections: SpotlightSectionRef[], deps: unknown[] = []) {
  useSpotlightEffect(enabled, sections, deps)
}

export type { SpotlightSectionRef }
