/**
 * Time of day for U.B Agents City: the system clock by default, or a forced value for testing. Force it with a URL
 * parameter, `?tod=night`, `?tod=dusk`, `?tod=dawn`, `?tod=day` or `?tod=<hour 0-24>` (read once when the world
 * starts), or by calling `setCityTimeOfDay` (null returns to the clock). There is no UI for it.
 */

const NAMED_HOURS: Readonly<Record<string, number>> = { night: 23, midnight: 0, dawn: 6.2, sunrise: 6.2, day: 12, noon: 12, dusk: 19.2, sunset: 19.2 }

let forced: number | null = null

export function setCityTimeOfDay(hour: number | null): void {
  forced = hour === null || !Number.isFinite(hour) ? null : ((hour % 24) + 24) % 24
}

/** Parses the `tod` URL value ("night", "dusk", "21.5"); null when absent or unknown. */
export function parseTimeOfDay(value: string | null): number | null {
  if (!value) return null
  const named = NAMED_HOURS[value.toLowerCase()]
  if (named !== undefined) return named
  const hour = Number(value)
  return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null
}

/** The hour (0-24, fractional) the city is showing now. */
export function cityHour(now = new Date()): number {
  return forced ?? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
}

/** Multiply tint by hour: white is full daylight. */
const KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0x2b3a78],
  [4.5, 0x2f3f7e],
  [6, 0xd29aa8],
  [7.5, 0xffe9d6],
  [9, 0xffffff],
  [16.5, 0xffffff],
  [18, 0xffd6a4],
  [19.5, 0xc9788f],
  [21, 0x4a4a8c],
  [22.5, 0x2b3a78],
  [24, 0x2b3a78],
]

export interface TimeOfDayLook {
  /** Colour to multiply the world by (0xffffff = no change). */
  tint: number
  /** 0 in daylight, 1 at night: how much lit windows glow. */
  night: number
}

const channel = (c: number, shift: number) => (c >> shift) & 255

export function lookAtHour(hour: number): TimeOfDayLook {
  let i = 1
  while (i < KEYS.length - 1 && KEYS[i][0] < hour) i++
  const [h0, c0] = KEYS[i - 1]
  const [h1, c1] = KEYS[i]
  const k = h1 === h0 ? 0 : Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)))
  const mix = (shift: number) => Math.round(channel(c0, shift) + (channel(c1, shift) - channel(c0, shift)) * k)
  const r = mix(16)
  const g = mix(8)
  const b = mix(0)
  const luma = (0.3 * r + 0.59 * g + 0.11 * b) / 255
  return { tint: (r << 16) | (g << 8) | b, night: Math.min(1, Math.max(0, (0.9 - luma) / 0.4)) }
}
