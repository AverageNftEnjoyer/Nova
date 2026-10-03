import { DISTRICT_IMAGE_HEIGHT, DISTRICT_IMAGE_SRC, DISTRICT_IMAGE_WIDTH, DISTRICT_PLACES } from "@/components/pixel-city/district/image-plan"
import type { CityRect } from "@/components/pixel-city/types"
import type { IntegrationSetupKey } from "@/lib/integrations/navigation"

/**
 * How each integration's U.B Agents City building is drawn on the Integrations page: its neon sign colour and the crop of the
 * painted city (the same painting Home uses) that shows the building. Names and levels are not here: names come from
 * lib/town/quests (`integrationBuildingName`), levels from GET /api/town. An integration with no painted building in the
 * painting (News: the Newsstand) has no crop and gets a pixel lot instead; nothing is invented.
 */

/** Neon sign colour per building (UI accents chosen to read on the night palette). */
export const INTEGRATION_SIGN_COLORS: Readonly<Record<IntegrationSetupKey, string>> = {
  telegram: "#5fd0ff",
  discord: "#9aa4ff",
  slack: "#ff8ad8",
  brave: "#ff9a52",
  news: "#e8e2ff",
  coinbase: "#ffc94d",
  phantom: "#c79aff",
  polymarket: "#56f294",
  openai: "#7df0c8",
  claude: "#ff9d73",
  grok: "#d6dcff",
  gemini: "#8db4ff",
  spotify: "#58f08c",
  youtube: "#ff6a6a",
  gmail: "#ffd479",
  "gmail-calendar": "#6fd3ff",
}

const CROP_ASPECT = 1.6

/** The painted building (hit rectangle and, when it has one, the centre of its sign) for an integration. */
function placeFor(key: IntegrationSetupKey): { rect: CityRect; signY: number | null } | null {
  const place = DISTRICT_PLACES.find((candidate) => candidate.integration === key)
  if (!place) return null
  const sign = place.signs[0]
  return { rect: place.hit, signY: sign ? sign.y + sign.h / 2 : null }
}

const MIN_CROP_WIDTH = 260

/**
 * A CROP_ASPECT window onto the painting for one building. Tall, narrow buildings would drag their neighbours in if the
 * whole hit rectangle were shown, so the window is only as wide as the building needs (at least MIN_CROP_WIDTH) and
 * slides down the building to its sign (or the upper part of it), then back inside the painting.
 */
function cropFor(rect: CityRect, signY: number | null): CityRect {
  const w = Math.min(Math.max(rect.w, MIN_CROP_WIDTH), DISTRICT_IMAGE_WIDTH)
  const h = w / CROP_ASPECT
  const wantedY = signY ?? rect.y + h * 0.6
  const lowestY = rect.h > h ? rect.y + rect.h - h / 2 : rect.y + rect.h / 2
  const highestY = rect.h > h ? rect.y + h / 2 : rect.y + rect.h / 2
  const centreY = Math.min(Math.max(wantedY, highestY), lowestY)
  const x = Math.min(Math.max(rect.x + rect.w / 2 - w / 2, 0), DISTRICT_IMAGE_WIDTH - w)
  const y = Math.min(Math.max(centreY - h / 2, 0), DISTRICT_IMAGE_HEIGHT - h)
  return { x, y, w, h }
}

/** CSS (as a style object) that shows `buildingCrop(key)` of the painting in a CROP_ASPECT-shaped box of any width. */
export function buildingCropStyle(key: IntegrationSetupKey): Record<string, string> | null {
  const place = placeFor(key)
  if (!place) return null
  const crop = cropFor(place.rect, place.signY)
  const posX = DISTRICT_IMAGE_WIDTH === crop.w ? 0 : (crop.x / (DISTRICT_IMAGE_WIDTH - crop.w)) * 100
  const posY = DISTRICT_IMAGE_HEIGHT === crop.h ? 0 : (crop.y / (DISTRICT_IMAGE_HEIGHT - crop.h)) * 100
  return {
    backgroundImage: `url(${DISTRICT_IMAGE_SRC})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${(DISTRICT_IMAGE_WIDTH / crop.w) * 100}% auto`,
    backgroundPosition: `${posX}% ${posY}%`,
  }
}
