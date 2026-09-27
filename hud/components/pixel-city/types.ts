/** Live data the pixel city draws. Everything is optional-safe: an empty state renders a calm, idle city. */

export type CityTimeOfDay = "day" | "night"

/** Weather overlay, derived from the Home weather snapshot's WMO code. */
export type CityWeather = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow"

export type CityPresence = "online" | "listening" | "thinking" | "speaking" | "offline"

/** One lit floor of the task tower, most recent first. */
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

/** Buildings in the District where agents do their jobs; most stand for one or more integrations. */
export type CityWorkplace = "hq" | "lab" | "comms" | "post" | "bank" | "parlour" | "cinema" | "library" | "power" | "depot"

/** A deployed agent (an agent task) walking the District. */
export interface CityAgent {
  id: string
  name: string
  status: CityTaskLight
  /** Where its current work happens, from the tools it last used. */
  workplace: CityWorkplace
}

export interface CitySceneState {
  timeOfDay: CityTimeOfDay
  weather: CityWeather
  presence: CityPresence
  /** Up to five task floors, lit from the top of the tower down. */
  taskLights: CityTaskLight[]
  /** Active deployment runs; each one is a ferry crossing the harbour (capped by the renderer). */
  activeRuns: number
  /** Scrolling billboard text on the tenement. */
  ticker: CityTickerItem[]
  /** One flag per integration; each lights one antenna LED. */
  integrations: boolean[]
  polymarketConnected: boolean
  youtubeConnected: boolean
  /** Pinned notes on the laundry line (capped by the renderer). */
  notesCount: number
  /** Today's model spend, shown on the water tank's LED meter. */
  costTodayUsd: number | null
  budgetAlert: boolean
  /** Active conversations: letters the pigeons carry. */
  conversationsCount: number
  /** District only: agents on the streets (capped by the renderer). */
  agents: CityAgent[]
  /** District only: workplaces whose integration is connected (the rest are dark with a CLOSED sign). */
  openWorkplaces: CityWorkplace[]
  /** District only: connected integrations; each one's building has its sign lit. */
  connectedIntegrations: CityIntegration[]
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

/** Anything clickable in a city view: a Home place, or (District) one integration's own building. */
export type CityPlaceId = CityHotspotId | `integration-${CityIntegration}`

/** Hotspot rectangle in logical scene pixels. */
export interface CityRect {
  x: number
  y: number
  w: number
  h: number
  /**
   * Where the bobbing marker sits, in logical pixels of the scene. Isometric buildings only fill the middle of
   * their bounding rect, so without this the marker would float in the air behind the roof. Default: rect top centre.
   */
  markerX?: number
  markerY?: number
}

export const EMPTY_CITY_STATE: CitySceneState = {
  timeOfDay: "night",
  weather: "clear",
  presence: "online",
  taskLights: [],
  activeRuns: 0,
  ticker: [],
  integrations: [],
  polymarketConnected: false,
  youtubeConnected: false,
  notesCount: 0,
  costTodayUsd: null,
  budgetAlert: false,
  conversationsCount: 0,
  agents: [],
  openWorkplaces: [],
  connectedIntegrations: [],
}

/** What the pointer is over: a place (opens its popup) or an agent. Anchor is the logical point for a tag. */
export type CitySceneHit =
  | { kind: "hotspot"; id: CityPlaceId }
  | { kind: "agent"; id: string; label: string; detail: string; anchorX: number; anchorY: number }

/** The contract every city view implements, so one scene component can host either. */
export interface CitySceneRenderer {
  /** Logical pixels covered by the HUD bar (top) and the player bar (bottom): nothing clickable is placed there. */
  setSafeArea?(top: number, bottom: number): void
  resize(width: number, height: number, cityKey: string): void
  setState(state: CitySceneState): void
  render(timeSeconds: number): void
  hotspots(): Partial<Record<CityPlaceId, CityRect>>
  hitTest(x: number, y: number): CitySceneHit | null
}
