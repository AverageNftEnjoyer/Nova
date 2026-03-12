"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { loadUserSettings, normalizePreferredCity, USER_SETTINGS_UPDATED_EVENT } from "@/lib/settings/userSettings"
import { resolveAccuWeatherIcon, type AccuWeatherIconId } from "../weather-icons"

const WEATHER_REFRESH_INTERVAL_MS = 12 * 60 * 1000

interface OpenMeteoGeocodeResult {
  name?: string
  admin1?: string
  country?: string
  country_code?: string
  latitude?: number
  longitude?: number
  population?: number
}

interface OpenMeteoGeocodeResponse {
  results?: OpenMeteoGeocodeResult[]
}

interface OpenMeteoForecastResponse {
  current?: {
    temperature_2m?: number
    apparent_temperature?: number
    relative_humidity_2m?: number
    precipitation?: number
    weather_code?: number
    is_day?: number
    wind_speed_10m?: number
    time?: string
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
  }
}

const US_STATE_NAME_BY_ABBR: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
}
const US_STATE_ABBR_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAME_BY_ABBR).map(([abbr, name]) => [name.toLowerCase(), abbr]),
)

export interface HomeWeatherSnapshot {
  city: string
  locationLabel: string
  temperatureF: number | null
  feelsLikeF: number | null
  highF: number | null
  lowF: number | null
  humidityPercent: number | null
  precipitationInches: number | null
  precipitationChancePercent: number | null
  windMph: number | null
  weatherCode: number | null
  isDay: boolean
  conditionLabel: string
  weatherIconId: AccuWeatherIconId
  weatherIconAssetPath: string
  observedAt: string
  fetchedAt: string
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function weatherCodeToLabel(code: number | null): string {
  const map: Record<number, string> = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Heavy rain showers",
    82: "Violent rain showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
  }
  return map[Number(code)] || "Mixed conditions"
}

function formatLocationLabel(result: OpenMeteoGeocodeResult | null): string {
  if (!result) return ""
  const city = normalizeLocationQuery(result.name || "")
  const admin1 = normalizeLocationQuery(result.admin1 || "")
  const countryCode = String(result.country_code || "").trim().toUpperCase()

  if (countryCode === "US") {
    const stateAbbr = resolveUsStateAbbreviation(admin1)
    if (city && stateAbbr) return `${city}, ${stateAbbr}`
    if (city) return city
  }

  if (city && admin1) return `${city}, ${admin1}`
  return city
}

