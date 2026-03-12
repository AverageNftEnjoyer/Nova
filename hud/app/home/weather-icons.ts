export type AccuWeatherIconId =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44

interface WeatherIconVariant {
  day: AccuWeatherIconId
  night?: AccuWeatherIconId
}

const WEATHER_ICON_BY_OPEN_METEO_CODE: Record<number, WeatherIconVariant> = {
  0: { day: 1, night: 33 },
  1: { day: 2, night: 34 },
  2: { day: 3, night: 35 },
  3: { day: 7, night: 38 },
  45: { day: 11 },
  48: { day: 11 },
  51: { day: 12 },
  53: { day: 12 },
  55: { day: 18 },
  56: { day: 26 },
  57: { day: 26 },
  61: { day: 12 },
  63: { day: 18 },
  65: { day: 18 },
  66: { day: 26 },
  67: { day: 26 },
  71: { day: 19 },
  73: { day: 22 },
  75: { day: 23 },
  77: { day: 19 },
  80: { day: 12 },
  81: { day: 13, night: 40 },
  82: { day: 15, night: 41 },
  85: { day: 20, night: 43 },
  86: { day: 23, night: 44 },
  95: { day: 15, night: 41 },
  96: { day: 16, night: 42 },
  99: { day: 16, night: 42 },
}

const DEFAULT_DAY_ICON: AccuWeatherIconId = 7
const DEFAULT_NIGHT_ICON: AccuWeatherIconId = 38

export const AVAILABLE_ACCUWEATHER_ICON_IDS: AccuWeatherIconId[] = [
  1, 2, 3, 4, 5, 6, 7, 8,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26,
  29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
  39, 40, 41, 42, 43, 44,
]

function normalizeWeatherCode(weatherCode: number | null): number | null {
  if (weatherCode === null) return null
  const normalized = Number(weatherCode)
  if (!Number.isFinite(normalized)) return null
  return Math.trunc(normalized)
}

export function resolveAccuWeatherIconId(weatherCode: number | null, isDay: boolean): AccuWeatherIconId {
  const normalizedCode = normalizeWeatherCode(weatherCode)
  const mapped = normalizedCode === null ? null : WEATHER_ICON_BY_OPEN_METEO_CODE[normalizedCode]
  if (!mapped) {
    return isDay ? DEFAULT_DAY_ICON : DEFAULT_NIGHT_ICON
  }
  if (isDay) return mapped.day
  return mapped.night || mapped.day
}

export function resolveAccuWeatherIconAssetPath(iconId: AccuWeatherIconId): string {
  return `/images/weather/accuweather/${iconId}.svg`
}

export function resolveAccuWeatherIcon(
  weatherCode: number | null,
  isDay: boolean,
): { iconId: AccuWeatherIconId; iconAssetPath: string } {
  const iconId = resolveAccuWeatherIconId(weatherCode, isDay)
  return {
    iconId,
    iconAssetPath: resolveAccuWeatherIconAssetPath(iconId),
  }
}
