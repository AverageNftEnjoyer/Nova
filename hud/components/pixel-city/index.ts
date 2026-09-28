export { PixelCityScene, type CityHotspot } from "./pixel-city-scene"
export { EMPTY_CITY_STATE } from "./types"
export type { CityAgent, CityHotspotId, CityIntegration, CityPlaceId, CityPresence, CitySceneState, CityTaskLight, CityTickerItem, CityWeather, CityWorkplace } from "./types"
export { workplaceForTools } from "./district/workplace"
export { DISTRICT_PLACES } from "./district/image-plan"

import type { CityWeather } from "./types"

/** Maps an Open-Meteo WMO weather code to the scene's overlay. */
export function cityWeatherFromCode(code: number | null | undefined): CityWeather {
  if (code === null || code === undefined || !Number.isFinite(code)) return "clear"
  if (code === 0) return "clear"
  if (code <= 3) return "cloudy"
  if (code === 45 || code === 48) return "fog"
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow"
  if (code >= 95) return "storm"
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain"
  return "cloudy"
}