function normalizeLocationQuery(value: string): string {
  return String(value || "")
    .replace(/[\u201C\u201D"]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "")
}

function resolveUsStateAbbreviation(value: string): string {
  const raw = normalizeLocationQuery(value)
  if (!raw) return ""
  const maybeAbbr = raw.toUpperCase().replace(/\./g, "")
  if (/^[A-Z]{2}$/.test(maybeAbbr) && US_STATE_NAME_BY_ABBR[maybeAbbr]) {
    return maybeAbbr
  }
  const byName = US_STATE_ABBR_BY_NAME[raw.toLowerCase()]
  return byName || ""
}

function parseUsStateHint(value: string): { stateAbbr: string; stateName: string; cityCore: string } | null {
  const input = normalizeLocationQuery(value)
  const match = input.match(/^(.+?),\s*([A-Za-z]{2})(?:\s*,?\s*(?:US|USA|United States))?$/i)
  if (!match?.[1] || !match?.[2]) return null
  const stateAbbr = String(match[2] || "").trim().toUpperCase()
  const stateName = US_STATE_NAME_BY_ABBR[stateAbbr]
  if (!stateName) return null
  return {
    stateAbbr,
    stateName,
    cityCore: normalizeLocationQuery(match[1]),
  }
}

function buildLocationQueryVariants(rawCity: string): string[] {
  const base = normalizeLocationQuery(rawCity)
  if (!base) return []

  const variants: string[] = []
  const pushVariant = (value: string) => {
    const next = normalizeLocationQuery(value)
    if (!next) return
    if (!variants.some((entry) => entry.toLowerCase() === next.toLowerCase())) {
      variants.push(next)
    }
  }

  pushVariant(base)

  const withoutCountryTail = base.replace(/\s*,?\s*(?:US|USA|United States)$/i, "").trim()
  if (withoutCountryTail && withoutCountryTail.toLowerCase() !== base.toLowerCase()) {
    pushVariant(withoutCountryTail)
  }

  if (base.includes(",")) {
    const segments = base.split(",").map((segment) => normalizeLocationQuery(segment)).filter(Boolean)
    if (segments.length > 0) {
      pushVariant(segments[0])
      pushVariant(segments.slice(0, 2).join(", "))
      pushVariant(segments.join(" "))
    }
  }

  const stateHint = parseUsStateHint(base)
  if (stateHint) {
    pushVariant(`${stateHint.cityCore}, ${stateHint.stateName}, United States`)
    pushVariant(`${stateHint.cityCore}, ${stateHint.stateName}`)
    pushVariant(`${stateHint.cityCore} ${stateHint.stateName}`)
    pushVariant(`${stateHint.cityCore}, US`)
  }

  pushVariant(`${withoutCountryTail || base}, United States`)
  return variants
}

function pickBestGeocodeResult(results: OpenMeteoGeocodeResult[], rawCity: string): OpenMeteoGeocodeResult | null {
  const withCoords = results.filter((result) => {
    const latitude = toFiniteNumber(result.latitude)
    const longitude = toFiniteNumber(result.longitude)
    return latitude !== null && longitude !== null
  })
  if (withCoords.length === 0) return null

  const stateHint = parseUsStateHint(rawCity)
  if (stateHint) {
    const hinted = withCoords.find((result) => {
      const admin1 = String(result.admin1 || "").trim().toLowerCase()
      const countryCode = String(result.country_code || "").trim().toUpperCase()
      return admin1 === stateHint.stateName.toLowerCase() && (countryCode === "US" || countryCode === "")
    })
    if (hinted) return hinted
  }

  const preferByPopulation = [...withCoords].sort((left, right) => {
    const leftPopulation = Number.isFinite(Number(left.population)) ? Number(left.population) : 0
    const rightPopulation = Number.isFinite(Number(right.population)) ? Number(right.population) : 0
    if (rightPopulation !== leftPopulation) return rightPopulation - leftPopulation
    return 0
  })
  return preferByPopulation[0] || withCoords[0]
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: "GET", cache: "no-store", signal })
  if (!response.ok) {
    throw new Error(`weather_request_failed:${response.status}`)
  }
  return response.json() as Promise<T>
}

async function fetchHomeWeatherForCity(city: string, signal?: AbortSignal): Promise<HomeWeatherSnapshot> {
  const locationQueries = buildLocationQueryVariants(city)
  let best: OpenMeteoGeocodeResult | null = null
  for (const query of locationQueries) {
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search")
    geocodeUrl.searchParams.set("name", query)
    geocodeUrl.searchParams.set("count", "8")
    geocodeUrl.searchParams.set("language", "en")
    geocodeUrl.searchParams.set("format", "json")
    const geocode = await fetchJson<OpenMeteoGeocodeResponse>(geocodeUrl.toString(), signal)
    const candidates = Array.isArray(geocode.results) ? geocode.results : []
    const picked = pickBestGeocodeResult(candidates, city)
    if (!picked) continue
    best = picked
    break
  }

  const latitude = toFiniteNumber(best?.latitude)
  const longitude = toFiniteNumber(best?.longitude)
  if (latitude === null || longitude === null) {
    throw new Error("weather_location_not_found")
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast")
  forecastUrl.searchParams.set("latitude", String(latitude))
  forecastUrl.searchParams.set("longitude", String(longitude))
  forecastUrl.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,wind_speed_10m",
  )
  forecastUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max")
  forecastUrl.searchParams.set("forecast_days", "1")
  forecastUrl.searchParams.set("timezone", "auto")
  forecastUrl.searchParams.set("temperature_unit", "fahrenheit")
  forecastUrl.searchParams.set("wind_speed_unit", "mph")
  forecastUrl.searchParams.set("precipitation_unit", "inch")

  const forecast = await fetchJson<OpenMeteoForecastResponse>(forecastUrl.toString(), signal)
  const weatherCode = toFiniteNumber(forecast.current?.weather_code)
  const isDay = Number(forecast.current?.is_day || 0) === 1
  const weatherIcon = resolveAccuWeatherIcon(weatherCode, isDay)

  return {
    city,
    locationLabel: formatLocationLabel(best) || city,
    temperatureF: toFiniteNumber(forecast.current?.temperature_2m),
    feelsLikeF: toFiniteNumber(forecast.current?.apparent_temperature),
    highF: toFiniteNumber(Array.isArray(forecast.daily?.temperature_2m_max) ? forecast.daily?.temperature_2m_max[0] : null),
    lowF: toFiniteNumber(Array.isArray(forecast.daily?.temperature_2m_min) ? forecast.daily?.temperature_2m_min[0] : null),
    humidityPercent: toFiniteNumber(forecast.current?.relative_humidity_2m),
    precipitationInches: toFiniteNumber(forecast.current?.precipitation),
    precipitationChancePercent: toFiniteNumber(
      Array.isArray(forecast.daily?.precipitation_probability_max) ? forecast.daily?.precipitation_probability_max[0] : null,
    ),
    windMph: toFiniteNumber(forecast.current?.wind_speed_10m),
    weatherCode,
    isDay,
    conditionLabel: weatherCodeToLabel(weatherCode),
    weatherIconId: weatherIcon.iconId,
    weatherIconAssetPath: weatherIcon.iconAssetPath,
    observedAt: String(forecast.current?.time || ""),
    fetchedAt: new Date().toISOString(),
  }
}

