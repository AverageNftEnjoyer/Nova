/** Live data the Nova City scene draws. An empty state renders a calm, idle city. */

/** Weather overlay, derived from the Home weather snapshot's WMO code. */
export type CityWeather = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow"

export type CityPresence = "online" | "listening" | "thinking" | "speaking" | "offline"

/** One lit floor of Nova HQ's tower, most urgent task first. */
export type CityTaskLight = "running" | "queued" | "paused" | "failed" | "completed"

export interface CityTickerItem {
  label: string
  value: string
  up: boolean
}

/** Integration keys, matching the integration setup keys Home already uses. */
export type CityIntegration =
  | "telegram"
  | "discord"
  | "slack"
  | "openai"
  | "claude"
  | "grok"
  | "gemini"
  | "spotify"
  | "youtube"
  | "gmail"
  | "gmail-calendar"
  | "brave"
  | "coinbase"
  | "phantom"
  | "polymarket"

/** Buildings where agents do their jobs; most stand for one or more integrations. */
export type CityWorkplace = "hq" | "lab" | "comms" | "post" | "bank" | "parlour" | "cinema" | "library" | "power" | "depot"

/** A deployed agent (an agent task) walking the city. */
export interface CityAgent {
  id: string
  name: string
  status: CityTaskLight
  /** Where its current work happens, from the tools it last used. */
  workplace: CityWorkplace
}

export interface CitySceneState {
  weather: CityWeather
  presence: CityPresence
  /** Up to five task floors on Nova HQ, lit from the top down. */
  taskLights: CityTaskLight[]
  /** Active deployment runs; each one is a bus on the roads (capped by the renderer). */
  activeRuns: number
  /** Crypto ticker on the bus shelter. */
  ticker: CityTickerItem[]
  /** Pinned papers on the noticeboard (capped by the renderer). */
  notesCount: number
  /** Agents on the streets (capped by the renderer). */
  agents: CityAgent[]
  /** Connected integrations; each one's building has its sign steadily lit. */
  connectedIntegrations: CityIntegration[]
  /**
   * Townsfolk walking the streets, scaled from the town's real population (see `townsfolkFor` in Home's scene
   * state). null while the population is still loading: the renderer keeps a small starting crowd until it is known.
   */
  townsfolk: number | null
  /** Nova City's real population (TownProgress.population), told on a townsperson's tag. null while loading. */
  residents: number | null
}

export type CityHotspotId =
  | "tasks"
  | "deploy"
  | "schedule"
  | "crypto"
  | "polymarket"
  | "youtube"
  | "analytics"
  | "notes"
  | "integrations"
  | "chat"

/** Anything clickable in the city: a Home place, or one integration's own building. */
export type CityPlaceId = CityHotspotId | `integration-${CityIntegration}`

/** Hotspot rectangle in the scene's plan pixels. */
export interface CityRect {
  x: number
  y: number
  w: number
  h: number
  /** Where the bobbing marker sits, in plan pixels. Default: rect top centre. */
  markerX?: number
  markerY?: number
}

export const EMPTY_CITY_STATE: CitySceneState = {
  weather: "clear",
  presence: "online",
  taskLights: [],
  activeRuns: 0,
  ticker: [],
  notesCount: 0,
  agents: [],
  connectedIntegrations: [],
  townsfolk: null,
  residents: null,
}

/** What the pointer is over: a place (opens its popup), an agent or a townsperson. Anchor is the plan point for a tag. */
export type CitySceneHit =
  | { kind: "hotspot"; id: CityPlaceId }
  | { kind: "agent"; id: string; label: string; detail: string; anchorX: number; anchorY: number }
  | { kind: "townsfolk"; id: string; anchorX: number; anchorY: number }

/** What the scene component needs from the city renderer. */
export interface CitySceneRenderer {
  /** Canvas size in device pixels (the viewport the camera looks through). */
  resize(width: number, height: number): void
  /** Camera: `scale` device pixels per plan pixel, plan point (`x`, `y`) at the canvas's top-left corner. */
  setCamera(scale: number, x: number, y: number): void
  setState(state: CitySceneState): void
  render(timeSeconds: number): void
  hotspots(): Partial<Record<CityPlaceId, CityRect>>
  hitTest(x: number, y: number): CitySceneHit | null
}
