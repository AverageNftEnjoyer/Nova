import type { ResidentId } from "@/lib/town/residents"

/** Live data the Nova City scene draws. An empty state renders a calm, idle city: nobody walks unless real work or a real connection puts them there. */

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
  /** The agent task's id. Its resident id is `agent:<id>` (see `agentResidentId`). */
  id: string
  /** The resident's name: the user's chosen name, else the task's name. */
  name: string
  status: CityTaskLight
  /** Where its current work happens, from the tools it last used. */
  workplace: CityWorkplace
}

/** A worker standing for one connected integration, working near that integration's building. */
export interface CityWorker {
  /** `integration:<key>`. */
  id: ResidentId
  integration: CityIntegration
  /** The resident's name: the user's chosen name, else "<Integration> worker". */
  name: string
  /** The building where the worker works, from the integration's place. */
  workplace: CityWorkplace
}

export function agentResidentId(taskId: string): ResidentId {
  return `agent:${taskId}`
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
  /** One worker per connected integration. */
  workers: CityWorker[]
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
  workers: [],
}

/** What the pointer is over: a place (opens its popup) or a resident (an agent or an integration's worker). Anchor is the plan point for a tag. */
export type CitySceneHit =
  | { kind: "hotspot"; id: CityPlaceId }
  | { kind: "resident"; id: ResidentId; label: string; detail: string; anchorX: number; anchorY: number }

/** Where a resident stands right now (plan pixels, feet), for the scene's keyboard-focusable buttons. */
export interface CityResidentAnchor {
  id: ResidentId
  /** The accessible name, "<name>, <kind>". */
  label: string
  x: number
  y: number
  /** False while the figure is fading in or out. */
  visible: boolean
}

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
  /** Every resident on the streets, with where they stand this frame. */
  residents(): CityResidentAnchor[]
}