export function useHomeWeather() {
  const initialPreferredCity = useMemo(() => {
    const current = loadUserSettings()
    return normalizePreferredCity(current.personalization?.preferredCity || "")
  }, [])
  const [preferredCity, setPreferredCity] = useState(initialPreferredCity)
  const [weather, setWeather] = useState<HomeWeatherSnapshot | null>(null)
  const [loading, setLoading] = useState(Boolean(initialPreferredCity))
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const preferredCityRef = useRef(preferredCity)

  useEffect(() => {
    preferredCityRef.current = preferredCity
  }, [preferredCity])

  const syncPreferredCity = useCallback(() => {
    const current = loadUserSettings()
    const nextCity = normalizePreferredCity(current.personalization?.preferredCity || "")
    const previousCity = preferredCityRef.current
    if (previousCity === nextCity) return
    preferredCityRef.current = nextCity
    if (nextCity) setLoading(true)
    setPreferredCity(nextCity)
  }, [setLoading, setPreferredCity])

  useEffect(() => {
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncPreferredCity as EventListener)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, syncPreferredCity as EventListener)
    return () => {
      window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncPreferredCity as EventListener)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, syncPreferredCity as EventListener)
    }
  }, [syncPreferredCity])

  useEffect(() => {
    if (!preferredCity) return

    const controller = new AbortController()
    let cancelled = false
    void fetchHomeWeatherForCity(preferredCity, controller.signal)
      .then((snapshot) => {
        if (cancelled) return
        setWeather(snapshot)
        setError(null)
      })
      .catch((reason) => {
        if (cancelled) return
        const code = reason instanceof Error ? reason.message : "weather_unknown_error"
        if (code === "weather_location_not_found") {
          setError(`Could not resolve "${preferredCity}". Use city + state/country in settings.`)
        } else if (code.startsWith("weather_request_failed")) {
          setError("Weather service is temporarily unavailable. Please retry.")
        } else if (code !== "AbortError") {
          setError("Weather lookup failed. Please retry.")
        }
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [preferredCity, refreshTick])

  useEffect(() => {
    if (!preferredCity) return
    const timer = window.setInterval(() => {
      setRefreshTick((previous) => previous + 1)
    }, WEATHER_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [preferredCity])

  const refreshWeather = useCallback(() => {
    if (!preferredCity) return
    setLoading(true)
    setRefreshTick((previous) => previous + 1)
  }, [preferredCity])

  return useMemo(
    () => ({
      preferredCity,
      weather: preferredCity ? weather : null,
      weatherLoading: preferredCity ? loading : false,
      weatherError: preferredCity ? error : null,
      refreshWeather,
    }),
    [preferredCity, weather, loading, error, refreshWeather],
  )
}
