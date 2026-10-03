import type { ResidentId } from "@/lib/town/residents"

/** Live data the U.B Agents City scene draws. An empty state renders a calm, idle city: nobody walks unless real work or a real connection puts them there. */

/** Weather overlay, derived from the Home weather snapshot's WMO code. */
export type CityWeather = "clear" | "cloudy" | "fog" | "rain" | "storm" | "snow"

export type CityPresence = "online" | "listening" | "thinking" | "speaking" | "offline"

/** One lit floor of U.B Agents HQ's tower, most urgent task first. */
export type CityTaskLight = "running" | "queued" | "paused" | "failed" | "completed"

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
  /** Up to five task floors on U.B Agents HQ's gate, lit from the top down. */
  taskLights: CityTaskLight[]
  /** Active deployment runs; each one is a boat sailing in the harbour bay (capped by the renderer). */
  activeRuns: number
  /** Pinned papers on the noticeboard by the glasshouse (capped by the renderer). */
  notesCount: number
  /** Agents on the streets (capped by the renderer). */
  agents: CityAgent[]
  /** Connected integrations; each one's building has its status lamp lit. */
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

/**
 * What the scene component needs from the city world (the PixiJS implementation is `world/pixi-world.ts`): the
 * simulation queries behind the DOM overlay, plus state in.
 */
export interface CitySceneRenderer {
  setState(state: CitySceneState): void
  hotspots(): Partial<Record<CityPlaceId, CityRect>>
  hitTest(x: number, y: number): CitySceneHit | null
  /** Every resident on the streets, with where they stand this frame. */
  residents(): CityResidentAnchor[]
  /** The place under the pointer or keyboard focus gets a highlight in its footprint (null clears it). */
  setHover(id: CityPlaceId | null): void
  /** The world only animates and renders while active (Home on screen). */
  setActive(active: boolean): void
  destroy(): void
}
