"use client"

import { useState, type FormEvent } from "react"
import { CloudSun } from "lucide-react"

import { Button, Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input } from "@/components/ui"
import { MAX_PREFERRED_CITY_LENGTH, normalizePreferredCity, updatePersonalization } from "@/lib/settings/userSettings"
import { useHomeWeather } from "../hooks/use-home-weather"

/** One quiet line for the page header: city, temperature, conditions, and a way to change the city. */
export function HomeWeather() {
  const { preferredCity, weather, weatherLoading, weatherError, refreshWeather } = useHomeWeather()
  const [open, setOpen] = useState(false)

  const temperature = weather?.temperatureF !== null && weather?.temperatureF !== undefined ? `${Math.round(weather.temperatureF)}°F` : null

  let line: string
  if (!preferredCity) line = ""
  else if (weatherError) line = "Weather unavailable"
  else if (weatherLoading && !weather) line = "Loading weather"
  else line = [weather?.locationLabel || preferredCity, temperature, weather?.conditionLabel].filter(Boolean).join("  ")

  return (
    <>
      {preferredCity ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-xs text-muted transition-colors hover:text-fg"
          aria-label={`Weather: ${line}. Change location`}
          title={weatherError ?? "Change weather location"}
        >
          <CloudSun className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate whitespace-pre tabular-nums">{line}</span>
        </button>
      ) : (
        <Button size="xs" variant="ghost" className="-ml-2 text-muted" onClick={() => setOpen(true)}>
          <CloudSun />
          Set weather location
        </Button>
      )}
      {open ? (
        <WeatherLocationDialog
          currentCity={preferredCity}
          weatherError={weatherError}
          onRetry={refreshWeather}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

interface WeatherLocationDialogProps {
  currentCity: string
  weatherError: string | null
  onRetry: () => void
  onClose: () => void
}

function WeatherLocationDialog({ currentCity, weatherError, onRetry, onClose }: WeatherLocationDialogProps) {
  const [city, setCity] = useState(currentCity)
  const [validationError, setValidationError] = useState<string | null>(null)

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizePreferredCity(city)
    if (!normalized) {
      setValidationError("Enter a city, optionally followed by a state or country.")
      return
    }
    // Saving the same city does not change settings, so it would not refetch: retry explicitly instead.
    if (normalized === normalizePreferredCity(currentCity)) onRetry()
    else updatePersonalization({ preferredCity: normalized })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} size="sm">
      <form onSubmit={save}>
        <DialogHeader>
          <DialogTitle>Weather location</DialogTitle>
          <DialogDescription>Saved on this device for your profile.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field
            label="City"
            hint={weatherError && !validationError ? weatherError : "Add a state or country when a city name is ambiguous."}
            error={validationError ?? undefined}
          >
            <Input
              value={city}
              maxLength={MAX_PREFERRED_CITY_LENGTH}
              placeholder="Indianapolis, IN"
              data-autofocus
              onChange={(event) => {
                setCity(event.target.value)
                if (validationError) setValidationError(null)
              }}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save location</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
