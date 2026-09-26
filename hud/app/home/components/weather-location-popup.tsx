"use client"

import { useState, type FormEvent } from "react"
import { CloudSun, LoaderCircle, MapPin, Save, X } from "lucide-react"

import {
  MAX_PREFERRED_CITY_LENGTH,
  normalizePreferredCity,
  updatePersonalization,
} from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"

interface WeatherLocationPopupProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  currentCity: string
  weatherLoading: boolean
  weatherError: string | null
  onClose: () => void
}

export function WeatherLocationPopup({
  isLight,
  panelClass,
  subPanelClass,
  currentCity,
  weatherLoading,
  weatherError,
  onClose,
}: WeatherLocationPopupProps) {
  const [city, setCity] = useState(currentCity)
  const [validationError, setValidationError] = useState<string | null>(null)

  const saveCity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCity = normalizePreferredCity(city)
    if (!normalizedCity) {
      setValidationError("Enter a city, optionally followed by a state or country.")
      return
    }
    updatePersonalization({ preferredCity: normalizedCity })
    onClose()
  }

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[130] cursor-default bg-black/25"
        onClick={onClose}
        aria-label="Close weather location"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-location-title"
        className={cn(
          "fixed right-4 top-16 z-[135] w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-2xl backdrop-blur-xl home-spotlight-shell",
          panelClass,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CloudSun className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <h2
                id="weather-location-title"
                className={cn(
                  "truncate text-sm font-semibold uppercase tracking-[0.16em]",
                  isLight ? "text-s-90" : "text-slate-100",
                )}
              >
                Weather location
              </h2>
              <p className={cn("mt-0.5 text-[10px]", isLight ? "text-s-50" : "text-slate-400")}>
                Saved locally for this profile
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn("h-7 w-7 shrink-0 rounded-md border home-spotlight-card home-border-glow", subPanelClass)}
            aria-label="Close weather location"
          >
            <X className="mx-auto h-3.5 w-3.5" />
          </button>
        </div>

        <form onSubmit={saveCity} className="mt-3">
          <label
            htmlFor="home-weather-city"
            className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", isLight ? "text-s-60" : "text-slate-300")}
          >
            City
          </label>
          <div className={cn("mt-1.5 flex items-center gap-2 rounded-lg border px-2.5 home-spotlight-card home-border-glow", subPanelClass)}>
            <MapPin className={cn("h-4 w-4 shrink-0", isLight ? "text-s-50" : "text-slate-400")} />
            <input
              id="home-weather-city"
              autoFocus
              value={city}
              maxLength={MAX_PREFERRED_CITY_LENGTH}
              onChange={(event) => {
                setCity(event.target.value)
                if (validationError) setValidationError(null)
              }}
              placeholder="e.g. Indianapolis, IN"
              className={cn(
                "h-10 min-w-0 flex-1 bg-transparent text-sm outline-none",
                isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500",
              )}
            />
          </div>

          <div className="mt-2 min-h-5">
            {validationError ? (
              <p className={cn("text-[11px]", isLight ? "text-rose-700" : "text-rose-300")}>{validationError}</p>
            ) : weatherError ? (
              <p className={cn("text-[11px]", isLight ? "text-rose-700" : "text-rose-300")}>{weatherError}</p>
            ) : weatherLoading ? (
              <p className={cn("inline-flex items-center gap-1.5 text-[11px]", isLight ? "text-s-60" : "text-slate-300")}>
                <LoaderCircle className="h-3 w-3 animate-spin" />
                Updating current conditions...
              </p>
            ) : (
              <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                Add a state or country when city names are ambiguous.
              </p>
            )}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "h-8 rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] home-spotlight-card home-border-glow",
                subPanelClass,
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/45 bg-accent/15 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent transition-colors hover:bg-accent/25"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
