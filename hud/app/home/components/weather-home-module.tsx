"use client"

import Image from "next/image"
import { CloudRain, CloudSun, Droplets, Gauge, Wind } from "lucide-react"
import { useState, type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/shared/utils"
import type { HomeWeatherSnapshot } from "../hooks/use-home-weather"

interface WeatherHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  preferredCity: string
  weather: HomeWeatherSnapshot | null
  weatherLoading: boolean
  weatherError: string | null
}

interface WeatherMetricTileProps {
  isLight: boolean
  subPanelClass: string
  icon: ReactNode
  value: string
}

function formatTemp(value: number | null): string {
  if (value === null) return "--"
  return `${Math.round(value)}\u00B0`
}

function formatPercent(value: number | null): string {
  if (value === null) return "--"
  return `${Math.round(value)}%`
}

function formatWind(value: number | null): string {
  if (value === null) return "--"
  return `${Math.round(value)} mph`
}

function formatPrecipitation(snapshot: HomeWeatherSnapshot): string {
  if (snapshot.precipitationChancePercent !== null) return formatPercent(snapshot.precipitationChancePercent)
  if (snapshot.precipitationInches !== null) return `${snapshot.precipitationInches.toFixed(2)} in`
  return "--"
}

function WeatherMetricTile({ isLight, subPanelClass, icon, value }: WeatherMetricTileProps) {
  return (
    <div
      className={cn(
        "h-full rounded-md border px-2.5 py-1.5 home-spotlight-card home-border-glow flex items-center justify-center",
        subPanelClass,
      )}
    >
      <div className="inline-flex items-center gap-2 min-w-0">
        {icon}
        <p className={cn("truncate text-[14px] font-semibold tabular-nums leading-tight", isLight ? "text-s-90" : "text-slate-100")}>{value}</p>
      </div>
    </div>
  )
}

export function WeatherHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  preferredCity,
  weather,
  weatherLoading,
  weatherError,
}: WeatherHomeModuleProps) {
  const [failedIconKey, setFailedIconKey] = useState<string | null>(null)
  const weatherIconAssetPath = weather?.weatherIconAssetPath || null
  const weatherIconKey = weather ? `${weatherIconAssetPath || ""}:${weather.observedAt || weather.fetchedAt}` : null
  const shouldRenderWeatherIcon = Boolean(weatherIconAssetPath && weatherIconKey && failedIconKey !== weatherIconKey)

  return (
    <section style={panelStyle} className={`${panelClass} home-spotlight-shell px-3 py-2.5 flex flex-col`}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
        <div className="flex items-center gap-2 text-s-80">
          <CloudSun className="w-4 h-4 text-accent" />
        </div>
        <h2 className={cn("min-w-0 text-center text-sm uppercase tracking-[0.16em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
          Weather
        </h2>
        <div />
      </div>

      {!preferredCity ? (
        <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-s-70" : "text-slate-300")}>
          Set a preferred city in Settings to enable weather.
        </p>
      ) : weatherError ? (
        <p className="mt-2 text-[11px] leading-5 text-rose-300">{weatherError}</p>
      ) : weatherLoading && !weather ? (
        <p className={cn("mt-2 text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
          Fetching latest conditions...
        </p>
      ) : weather ? (
        <div className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5">
          <div className={cn("rounded-md border px-2 py-1.5 home-spotlight-card home-border-glow", subPanelClass)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("truncate text-[14px] font-semibold leading-tight", isLight ? "text-s-90" : "text-slate-100")}>
                  {weather.locationLabel}
                </p>
                <p className={cn("mt-0.5 truncate text-[12px] font-medium leading-tight", isLight ? "text-s-60" : "text-slate-300")}>
                  {weather.conditionLabel}
                </p>
              </div>
              <div className="shrink-0 inline-flex items-center gap-1.5">
                {shouldRenderWeatherIcon ? (
                  <Image
                    src={weatherIconAssetPath || ""}
                    alt={`${weather.conditionLabel} icon`}
                    width={30}
                    height={30}
                    className="h-[30px] w-[30px] object-contain"
                    unoptimized
                    onError={() => {
                      if (weatherIconKey) setFailedIconKey(weatherIconKey)
                    }}
                  />
                ) : null}
                <p className={cn("text-[38px] font-semibold tabular-nums tracking-tight leading-none", isLight ? "text-s-90" : "text-slate-100")}>
                  {formatTemp(weather.temperatureF)}
                </p>
              </div>
            </div>
            <p className={cn("mt-0.5 text-[11px] font-medium tabular-nums", isLight ? "text-s-70" : "text-slate-300")}>
              H {formatTemp(weather.highF)} / L {formatTemp(weather.lowF)}
            </p>
          </div>

          <div className="grid grid-cols-2 auto-rows-fr gap-1.5 flex-1 min-h-0">
            <WeatherMetricTile
              isLight={isLight}
              subPanelClass={subPanelClass}
              icon={<Gauge className={cn("h-3.5 w-3.5", isLight ? "text-s-60" : "text-slate-400")} />}
              value={formatTemp(weather.feelsLikeF)}
            />
            <WeatherMetricTile
              isLight={isLight}
              subPanelClass={subPanelClass}
              icon={<Droplets className={cn("h-3.5 w-3.5", isLight ? "text-s-60" : "text-slate-400")} />}
              value={formatPercent(weather.humidityPercent)}
            />
            <WeatherMetricTile
              isLight={isLight}
              subPanelClass={subPanelClass}
              icon={<Wind className={cn("h-3.5 w-3.5", isLight ? "text-s-60" : "text-slate-400")} />}
              value={formatWind(weather.windMph)}
            />
            <WeatherMetricTile
              isLight={isLight}
              subPanelClass={subPanelClass}
              icon={<CloudRain className={cn("h-3.5 w-3.5", isLight ? "text-s-60" : "text-slate-400")} />}
              value={formatPrecipitation(weather)}
            />
          </div>
        </div>
      ) : (
        <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-s-70" : "text-slate-300")}>
          Waiting for weather data...
        </p>
      )}
    </section>
  )
}
