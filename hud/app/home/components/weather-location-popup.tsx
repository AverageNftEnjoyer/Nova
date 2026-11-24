"use client"

import { useEffect, useState, type FormEvent } from "react"
import { CloudSun, LoaderCircle, MapPin, Save, X } from "lucide-react"

import {
  MAX_PREFERRED_CITY_LENGTH,
  normalizePreferredCity,
  updatePersonalization,
} from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"

interface WeatherLocationPopupProps {
  isLight: boolean
  subPanelClass: string
  currentCity: string
  weatherLoading: boolean
  weatherError: string | null
  /** Refetches the saved city; saving an unchanged city does not change settings, so it would not refetch. */
  onRetry: () => void
  onClose: () => void
}

export function WeatherLocationPopup({
  isLight,
  subPanelClass,
  currentCity,
  weatherLoading,
  weatherError,
  onRetry,
  onClose,
}: WeatherLocationPopupProps) {
  const [city, setCity] = useState(currentCity)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  const saveCity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCity = normalizePreferredCity(city)
    if (!normalizedCity) {
      setValidationError("Enter a city, optionally followed by a state or country.")
      return
    }
    if (normalizedCity === normalizePreferredCity(currentCity)) {
      onRetry()
    } else {
      updatePersonalization({ preferredCity: normalizedCity })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className={cn("absolute inset-0 cursor-default backdrop-blur-sm", isLight ? "bg-[#0a122433]" : "bg-black/45")}
        onClick={onClose}
        aria-label="Close weather location"
      />
      {/* Centered like the Settings modal, same surface, border and shadow treatment. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-location-title"
        className={cn(
          "relative z-10 w-full max-w-md rounded-2xl border p-5",
          isLight
            ? "border-[#d9e0ea] bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.3)]"
            : "border-white/20 bg-white/6 backdrop-blur-2xl shadow-[0_24px_60px_-28px_rgba(0,0,0,0.7)]",
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
    </div>
  )
}
